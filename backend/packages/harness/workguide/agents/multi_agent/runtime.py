"""Role engine: the per-role execution unit used by Multi-Agent graph nodes.

A :class:`RoleEngine` wraps either a plain chat model (no tools) or a real
``langchain.agents.create_agent`` loop bound to role-specific tools, and
exposes a single async ``run(task, context) -> str`` that turns prompt +
context into final role output text.  Graph nodes stay model-agnostic: they
only consume ``run()``, so tests inject a deterministic chat model while the
real runtime path reuses the project's existing model factory and tool
registry (``get_available_tools``).
"""

from __future__ import annotations

import logging
from typing import TYPE_CHECKING, Any

from langchain.agents import create_agent
from langchain_core.messages import AIMessage, BaseMessage, HumanMessage, SystemMessage
from langchain_core.runnables import RunnableConfig

from workguide.agents.multi_agent.prompts import (
    EXECUTOR_SYSTEM_PROMPT,
    PLANNER_SYSTEM_PROMPT,
    RESEARCH_SYSTEM_PROMPT,
    REVIEWER_SYSTEM_PROMPT,
)
from workguide.utils.messages import message_content_to_text

if TYPE_CHECKING:
    from langchain_core.language_models import BaseChatModel
    from langchain_core.tools import BaseTool

    from workguide.config.app_config import AppConfig

logger = logging.getLogger(__name__)

ROLE_SYSTEM_PROMPTS = {
    "planner": PLANNER_SYSTEM_PROMPT,
    "research": RESEARCH_SYSTEM_PROMPT,
    "execute": EXECUTOR_SYSTEM_PROMPT,
    "reviewer": REVIEWER_SYSTEM_PROMPT,
}


def _extract_text(output: Any) -> str:
    """Coerce a model/chain output into plain text.

    Handles both a bare ``AIMessage`` (plain-model path) and the ``{"messages": ...}``
    dict returned by a folded ``create_agent`` sub-graph (tool path), extracting the
    last assistant message the same way ``SubagentExecutor._extract_final_result`` does.
    """
    if isinstance(output, dict):
        messages = output.get("messages") or []
        for message in reversed(messages):
            if isinstance(message, AIMessage):
                return message_content_to_text(message.content) or ""
        return ""
    if isinstance(output, BaseMessage):
        return message_content_to_text(output.content) or ""
    return message_content_to_text(output) or ""


class RoleEngine:
    """Execute one WorkGuide role against a model (optionally + tools)."""

    name: str

    def __init__(
        self,
        model: BaseChatModel,
        *,
        role: str = "execute",
        tools: list[BaseTool] | None = None,
        system_prompt: str | None = None,
        recursion_limit: int = 200,
    ) -> None:
        if role not in ROLE_SYSTEM_PROMPTS:
            raise ValueError(f"Unknown role '{role}'; expected one of {sorted(ROLE_SYSTEM_PROMPTS)}")
        self.name = role
        self._system_prompt = system_prompt or ROLE_SYSTEM_PROMPTS[role]
        self._tools = list(tools) if tools else None
        self._recursion_limit = recursion_limit

        # Reuse LangChain's own agent primitive: full ToolNode + routing loop when
        # the role gets tools, otherwise a bare model invocation (kept for planning /
        # review / deterministic tests).
        if self._tools:
            self._graph = create_agent(
                model=model,
                tools=self._tools,
                system_prompt=self._system_prompt,
            )
        else:
            self._graph = model

    async def run(self, task: str, context: str = "") -> str:
        """Run the role for ``task`` with optional ``context``; return final text."""
        human = task if not context else f"{context}\n\nTASK:\n{task}"
        messages: list[BaseMessage] = [SystemMessage(content=self._system_prompt), HumanMessage(content=human)]
        config = {"recursion_limit": self._recursion_limit}
        if self._tools:
            output = await self._graph.ainvoke({"messages": messages}, config=config)
        else:
            output = await self._graph.ainvoke(messages, config=config)
        text = _extract_text(output)
        if not text:
            logger.warning("[multi_agent] Role %s produced empty output", self.name)
        return text

    @staticmethod
    def from_runtime(app_config: AppConfig, role: str, *, model_name: str | None = None) -> "RoleEngine":
        """Build a role engine wired to the real runtime model + tool registry.

        Reuses ``create_chat_model`` (models/factory.py) and ``get_available_tools``
        (tools/tools.py), exactly like the Lead Agent factory, so no tool is
        re-implemented. Planner/Reviewer get no tools (they plan/review, not execute);
        Research/Execute get the configured tool set.
        """
        from workguide.models import create_chat_model
        from workguide.tools import get_available_tools

        resolved_name = model_name or (app_config.models[0].name if app_config.models else None)
        if not resolved_name:
            raise ValueError("No chat model configured; cannot build a real Multi-Agent role engine.")

        model = create_chat_model(name=resolved_name, attach_tracing=False, app_config=app_config)
        tools: list[BaseTool] | None = None
        if role in ("research", "execute"):
            tools = get_available_tools(
                model_name=resolved_name,
                groups=None,
                subagent_enabled=False,
                include_upload_tool=False,
                app_config=app_config,
            )
        return RoleEngine(model, role=role, tools=tools, system_prompt=ROLE_SYSTEM_PROMPTS[role])


def build_role_engines(app_config: AppConfig, *, model_name: str | None = None) -> dict[str, RoleEngine]:
    """Build all four real role engines from runtime config (production path)."""
    return {role: RoleEngine.from_runtime(app_config, role, model_name=model_name) for role in ("planner", "research", "execute", "reviewer")}