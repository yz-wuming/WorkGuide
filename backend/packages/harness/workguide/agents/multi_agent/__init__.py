"""WorkGuide Multi-Agent orchestration.

Planner -> Router -> Research/Executor -> Reviewer -> Retry/Final.

This is an **additive** layer on top of the existing Lead Agent architecture:
it reuses the project's model factory, tool registry and ``ThreadState`` while
introducing an explicit LangGraph ``StateGraph`` for role-based orchestration.
"""

from workguide.agents.multi_agent.graph import (
    DEFAULT_MAX_RETRIES,
    build_default_role_engines,
    build_multi_agent_graph,
    make_multi_agent,
)
from workguide.agents.multi_agent.runtime import RoleEngine, build_role_engines
from workguide.agents.multi_agent.state import (
    AgentResult,
    PlanStep,
    ReviewResult,
    WorkGuidePlanState,
    build_plan_step,
    build_result,
)

__all__ = [
    "build_multi_agent_graph",
    "build_default_role_engines",
    "build_role_engines",
    "make_multi_agent",
    "RoleEngine",
    "WorkGuidePlanState",
    "PlanStep",
    "AgentResult",
    "ReviewResult",
    "build_plan_step",
    "build_result",
    "DEFAULT_MAX_RETRIES",
]