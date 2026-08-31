"""Pluggable fine-grained authorization (resource-level RBAC and beyond)."""

from workguide.authz.adapter import GuardrailAuthorizationAdapter
from workguide.authz.enforcement import filter_tools_by_authorization
from workguide.authz.principal import build_principal_from_context, normalize_authz_attributes
from workguide.authz.provider import AuthorizationProvider, AuthzDecision, AuthzReason, AuthzRequest, Principal
from workguide.authz.rbac import RbacAuthorizationProvider
from workguide.authz.runtime import resolve_authorization_provider
from workguide.authz.sandbox_authz import authorize_sandbox_execution
from workguide.authz.tool_filter import apply_tool_authorization

__all__ = [
    "AuthzDecision",
    "AuthzReason",
    "AuthzRequest",
    "AuthorizationProvider",
    "GuardrailAuthorizationAdapter",
    "Principal",
    "RbacAuthorizationProvider",
    "apply_tool_authorization",
    "authorize_sandbox_execution",
    "build_principal_from_context",
    "filter_tools_by_authorization",
    "normalize_authz_attributes",
    "resolve_authorization_provider",
]
