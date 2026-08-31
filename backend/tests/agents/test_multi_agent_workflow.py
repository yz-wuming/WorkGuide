"""Unit tests for the WorkGuide Multi-Agent orchestration (Planner/Router/Executor/Reviewer/Retry/Final).

All tests run against a **deterministic chat model** (no API key, no network) and
exercise the real LangGraph ``StateGraph`` topology, conditional routing, retry
cap and final formatting.  The runtime tool path is not required here: role
engines are plain-model so every routing decision is reproducible.
"""

from __future__ import annotations

from collections import defaultdict
from collections.abc import Callable
from typing import Any

import pytest
from langchain_core.language_models.chat_models import BaseChatModel
from langchain_core.messages import AIMessage
from langchain_core.outputs import ChatGeneration, ChatResult
from langgraph.checkpoint.memory import InMemorySaver

from workguide.agents.multi_agent import build_multi_agent_graph, make_multi_agent
from workguide.agents.multi_agent.runtime import RoleEngine
from workguide.agents.multi_agent.state import WorkGuidePlanState
from workguide.agents.thread_state import ThreadState

pytestmark = pytest.mark.asyncio


# ---------------------------------------------------------------------------
# Deterministic chat model
# ---------------------------------------------------------------------------

_ROLE_MARKERS = {
    "planner": "WorkGuide Planner",
    "research": "Research Agent",
    "execute": "Executor Agent",
    "reviewer": "Reviewer Agent",
}


class ScriptedModel(BaseChatModel):
    """Returns role-specific canned text; never touches a backend."""

    respond: Callable[[str, str], str]

    @property
    def _llm_type(self) -> str:
        return "scripted-multi-agent"

    def _generate(self, messages, *args, **kwargs) -> ChatResult:  # noqa: ANN001, ANN002, ANN003
        # langchain-core may pass stop / run_manager / output_formatter etc. either
        # positionally or as kwargs across versions; a scripted model ignores all of them.
        role = self._detect_role(messages)
        text = self.respond(role, self._human_text(messages))
        return ChatResult(generations=[ChatGeneration(message=AIMessage(content=text))])

    def _detect_role(self, messages) -> str:  # noqa: ANN001
        for msg in messages:
            content = getattr(msg, "content", "")
            if not isinstance(content, str):
                continue
            for role, marker in _ROLE_MARKERS.items():
                if marker.lower() in content.lower():
                    return role
        return "execute"

    @staticmethod
    def _human_text(messages) -> str:  # noqa: ANN001
        for msg in reversed(messages):
            if getattr(msg, "type", "") == "human":
                content = getattr(msg, "content", "")
                return content if isinstance(content, str) else str(content)
        return ""


def build_engines(model: BaseChatModel) -> dict[str, RoleEngine]:
    return {role: RoleEngine(model, role=role) for role in ("planner", "research", "execute", "reviewer")}


class Script:
    """Stateful responder: counts per-role calls so tests can script fail-then-succeed."""

    def __init__(self, handlers: dict[str, Callable[[str], str]] | None = None) -> None:
        self.handlers = handlers or {}
        self.calls: dict[str, int] = defaultdict(int)

    def respond(self, role: str, _text: str) -> str:
        self.calls[role] += 1
        handler = self.handlers.get(role)
        return handler(self.calls[role]) if handler is not None else ""


def _pass_review(_: int) -> str:
    return '{"status": "PASS", "feedback": "ok", "retry_agent": "execute"}'


def _retry_review(_: int) -> str:
    return '{"status": "RETRY", "feedback": "please redo", "retry_agent": "execute"}'


@pytest.fixture
def script_engines() -> tuple[Script, dict[str, RoleEngine]]:
    script = Script()
    model = ScriptedModel(respond=script.respond)
    return script, build_engines(model)


# ---------------------------------------------------------------------------
# State is additive
# ---------------------------------------------------------------------------


def test_workguide_plan_state_is_additive_over_thread_state() -> None:
    annotations = WorkGuidePlanState.__annotations__
    for key in ("plan", "research_results", "execution_results", "review_result", "retry_count", "final_answer", "current_agent"):
        assert key in annotations, key
    # Original ThreadState channels survive (inherited annotations are merged).
    for key in ("messages", "todos", "artifacts", "delegations", "sandbox"):
        assert key in annotations, key
    # ThreadState itself is untouched (additive, not a replacement).
    assert "plan" not in ThreadState.__annotations__


def test_multi_agent_factory_is_importable() -> None:
    assert callable(make_multi_agent)


# ---------------------------------------------------------------------------
# Graph topology + checkpointer
# ---------------------------------------------------------------------------


async def test_graph_has_all_orchestration_nodes(script_engines) -> None:  # noqa: ANN001
    _, engines = script_engines
    graph = build_multi_agent_graph(engines=engines)
    names = set(graph.nodes)
    for expected in ("planner", "router", "research", "execute", "reviewer", "retry", "final"):
        assert expected in names


async def test_state_initialization(script_engines) -> None:  # noqa: ANN001
    _, engines = script_engines
    graph = build_multi_agent_graph(engines=engines)
    result = await graph.ainvoke({"task": "hello", "messages": []})
    # A task with no plan steps ends gracefully through Final.
    assert result.get("final_answer")


# ---------------------------------------------------------------------------
# Deterministic single-pass scenarios
# ---------------------------------------------------------------------------


async def test_scenario1_plan_learn_python(script_engines) -> None:  # noqa: ANN001
    script, engines = script_engines
    script.handlers["planner"] = lambda _: '[{"description": "Outline a Python learning plan", "agent": "execute"}]'
    script.handlers["execute"] = lambda _: "Drafted a 4-week Python learning plan."
    script.handlers["reviewer"] = _pass_review
    graph = build_multi_agent_graph(engines=engines)
    result = await graph.ainvoke({"task": "帮我制定一个学习 Python 的计划", "messages": []})
    assert result["plan"][0]["agent"] == "execute"
    assert len(result["execution_results"]) == 1
    assert result["final_answer"]
    assert script.calls["planner"] == 1


async def test_scenario2_search_then_summarize(script_engines) -> None:  # noqa: ANN001
    script, engines = script_engines
    script.handlers["planner"] = lambda _: '[{"description": "Search latest Python agent tech", "agent": "research"}]'
    script.handlers["research"] = lambda _: "Found: LangGraph and WorkGuide.\nSources:\n- docs\n- blog"
    script.handlers["reviewer"] = _pass_review
    graph = build_multi_agent_graph(engines=engines)
    result = await graph.ainvoke({"task": "搜索 Python Agent 最新技术，然后总结", "messages": []})
    assert len(result["research_results"]) == 1
    assert not result["execution_results"]
    assert result["final_answer"]


async def test_scenario3_create_and_run_python_file(script_engines) -> None:  # noqa: ANN001
    script, engines = script_engines
    script.handlers["planner"] = lambda _: '[{"description": "Create app.py and run it", "agent": "execute"}]'
    script.handlers["execute"] = lambda _: "Created app.py and ran it; printed Hello."
    script.handlers["reviewer"] = _pass_review
    graph = build_multi_agent_graph(engines=engines)
    result = await graph.ainvoke({"task": "创建一个 Python 文件并运行", "messages": []})
    assert len(result["execution_results"]) == 1
    assert result["final_answer"]


# ---------------------------------------------------------------------------
# Retry / feedback loop scenarios
# ---------------------------------------------------------------------------


async def test_scenario4_retry_then_succeed(script_engines) -> None:  # noqa: ANN001
    script, engines = script_engines
    script.handlers["planner"] = lambda _: '[{"description": "Build a file", "agent": "execute"}]'
    script.handlers["execute"] = lambda n: "ERROR: missing main.py" if n == 1 else "Built and ran main.py."
    script.handlers["reviewer"] = lambda n: '{"status": "RETRY", "feedback": "file missing", "retry_agent": "execute"}' if n == 1 else _pass_review(n)
    graph = build_multi_agent_graph(engines=engines, max_retries=3)
    result = await graph.ainvoke({"task": "create main.py and run it", "messages": []})
    assert len(result["execution_results"]) == 2
    assert result["retry_count"] == 1
    assert result["review_result"]["status"] == "PASS"
    assert result["final_answer"]


async def test_scenario5_retry_capped_returns_failure(script_engines) -> None:  # noqa: ANN001
    script, engines = script_engines
    script.handlers["planner"] = lambda _: '[{"description": "Impossible step", "agent": "execute"}]'
    script.handlers["execute"] = lambda _: "ERROR: stuck forever"
    script.handlers["reviewer"] = _retry_review
    graph = build_multi_agent_graph(engines=engines, max_retries=3)
    result = await graph.ainvoke({"task": "run the impossible task", "messages": []})
    # Bounded loop: retry_count hits the cap and the run terminates.
    assert result["retry_count"] == 3
    assert result["review_result"]["status"] == "FAIL"
    assert result["review_result"].get("capped") is True
    assert result["last_error"]
    assert "failed" in result["final_answer"].lower()


async def test_scenario5_cannot_exceed_max_retries(script_engines) -> None:  # noqa: ANN001
    script, engines = script_engines
    script.handlers["planner"] = lambda _: '[{"description": "X", "agent": "execute"}]'
    script.handlers["execute"] = lambda _: "still failing"
    script.handlers["reviewer"] = lambda n: '{"status": "RETRY", "retry_agent": "execute"}'
    graph = build_multi_agent_graph(engines=engines, max_retries=3)
    result = await graph.ainvoke({"task": "t", "messages": []})
    assert result["retry_count"] <= 3


async def test_final_answer_is_appended_as_message(script_engines) -> None:  # noqa: ANN001
    script, engines = script_engines
    script.handlers["planner"] = lambda _: '[{"description": "Quick", "agent": "execute"}]'
    script.handlers["execute"] = lambda _: "Done."
    script.handlers["reviewer"] = _pass_review
    graph = build_multi_agent_graph(engines=engines)
    result = await graph.ainvoke({"task": "do something quick", "messages": []})
    assert isinstance(result["final_answer"], str) and result["final_answer"]
    last = result["messages"][-1] if result["messages"] else None
    assert isinstance(last, AIMessage)
    assert last.content == result["final_answer"]


async def test_checkpointer_round_trip(script_engines) -> None:  # noqa: ANN001
    # Persistence uses the same LangGraph checkpointer interface the Gateway does.
    script, engines = script_engines
    script.handlers["planner"] = lambda _: '[{"description": "Persist me", "agent": "execute"}]'
    script.handlers["execute"] = lambda _: "Work done."
    script.handlers["reviewer"] = _pass_review
    checkpointer = InMemorySaver()
    graph = build_multi_agent_graph(engines=engines, checkpointer=checkpointer)
    cfg = {"configurable": {"thread_id": "ma-1"}}
    await graph.ainvoke({"task": "persist", "messages": []}, config=cfg)
    snapshot = await graph.aget_state(cfg)
    assert snapshot.values.get("final_answer")


if __name__ == "__main__":
    import sys

    sys.exit(pytest.main([__file__, "-v"]))