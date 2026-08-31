"""The WorkGuide Multi-Agent orchestration graph.

Topology (a real LangGraph ``StateGraph``, no custom state machine):

    START -> planner -> router -(condition)-> research | execute
                 ^                                  |        |
                 |            (RETRY)               v        v
                 |      retry <------------------ reviewer <-+
                 |        | (capped/FAIL -> final)
                 +--------+---- (RETRY re-runs research | execute)
                              (PASS / FAIL -> final) -> END

* ``planner``   - role engine: produces the structured ``plan`` (and nothing else).
* ``router``    - deterministic (no LLM): picks the first pending step and routes.
* ``research`` / ``execute`` - role engines: append results to State, mark step done.
* ``reviewer``  - role engine: returns a ``ReviewResult`` (PASS/RETRY/FAIL).
* ``retry``     - deterministic: bumps ``retry_count``, caps at ``max_retries``.
* ``final``     - deterministic formatter: builds ``final_answer`` (and a final
                  AIMessage so the existing session/streaming pipeline sees it).

All deterministic transitions are plain functions, so every routing decision is
unit-testable with a mocked chat model and requires no API key.
"""

from __future__ import annotations

import logging
from collections.abc import Mapping
from typing import TYPE_CHECKING, Any

from langchain_core.messages import AIMessage
from langgraph.graph import END, START, StateGraph
from langgraph.types import RunnableConfig

from workguide.agents.multi_agent.parsing import extract_json
from workguide.agents.multi_agent.prompts import FINAL_FORMAT
from workguide.agents.multi_agent.runtime import RoleEngine, build_role_engines
from workguide.agents.multi_agent.state import (
    AgentResult,
    PlanStep,
    ReviewResult,
    WorkGuidePlanState,
    build_plan_step,
    build_result,
)

if TYPE_CHECKING:
    from langgraph.checkpoint.base import BaseCheckpointSaver

    from workguide.config.app_config import AppConfig

logger = logging.getLogger(__name__)

DEFAULT_MAX_RETRIES = 3


# ---------------------------------------------------------------------------
# Parsing helpers (role output -> structured State)
# ---------------------------------------------------------------------------


def _parse_plan(text: str, *, task: str | None) -> list[PlanStep] | None:
    """Map Planner text to a plan; fall back to a single ``execute`` step on parse failure."""
    payload = extract_json(text)
    steps: list[PlanStep] | None = None
    if isinstance(payload, list):
        parsed: list[PlanStep] = []
        for entry in payload:
            if not isinstance(entry, Mapping):
                continue
            agent = entry.get("agent")
            if agent not in ("research", "execute"):
                agent = "execute"
            parsed.append(
                build_plan_step(
                    str(entry.get("description") or (task or "Undefined task")).strip(),
                    agent,
                )
            )
        if parsed:
            steps = parsed
    if steps is None:
        # Safety fallback: never let a bad Planner response dead-end the run.
        logger.warning("[multi_agent] Planner output was not a valid plan; falling back to a single execute step")
        steps = [build_plan_step(task or "Undefined task", "execute")]
    return steps


def _parse_review(text: str, *, last_agent: str) -> ReviewResult:
    """Map Reviewer text to a validated ReviewResult."""
    payload = extract_json(text) if isinstance(text, str) else None
    status = "FAIL"
    feedback = ""
    retry_agent = last_agent
    capped = False
    if isinstance(payload, Mapping):
        status = str(payload.get("status") or "FAIL").upper()
        if status not in ("PASS", "RETRY", "FAIL"):
            status = "FAIL"
        feedback = str(payload.get("feedback") or "")
        ra = payload.get("retry_agent")
        if isinstance(ra, str) and ra in ("research", "execute"):
            retry_agent = ra
    result: ReviewResult = {"status": status, "retry_agent": retry_agent}
    if feedback:
        result["feedback"] = feedback
    if capped:
        result["capped"] = True
    return result


def _pending_step(state: Mapping[str, Any]) -> tuple[str, PlanStep] | None:
    """Return the ``(index, step)`` of the first pending plan step, if any."""
    plan = state.get("plan") or []
    for idx, step in enumerate(plan):
        if (step.get("status") in (None, "", "pending")) or step.get("status") is None:
            return idx, step
    return None


def _render_task_context(state: Mapping[str, Any], *, include_review: bool = False) -> str:
    """Build the context digest fed to Research/Executor/Reviewer nodes."""
    lines: list[str] = []
    plan = state.get("plan") or []
    if plan:
        lines.append("PLAN:")
        for s in plan:
            lines.append(f"- [{s.get('agent')}] {s.get('description')} ({s.get('status') or 'pending'})")
    research = state.get("research_results") or []
    if research:
        lines.append("RESEARCH RESULTS (already gathered):")
        for r in research:
            lines.append(f"- {r.get('agent')}: {r.get('summary')}")
    execution = state.get("execution_results") or []
    if execution:
        lines.append("EXECUTION RESULTS (so far):")
        for r in execution:
            lines.append(f"- {r.get('agent')}: {r.get('summary')}")
    if include_review:
        review = state.get("review_result")
        if isinstance(review, Mapping):
            lines.append(f"LAST REVIEW: status={review.get('status')}; feedback={review.get('feedback') or '-'}")
    return "\n".join(lines)


def _mark_step(plan: list[PlanStep] | None, idx: int, status: str) -> list[PlanStep] | None:
    """Return a copy of ``plan`` with the step at ``idx`` re-stamped ``status``."""
    if plan is None:
        return None
    updated = [dict(s) for s in plan]
    updated[idx] = {**updated[idx], "status": status}
    return updated


# ---------------------------------------------------------------------------
# State-transition functions (one per node)
# ---------------------------------------------------------------------------


def planner_node(engine: RoleEngine):
    async def node(state: Mapping[str, Any]) -> dict[str, Any]:
        task = str(state.get("task") or "")
        text = await engine.run(task, "")
        plan = _parse_plan(text, task=task)
        return {"current_agent": "planner", "plan": plan}

    return node


def research_executor_node(engine: RoleEngine, *, step_agent: str):
    async def node(state: Mapping[str, Any]) -> dict[str, Any]:
        target_idx, target_step = _pending_step(state) or (None, None)
        task = str(state.get("task") or "")
        step_desc = target_step["description"] if target_step else task
        context = _render_task_context(state)
        text = await engine.run(step_desc, context)
        result: AgentResult = build_result(engine.name, text, step_id=target_step.get("id") if target_step else None)
        update: dict[str, Any] = {"current_agent": engine.name}
        if step_agent == "research":
            update["research_results"] = [result]
        else:
            update["execution_results"] = [result]
        if target_idx is not None:
            update["plan"] = _mark_step(state.get("plan"), target_idx, "done")
        return update

    return node


def reviewer_node(engine: RoleEngine):
    async def node(state: Mapping[str, Any]) -> dict[str, Any]:
        task = str(state.get("task") or "")
        last_agent = state.get("current_agent") or "execute"
        context = _render_task_context(state, include_review=False)
        text = await engine.run(task, context)
        review = _parse_review(text, last_agent=last_agent)
        return {"current_agent": "reviewer", "review_result": review}

    return node


def retry_node(*, max_retries: int):
    async def node(state: Mapping[str, Any]) -> dict[str, Any]:
        current = int(state.get("retry_count") or 0)
        review = state.get("review_result") or {}
        if current >= max_retries:
            capped: ReviewResult = {**review, "status": "FAIL", "capped": True}
            if not (capped.get("feedback") or ""):
                capped["feedback"] = f"Max retries ({max_retries}) exceeded."
            return {"retry_count": current, "review_result": capped, "current_agent": "failed", "last_error": capped.get("feedback") or ""}
        return {"retry_count": current + 1, "current_agent": "retry"}

    return node


def final_node(state: Mapping[str, Any]) -> dict[str, Any]:
    """Deterministic formatter: no model call."""
    review = state.get("review_result") or {}
    status = review.get("status") if isinstance(review, Mapping) else None
    task = str(state.get("task") or "Task")
    plan = state.get("plan") or []
    execution = state.get("execution_results") or []
    research = state.get("research_results") or []

    if status == "FAIL":
        feedback = review.get("feedback") if isinstance(review, Mapping) else ""
        body_lines = ["The task could not be completed.", f"Reason: {feedback}"]
        title = "Task failed"
        body = "\n".join(body_lines)
        error = feedback or "Unknown failure"
    else:
        title = fmt_title(task)
        parts: list[str] = []
        if plan:
            parts.append("## Plan")
            for s in plan:
                parts.append(f"- [{s.get('agent')}] {s.get('description')}")
        if research:
            parts.append("## Research")
            for r in research:
                parts.append(r.get("summary") or "")
                srcs = r.get("sources")
                if srcs:
                    parts.append("Sources: " + ", ".join(srcs))
        if execution:
            parts.append("## Execution")
            for r in execution:
                parts.append(r.get("summary") or "")
        else:
            parts.append("_No execution steps were run._")
        body = "\n\n".join(parts)
        error = None

    final_answer: str = FINAL_FORMAT.format(title=title, body=body)
    update: dict[str, Any] = {
        "current_agent": "final",
        "final_answer": final_answer,
        "messages": [AIMessage(content=final_answer)],
    }
    if error is not None:
        update["last_error"] = error
    return update


def fmt_title(task: str) -> str:
    return "".join(ch if ch.isalnum() or ch in " _-" else " " for ch in task).strip()[:60] or "Task summary"


# ---------------------------------------------------------------------------
# Routing conditions
# ---------------------------------------------------------------------------


def router_condition(state: Mapping[str, Any]) -> str:
    """First pending plan step decides: research | execute | final (no work left)."""
    pending = _pending_step(state)
    if pending is None:
        return "final"
    _, step = pending
    return "research" if step.get("agent") == "research" else "execute"


def reviewer_condition(state: Mapping[str, Any]) -> str:
    review = state.get("review_result") or {}
    status = review.get("status") if isinstance(review, Mapping) else "FAIL"
    return "retry" if status == "RETRY" else "final"


def retry_route(state: Mapping[str, Any]) -> str:
    review = state.get("review_result") or {}
    if review.get("capped") or (review.get("status") if isinstance(review, Mapping) else None) == "FAIL":
        return "final"
    agent = review.get("retry_agent") if isinstance(review, Mapping) else None
    return "research" if agent == "research" else "execute"


# ---------------------------------------------------------------------------
# Graph assembly
# ---------------------------------------------------------------------------


def build_multi_agent_graph(
    *,
    engines: Mapping[str, RoleEngine] | None = None,
    max_retries: int = DEFAULT_MAX_RETRIES,
    checkpointer: BaseCheckpointSaver | None = None,
):
    """Compile the Multi-Agent ``StateGraph``.

    ``engines`` defaults to all four real role engines built from the app config;
    tests pass a mapping with deterministic/mock models.
    """
    graph = StateGraph(WorkGuidePlanState)

    planner = engines.get("planner") if engines else None
    research = engines.get("research") if engines else None
    execute = engines.get("execute") if engines else None
    reviewer = engines.get("reviewer") if engines else None

    graph.add_node("planner", planner_node(planner))
    graph.add_node("router", _passthrough_node("router"))
    graph.add_node("research", research_executor_node(research, step_agent="research"))
    graph.add_node("execute", research_executor_node(execute, step_agent="execute"))
    graph.add_node("reviewer", reviewer_node(reviewer))
    graph.add_node("retry", retry_node(max_retries=max_retries))
    graph.add_node("final", final_node)

    graph.add_edge(START, "planner")
    graph.add_edge("planner", "router")
    graph.add_conditional_edges("router", router_condition, {"research": "research", "execute": "execute", "final": "final"})
    graph.add_edge("research", "reviewer")
    graph.add_edge("execute", "reviewer")
    graph.add_conditional_edges("reviewer", reviewer_condition, {"retry": "retry", "final": "final"})
    graph.add_conditional_edges("retry", retry_route, {"research": "research", "execute": "execute", "final": "final"})

    return graph.compile(checkpointer=checkpointer)


def _passthrough_node(name: str):
    async def node(state: Mapping[str, Any]) -> dict[str, Any]:
        return {"current_agent": name}

    return node


def build_default_role_engines(app_config: AppConfig | None = None) -> dict[str, RoleEngine]:
    """Lazy production path: build real role engines from app config."""
    if app_config is None:
        from workguide.config.app_config import get_app_config

        app_config = get_app_config()
    return build_role_engines(app_config)


def make_multi_agent(config: RunnableConfig) -> Any:
    """LangGraph Server graph factory (mirrors ``make_lead_agent``'s ABI).

    Persistence is supplied by the server's configured checkpointer (see
    ``langgraph.json``), so the factory returns the compiled graph only.
    """
    from workguide.config.app_config import get_app_config

    app_config = get_app_config()
    engines = build_role_engines(app_config, model_name=(config.get("configurable") or {}).get("model_name"))
    return build_multi_agent_graph(engines=engines)


__all__ = [
    "build_multi_agent_graph",
    "build_default_role_engines",
    "make_multi_agent",
    "DEFAULT_MAX_RETRIES",
]