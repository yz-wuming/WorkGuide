"""State schema for the WorkGuide Multi-Agent (Planner/Router/Research/Executor/Reviewer) graph.

This is deliberately an **additive** extension of the existing :class:`ThreadState`
(all production fields, their reducers and the ``sandbox``/``thread_data``/``todos`` /
``messages`` channels are inherited unchanged) so the Multi-Agent graph can be
dropped into the same checkpointer / session / streaming pipeline the Lead Agent
already uses, without forking the original state.

Field ownership (who writes what):

* ``task``                 - injected at run start (Gateway / client).  Read-only for nodes.
* ``plan``                 - written only by the Planner node, replaced wholesale each pass.
* ``current_agent``        - written by every node for observability (not used for routing).
* ``research_results``     - written by the Research node.
* ``execution_results``    - written by the Executor node.
* ``review_result``        - written by the Reviewer node (and capped/finalized by Retry).
* ``retry_count``          - written only by the Retry node.
* ``final_answer``         - written only by the Final node.
* ``last_error``           - written by Retry on cap / Final on FAIL (informational).
"""

from __future__ import annotations

import uuid
from collections.abc import Sequence
from typing import Annotated, Any, NotRequired, TypedDict

from workguide.agents.thread_state import ThreadState


class PlanStep(TypedDict):
    """One unit of work produced by the Planner.

    ``agent`` routes the step to ``research`` or ``execute``.  ``dependencies``
    are declared by the Planner for future scheduling; v1 executes a single pass
    over the first pending step per Router call.
    """

    id: str
    description: str
    agent: str  # "research" | "execute"
    dependencies: NotRequired[list[str]]
    status: NotRequired[str]  # "pending" | "running" | "done" | "failed"


class AgentResult(TypedDict):
    """Structured output of a Research or Executor step (written to State)."""

    id: str
    step_id: NotRequired[str]
    agent: str  # "research" | "execute"
    summary: str
    detail: NotRequired[str]
    sources: NotRequired[list[str]]  # provenance for the Reviewer to judge quality
    succeeded: bool
    error: NotRequired[str]


class ReviewResult(TypedDict):
    """Reviewer verdict consumed by the conditional edge and the Retry node."""

    status: str  # "PASS" | "RETRY" | "FAIL"
    feedback: NotRequired[str]
    retry_agent: NotRequired[str]  # which agent a RETRY should re-run
    capped: NotRequired[bool]  # true when the Retry node hit max_retries


# ---------------------------------------------------------------------------
# Reducers
# ---------------------------------------------------------------------------


def _last_wins(existing: Any, new: Any) -> Any:
    """Last-value overwrite; ``None`` from a node means "did not touch it"."""
    return new if new is not None else existing


def merge_plan(existing: list[PlanStep] | None, new: list[PlanStep] | None) -> list[PlanStep] | None:
    """Planner replaces the whole plan on every pass (re-planning is expected)."""
    if new is None:
        return existing
    return new


def merge_results(existing: list[AgentResult] | None, new: list[AgentResult] | None) -> list[AgentResult]:
    """Accumulate role results across retries, keyed by ``id`` (dedupe, first-seen order)."""
    if not new:
        return existing or []
    merged: dict[str, AgentResult] = {}
    order: list[str] = []
    for entry in [*(existing or []), *new]:
        entry_id = entry["id"]
        if entry_id not in merged:
            order.append(entry_id)
        merged[entry_id] = entry
    return [merged[eid] for eid in order]


def build_plan_step(description: str, agent: str) -> PlanStep:
    """Create a ``PlanStep`` with a fresh id (used by determinstic tests too)."""
    return {"id": uuid.uuid4().hex[:8], "description": description, "agent": agent, "status": "pending"}


def build_result(agent: str, summary: str, *, step_id: str | None = None, succeeded: bool = True, error: str | None = None, sources: Sequence[str] | None = None) -> AgentResult:
    """Create an ``AgentResult`` with a fresh id."""
    return {
        "id": uuid.uuid4().hex[:8],
        "step_id": step_id,
        "agent": agent,
        "summary": summary,
        "sources": list(sources) if sources else None,
        "succeeded": succeeded,
        **({"error": error} if error else {}),
    }


class WorkGuidePlanState(ThreadState):
    """Extended state for the Multi-Agent graph. Additive to ``ThreadState``."""

    task: NotRequired[str | None]
    current_agent: NotRequired[str | None]
    plan: Annotated[list[PlanStep] | None, merge_plan]
    research_results: Annotated[list[AgentResult], merge_results]
    execution_results: Annotated[list[AgentResult], merge_results]
    review_result: Annotated[ReviewResult | None, _last_wins]
    retry_count: Annotated[int, _last_wins]
    final_answer: NotRequired[str | None]
    last_error: NotRequired[str | None]