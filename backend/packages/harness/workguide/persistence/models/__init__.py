"""ORM model registration entry point.

Importing this module ensures all ORM models are registered with
``Base.metadata`` so Alembic autogenerate detects every table.

The actual ORM classes have moved to entity-specific subpackages:
- ``workguide.persistence.thread_meta``
- ``workguide.persistence.run``
- ``workguide.persistence.feedback``
- ``workguide.persistence.user``

``RunEventRow`` remains in ``workguide.persistence.models.run_event`` because
its storage implementation lives in ``workguide.runtime.events.store.db`` and
there is no matching entity directory.
"""

from workguide.persistence.agents.model import AgentRow
from workguide.persistence.channel_connections.model import (
    ChannelConnectionRow,
    ChannelConversationRow,
    ChannelCredentialRow,
    ChannelOAuthStateRow,
)
from workguide.persistence.feedback.model import FeedbackRow
from workguide.persistence.managed_subagents.model import ManagedSubagentRow
from workguide.persistence.mcp_tasks.model import McpTaskRow
from workguide.persistence.models.run_event import RunEventRow
from workguide.persistence.run.model import RunRow
from workguide.persistence.scheduled_task_runs.model import ScheduledTaskRunRow
from workguide.persistence.scheduled_tasks.model import ScheduledTaskRow
from workguide.persistence.subagent_batches.model import SubagentBatchItemRow, SubagentBatchRow
from workguide.persistence.thread_meta.model import ThreadMetaRow
from workguide.persistence.user.model import UserRow
from workguide.persistence.webhook_delivery.model import WebhookDeliveryRow

__all__ = [
    "AgentRow",
    "ChannelConnectionRow",
    "ChannelConversationRow",
    "ChannelCredentialRow",
    "ChannelOAuthStateRow",
    "FeedbackRow",
    "McpTaskRow",
    "ManagedSubagentRow",
    "RunEventRow",
    "RunRow",
    "ScheduledTaskRow",
    "ScheduledTaskRunRow",
    "SubagentBatchRow",
    "SubagentBatchItemRow",
    "ThreadMetaRow",
    "UserRow",
    "WebhookDeliveryRow",
]
