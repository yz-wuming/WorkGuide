"""Runtime-added models persisted in a sibling ``models.runtime.yaml``.

The Gateway's ``/api/models`` is otherwise read-only: the model list comes
from ``config.yaml`` at load time. This module gives the web UI a safe,
runtime-editable sidecar file (gitignored, never merged into the operator's
hand-written ``config.yaml``). ``AppConfig.from_file`` merges these entries
into ``models:`` before validation, so a runtime model is picked up by the
model allowlist, ``create_chat_model`` and the chat run path on the next
``get_app_config()`` call — no Gateway restart required (models are
hot-reloadable).

Security: the ``use`` class path is derived server-side from a fixed
provider allowlist, never taken from client input, so a user cannot point
``resolve_class`` at an arbitrary importable class.
"""

from __future__ import annotations

import errno
import logging
import os
import stat
import tempfile
import threading
from pathlib import Path
from typing import Any

import yaml

logger = logging.getLogger(__name__)

#: Sidecar file name, stored next to ``config.yaml``.
RUNTIME_MODELS_FILENAME = "models.runtime.yaml"

#: Frontend provider id -> model class path (allowlist). ``resolve_class``
#: imports the ``use`` path, so this MUST stay a fixed server-side map.
PROVIDER_USE: dict[str, str] = {
    "openai": "langchain_openai:ChatOpenAI",
    "deepseek": "workguide.models.patched_deepseek:PatchedChatDeepSeek",
    "qwen": "langchain_openai:ChatOpenAI",
    "zhipu": "langchain_openai:ChatOpenAI",
    "anthropic": "langchain_anthropic:ChatAnthropic",
    "ollama": "langchain_ollama:ChatOllama",
    "custom": "langchain_openai:ChatOpenAI",
}

#: Providers whose endpoint key is ``base_url`` (non-OpenAI-compatible).
BASE_URL_PROVIDERS: frozenset[str] = frozenset({"ollama"})

#: Default endpoint when a provider does not require one.
DEFAULT_BASE_URLS: dict[str, str] = {
    "ollama": "http://localhost:11434",
}

#: Serializes read-modify-write cycles on ``models.runtime.yaml`` across
#: concurrent requests (create/update/delete).
_lock = threading.Lock()


def runtime_models_path(config_path: Path | None = None) -> Path:
    """Resolve the runtime models file path (sibling of ``config.yaml``)."""
    from workguide.config.app_config import AppConfig

    base = config_path or AppConfig.resolve_config_path()
    return Path(base).parent / RUNTIME_MODELS_FILENAME


def load_runtime_models(config_path: Path | None = None) -> list[dict[str, Any]]:
    """Return the list of runtime model entries (empty when absent/invalid)."""
    path = runtime_models_path(config_path)
    if not path.exists():
        return []
    try:
        with open(path, encoding="utf-8") as f:
            data = yaml.safe_load(f) or {}
        models = data.get("models") or []
        return [m for m in models if isinstance(m, dict)]
    except Exception:
        logger.warning("Failed to load runtime models from %s", path, exc_info=True)
        return []


def save_runtime_models(models: list[dict[str, Any]], config_path: Path | None = None) -> None:
    """Atomically write the runtime models file, preserving file mode."""
    path = runtime_models_path(config_path)
    target_path = path.resolve(strict=False) if path.is_symlink() else path
    target_path.parent.mkdir(parents=True, exist_ok=True)

    existing_mode: int | None = None
    try:
        existing_mode = stat.S_IMODE(target_path.stat().st_mode)
    except FileNotFoundError:
        pass

    temporary_path: Path | None = None
    try:
        with tempfile.NamedTemporaryFile(
            mode="w",
            encoding="utf-8",
            dir=target_path.parent,
            prefix=f".{target_path.name}.",
            suffix=".tmp",
            delete=False,
        ) as temporary_file:
            temporary_path = Path(temporary_file.name)
            yaml.safe_dump({"models": models}, temporary_file, allow_unicode=True, sort_keys=False)
            if existing_mode is not None:
                temporary_path.chmod(existing_mode)
            temporary_file.flush()
            os.fsync(temporary_file.fileno())

        try:
            os.replace(temporary_path, target_path)
        except OSError as exc:
            if exc.errno != errno.EBUSY:
                raise
            # Bind-mounted file: kernel refuses rename over the mount point.
            with open(target_path, "w", encoding="utf-8") as f:
                f.write(temporary_path.read_text(encoding="utf-8"))
        _fsync_directory_best_effort(target_path.parent)
    finally:
        if temporary_path is not None:
            try:
                temporary_path.unlink(missing_ok=True)
            except OSError:
                logger.warning("Could not remove temporary runtime models file: %s", temporary_path, exc_info=True)


def _fsync_directory_best_effort(path: Path) -> None:
    try:
        fd = os.open(path, os.O_RDONLY)
    except OSError:
        return
    try:
        os.fsync(fd)
    except OSError:
        pass
    finally:
        os.close(fd)


def build_runtime_entry(
    *,
    name: str,
    provider: str,
    model: str,
    display_name: str | None = None,
    api_base: str | None = None,
    api_key: str | None = None,
    supports_thinking: bool = False,
    max_tokens: int | None = None,
    context_window: int | None = None,
) -> dict[str, Any]:
    """Build a config-compatible model entry from a validated request payload.

    ``provider`` is stored as UI metadata and excluded from the model
    constructor in ``create_chat_model``.
    """
    entry: dict[str, Any] = {
        "name": name,
        "use": PROVIDER_USE[provider],
        "model": model,
        "request_timeout": 600.0,
        "max_retries": 2,
        "provider": provider,
        "supports_thinking": bool(supports_thinking),
    }
    if display_name:
        entry["display_name"] = display_name
    if provider in BASE_URL_PROVIDERS:
        entry["base_url"] = api_base or DEFAULT_BASE_URLS.get(provider, "http://localhost:11434")
    elif api_base:
        entry["api_base"] = api_base
    if api_key:
        entry["api_key"] = api_key
    if max_tokens is not None:
        entry["max_tokens"] = int(max_tokens)
    if context_window is not None:
        entry["context_window"] = int(context_window)
    return entry


def add_runtime_model(entry: dict[str, Any], config_path: Path | None = None) -> list[dict[str, Any]]:
    """Append a runtime model entry (name must not already exist)."""
    with _lock:
        models = load_runtime_models(config_path)
        if any(m.get("name") == entry.get("name") for m in models):
            raise ValueError(f"Model {entry.get('name')!r} already exists in the runtime models")
        models.append(entry)
        save_runtime_models(models, config_path)
        return models


def update_runtime_model(
    name: str,
    entry: dict[str, Any],
    config_path: Path | None = None,
) -> list[dict[str, Any]]:
    """Replace the runtime model named ``name`` (renaming if ``entry`` has a new name)."""
    with _lock:
        models = load_runtime_models(config_path)
        idx = next((i for i, m in enumerate(models) if m.get("name") == name), None)
        if idx is None:
            raise KeyError(f"Runtime model {name!r} not found")
        new_name = entry.get("name")
        if new_name and new_name != name and any(m.get("name") == new_name for m in models):
            raise ValueError(f"Model {new_name!r} already exists in the runtime models")
        models[idx] = entry
        save_runtime_models(models, config_path)
        return models


def delete_runtime_model(name: str, config_path: Path | None = None) -> list[dict[str, Any]]:
    """Remove the runtime model named ``name``."""
    with _lock:
        models = load_runtime_models(config_path)
        remaining = [m for m in models if m.get("name") != name]
        if len(remaining) == len(models):
            raise KeyError(f"Runtime model {name!r} not found")
        save_runtime_models(remaining, config_path)
        return remaining
