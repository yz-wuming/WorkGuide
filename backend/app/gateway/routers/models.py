import asyncio
import logging
import re

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field

from app.gateway.authz import (
    _AuthorizationUnavailable,
    _is_internal_caller,
    resolve_model_authorization,
)
from app.gateway.deps import get_config, get_optional_user_from_request
from workguide.authz.provider import AuthzDecision, AuthzRequest
from workguide.config.app_config import AppConfig, get_app_config, reload_app_config
from workguide.config.runtime_models import (
    PROVIDER_USE,
    add_runtime_model,
    build_runtime_entry,
    delete_runtime_model,
    load_runtime_models,
    update_runtime_model,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api", tags=["models"])

_MODEL_NAME_RE = re.compile(r"^[A-Za-z0-9._-]+$")


class ModelResponse(BaseModel):
    """Response model for model information."""

    name: str = Field(..., description="Unique identifier for the model")
    model: str = Field(..., description="Actual provider model identifier")
    display_name: str | None = Field(None, description="Human-readable name")
    description: str | None = Field(None, description="Model description")
    supports_thinking: bool = Field(default=False, description="Whether model supports thinking mode")
    supports_reasoning_effort: bool = Field(default=False, description="Whether model supports reasoning effort")
    source: str = Field(
        default="config",
        description="Where the model is defined: 'config' (config.yaml) or 'runtime' (models.runtime.yaml)",
    )
    provider: str | None = Field(None, description="Provider id for runtime-added models")
    api_base: str | None = Field(None, description="Endpoint URL for runtime-added models")
    has_api_key: bool = Field(default=False, description="Whether an API key is configured (never returned in full)")


class ModelWriteRequest(BaseModel):
    """Request body for creating or updating a runtime model."""

    name: str = Field(..., min_length=1, max_length=128, description="Unique model identifier (model_name)")
    display_name: str | None = Field(None, max_length=128, description="Human-readable name")
    provider: str = Field(..., description="Provider id from the allowlist")
    model: str = Field(..., min_length=1, max_length=256, description="Actual provider model identifier")
    api_base: str | None = Field(None, max_length=512, description="OpenAI-compatible endpoint URL")
    api_key: str | None = Field(None, max_length=1024, description="API key (stored in models.runtime.yaml)")
    supports_thinking: bool = Field(default=False, description="Whether the model supports thinking mode")
    max_tokens: int | None = Field(None, gt=0, description="Per-call output cap")
    context_window: int | None = Field(None, gt=0, description="Total context capacity in tokens")


class TokenUsageResponse(BaseModel):
    """Token usage display configuration."""

    enabled: bool = Field(default=False, description="Whether token usage display is enabled")


class ModelsListResponse(BaseModel):
    """Response model for listing all models."""

    models: list[ModelResponse]
    token_usage: TokenUsageResponse


def _validate_model_name(name: str) -> None:
    if not _MODEL_NAME_RE.match(name):
        raise HTTPException(
            status_code=422,
            detail="模型标识只能包含字母、数字、点、下划线、连字符。",
        )


def _validate_write_request(req: ModelWriteRequest, config: AppConfig) -> None:
    _validate_model_name(req.name)
    if req.provider not in PROVIDER_USE:
        raise HTTPException(
            status_code=422,
            detail=f"不支持的提供方：{req.provider!r}（可选：{', '.join(sorted(PROVIDER_USE))}）",
        )
    if config.get_model_config(req.name) is not None:
        raise HTTPException(status_code=409, detail=f"模型 {req.name!r} 已存在（config.yaml 或运行时模型）。")
    if any(m.get("name") == req.name for m in load_runtime_models()):
        raise HTTPException(status_code=409, detail=f"模型 {req.name!r} 已存在于运行时模型。")


def _to_response(model, runtime: dict | None) -> ModelResponse:
    return ModelResponse(
        name=model.name,
        model=model.model,
        display_name=model.display_name,
        description=model.description,
        supports_thinking=model.supports_thinking,
        supports_reasoning_effort=model.supports_reasoning_effort,
        source="runtime" if runtime else "config",
        provider=runtime.get("provider") if runtime else None,
        api_base=(runtime.get("api_base") or runtime.get("base_url")) if runtime else None,
        has_api_key=bool(runtime and runtime.get("api_key")),
    )


@router.get(
    "/models",
    response_model=ModelsListResponse,
    summary="List All Models",
    description="Retrieve a list of all available AI models configured in the system.",
)
async def list_models(
    request: Request,
    config: AppConfig = Depends(get_config),
) -> ModelsListResponse:
    """List all available models from configuration.

    Returns model information suitable for frontend display,
    excluding sensitive fields like API keys and internal configuration.

    When ``authorization.enabled`` is true, only models the caller's role may
    ``list`` are returned (filtered via ``provider.filter_resources``). A
    provider error yields an empty list (fail-closed) or all models (fail-open).

    Returns:
        A list of all configured models with their metadata and token usage display settings.

    Example Response:
        ```json
        {
            "models": [
                {
                    "name": "gpt-4",
                    "model": "gpt-4",
                    "display_name": "GPT-4",
                    "description": "OpenAI GPT-4 model",
                    "supports_thinking": false,
                    "supports_reasoning_effort": false
                },
                {
                    "name": "claude-3-opus",
                    "model": "claude-3-opus",
                    "display_name": "Claude 3 Opus",
                    "description": "Anthropic Claude 3 Opus model",
                    "supports_thinking": true,
                    "supports_reasoning_effort": false
                }
            ],
            "token_usage": {
                "enabled": true
            }
        }
        ```
    """
    visible_models = config.models
    fail_closed = config.authorization.fail_closed

    user = await get_optional_user_from_request(request)
    if user is not None:
        try:
            provider, principal = resolve_model_authorization(user, is_internal=_is_internal_caller(request, user))
        except _AuthorizationUnavailable as exc:
            if exc.fail_closed:
                visible_models = []
        else:
            if provider is not None and principal is not None:
                try:
                    allowed_names = provider.filter_resources(principal, "model", [m.name for m in config.models])
                    if not isinstance(allowed_names, list) or any(not isinstance(n, str) for n in allowed_names):
                        raise TypeError("AuthorizationProvider.filter_resources must return list[str]")
                    allowed_set = set(allowed_names)
                    visible_models = [m for m in config.models if m.name in allowed_set]
                except Exception:
                    logger.warning("Authorization provider failed while filtering models", exc_info=True)
                    visible_models = [] if fail_closed else config.models

    runtime_by_name = {m.get("name"): m for m in load_runtime_models()}

    models = [
        _to_response(model, runtime_by_name.get(model.name))
        for model in visible_models
    ]
    return ModelsListResponse(
        models=models,
        token_usage=TokenUsageResponse(enabled=config.token_usage.enabled),
    )


@router.get(
    "/models/{model_name}",
    response_model=ModelResponse,
    summary="Get Model Details",
    description="Retrieve detailed information about a specific AI model by its name.",
)
async def get_model(
    model_name: str,
    request: Request,
    config: AppConfig = Depends(get_config),
) -> ModelResponse:
    """Get a specific model by name.

    Args:
        model_name: The unique name of the model to retrieve.

    Returns:
        Model information if found.

    Raises:
        HTTPException: 404 if model not found; 403 if the caller's role may not
        ``use`` the model (only when ``authorization.enabled`` is true). A
        provider resolution error yields 403 (fail-closed) or allows the request
        (fail-open), mirroring ``list_models``'s provider-error semantics.

    Example Response:
        ```json
        {
            "name": "gpt-4",
            "display_name": "GPT-4",
            "description": "OpenAI GPT-4 model",
            "supports_thinking": false
        }
        ```
    """
    model = config.get_model_config(model_name)
    if model is None:
        raise HTTPException(status_code=404, detail=f"Model '{model_name}' not found")

    # Phase 3: enforce model:use authorization (deny → 403, not 404, since the
    # model exists but the role lacks permission to use it).
    fail_closed = config.authorization.fail_closed
    user = await get_optional_user_from_request(request)
    if user is not None:
        try:
            provider, principal = resolve_model_authorization(user, is_internal=_is_internal_caller(request, user))
        except _AuthorizationUnavailable:
            if fail_closed:
                raise HTTPException(status_code=403, detail=f"Model '{model_name}' is not available for your role")
        else:
            if provider is not None and principal is not None:
                try:
                    decision = provider.authorize(AuthzRequest(principal=principal, resource="model", action="use", target=model_name))
                    if not isinstance(decision, AuthzDecision):
                        raise TypeError("AuthorizationProvider.authorize must return AuthzDecision")
                    allowed = decision.allow
                except Exception:
                    logger.warning(
                        "Authorization provider failed while checking model:use for %s",
                        model_name,
                        exc_info=True,
                    )
                    allowed = not fail_closed
                if not allowed:
                    raise HTTPException(status_code=403, detail=f"Model '{model_name}' is not available for your role")

    runtime = next((m for m in load_runtime_models() if m.get("name") == model_name), None)
    return _to_response(model, runtime)


@router.post(
    "/models",
    response_model=ModelResponse,
    status_code=201,
    summary="Create Runtime Model",
    description="Add a model at runtime (persisted to models.runtime.yaml, no restart required).",
)
async def create_model(
    body: ModelWriteRequest,
    request: Request,
    config: AppConfig = Depends(get_config),
) -> ModelResponse:
    """Create a runtime model and make it immediately usable for chat."""
    _validate_write_request(body, config)
    entry = build_runtime_entry(
        name=body.name,
        provider=body.provider,
        model=body.model,
        display_name=body.display_name,
        api_base=body.api_base,
        api_key=body.api_key,
        supports_thinking=body.supports_thinking,
        max_tokens=body.max_tokens,
        context_window=body.context_window,
    )
    await asyncio.to_thread(add_runtime_model, entry)
    reload_app_config()
    model = get_app_config().get_model_config(body.name)
    if model is None:
        raise HTTPException(status_code=500, detail="模型已写入但未能重新加载。")
    return _to_response(model, entry)


@router.put(
    "/models/{model_name}",
    response_model=ModelResponse,
    summary="Update Runtime Model",
    description="Update a runtime model (renames when body.name differs from the path).",
)
async def update_model(
    model_name: str,
    body: ModelWriteRequest,
    request: Request,
    config: AppConfig = Depends(get_config),
) -> ModelResponse:
    """Update an existing runtime model; the new name may differ (rename)."""
    _validate_model_name(model_name)
    if body.name != model_name and config.get_model_config(body.name) is not None:
        raise HTTPException(status_code=409, detail=f"模型 {body.name!r} 已存在（config.yaml 或运行时模型）。")
    if body.provider not in PROVIDER_USE:
        raise HTTPException(
            status_code=422,
            detail=f"不支持的提供方：{body.provider!r}（可选：{', '.join(sorted(PROVIDER_USE))}）",
        )
    # API Key 从不回传给前端；更新时未提供则保留已有 Key，避免误删。
    api_key = body.api_key
    if not api_key:
        existing = next((m for m in load_runtime_models() if m.get("name") == model_name), None)
        if existing:
            api_key = existing.get("api_key")
    entry = build_runtime_entry(
        name=body.name,
        provider=body.provider,
        model=body.model,
        display_name=body.display_name,
        api_base=body.api_base,
        api_key=api_key,
        supports_thinking=body.supports_thinking,
        max_tokens=body.max_tokens,
        context_window=body.context_window,
    )
    try:
        await asyncio.to_thread(update_runtime_model, model_name, entry)
    except KeyError:
        raise HTTPException(status_code=404, detail=f"运行时模型 {model_name!r} 不存在。") from None
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from None
    reload_app_config()
    model = get_app_config().get_model_config(body.name)
    if model is None:
        raise HTTPException(status_code=500, detail="模型已更新但未能重新加载。")
    return _to_response(model, entry)


@router.delete(
    "/models/{model_name}",
    status_code=204,
    summary="Delete Runtime Model",
    description="Remove a runtime model (config.yaml models cannot be deleted here).",
)
async def delete_model(
    model_name: str,
    request: Request,
    config: AppConfig = Depends(get_config),
) -> None:
    """Delete a runtime model by name."""
    _validate_model_name(model_name)
    try:
        await asyncio.to_thread(delete_runtime_model, model_name)
    except KeyError:
        raise HTTPException(status_code=404, detail=f"运行时模型 {model_name!r} 不存在。") from None
    reload_app_config()
