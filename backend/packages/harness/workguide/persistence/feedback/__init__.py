"""Feedback persistence — ORM and SQL repository."""

from workguide.persistence.feedback.model import FeedbackRow
from workguide.persistence.feedback.sql import FeedbackRepository

__all__ = ["FeedbackRepository", "FeedbackRow"]
