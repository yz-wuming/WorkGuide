"""Tests for runtime-added models (``models.runtime.yaml`` sidecar + API)."""

from __future__ import annotations

from fastapi import FastAPI
from fastapi.testclient import TestClient

import pytest

from app.gateway.routers import models as models_router
from workguide.config.app_config import AppConfig, reset_app_config
from workguide.config.authorization_config import AuthorizationConfig
from workguide.config.model_config import ModelConfig
from workguide.config.runtime_models import (
    PROVIDER_USE,
    add_runtime_model,
    build_runtime_entry,
    delete_runtime_model,
    load_runtime_models,
    update_runtime_model,
)
from workguide.config.sandbox_config import SandboxConfig
from workguide.config.token_usage_config import TokenUsageConfig


def _make_app_config(model_names: list[str]) -> AppConfig:
    return _make_app_config_with([(n, n) for n in model_names])


def _make_app_config_with(models: list[tuple[str, str]]) -> AppConfig:
    return AppConfig(
        models=[ModelConfig(name=n, model=m, use="langchain_openai:ChatOpenAI") for n, m in models],
        sandbox=SandboxConfig(use="workguide.sandbox.local:LocalSandboxProvider"),
        token_usage=TokenUsageConfig(enabled=False),
        authorization=AuthorizationConfig(),
    )


def _make_models_app(app_config: AppConfig) -> FastAPI:
    app = FastAPI()
    app.include_router(models_router.router)
    app.dependency_overrides[models_router.get_config] = lambda: app_config
    return app


def _config_file(tmp_path) -> str:
    """Create a minimal config.yaml and return its path (runtime sidecar sits beside it)."""
    p = tmp_path / "config.yaml"
    p.write_text(
        "models:\n"
        "  - name: base\n"
        "    use: langchain_openai:ChatOpenAI\n"
        "    model: base-model\n"
        "sandbox:\n"
        "  use: workguide.sandbox.local:LocalSandboxProvider\n"
        "token_usage:\n"
        "  enabled: false\n"
        "authorization:\n"
        "  enabled: false\n",
        encoding="utf-8",
    )
    return str(p)


# ── build_runtime_entry ────────────────────────────────────────────────


def test_build_entry_openai():
    entry = build_runtime_entry(
        name="my-gpt",
        provider="openai",
        model="gpt-4o",
        display_name="My GPT",
        api_base="https://api.openai.com/v1",
        api_key="sk-test",
        supports_thinking=True,
        max_tokens=4096,
        context_window=128000,
    )
    assert entry["use"] == "langchain_openai:ChatOpenAI"
    assert entry["api_base"] == "https://api.openai.com/v1"
    assert entry["api_key"] == "sk-test"
    assert entry["provider"] == "openai"
    assert entry["supports_thinking"] is True
    assert entry["max_tokens"] == 4096
    assert entry["context_window"] == 128000
    assert "base_url" not in entry


def test_build_entry_ollama_uses_base_url():
    entry = build_runtime_entry(name="local", provider="ollama", model="qwen2.5:3b")
    assert entry["use"] == "langchain_ollama:ChatOllama"
    assert entry["base_url"] == "http://localhost:11434"
    assert "api_base" not in entry


def test_build_entry_unknown_provider_raises():
    with pytest.raises(KeyError):
        build_runtime_entry(name="x", provider="not-a-provider", model="m")


def test_provider_allowlist_has_expected_keys():
    assert {"openai", "deepseek", "qwen", "zhipu", "anthropic", "ollama", "custom"} <= set(PROVIDER_USE)


# ── CRUD on the sidecar file ───────────────────────────────────────────


def test_crud_runtime_models(tmp_path):
    config_path = _config_file(tmp_path)
    sidecar = tmp_path / "models.runtime.yaml"
    entry = build_runtime_entry(name="m1", provider="deepseek", model="deepseek-chat", api_key="sk-1")

    add_runtime_model(entry, config_path=config_path)
    assert sidecar.exists()
    assert load_runtime_models(config_path) == [entry]

    updated = build_runtime_entry(name="m1", provider="deepseek", model="deepseek-reasoner", api_key="sk-2")
    update_runtime_model("m1", updated, config_path=config_path)
    assert load_runtime_models(config_path) == [updated]

    delete_runtime_model("m1", config_path=config_path)
    assert load_runtime_models(config_path) == []


def test_add_duplicate_raises(tmp_path):
    config_path = _config_file(tmp_path)
    entry = build_runtime_entry(name="m1", provider="openai", model="gpt-4o")
    add_runtime_model(entry, config_path=config_path)
    with pytest.raises(ValueError):
        add_runtime_model(entry, config_path=config_path)


def test_update_missing_raises(tmp_path):
    config_path = _config_file(tmp_path)
    with pytest.raises(KeyError):
        update_runtime_model("nope", build_runtime_entry(name="nope", provider="openai", model="gpt-4o"), config_path=config_path)


def test_delete_missing_raises(tmp_path):
    config_path = _config_file(tmp_path)
    with pytest.raises(KeyError):
        delete_runtime_model("nope", config_path=config_path)


def test_load_missing_file_returns_empty(tmp_path):
    config_path = _config_file(tmp_path)
    assert load_runtime_models(config_path) == []


# ── AppConfig merge ────────────────────────────────────────────────────


def test_app_config_merges_runtime_models(tmp_path, monkeypatch):
    config_path = tmp_path / "config.yaml"
    config_path.write_text(
        "models:\n"
        "  - name: base\n"
        "    use: langchain_openai:ChatOpenAI\n"
        "    model: base-model\n"
        "sandbox:\n"
        "  use: workguide.sandbox.local:LocalSandboxProvider\n"
        "token_usage:\n"
        "  enabled: false\n"
        "authorization:\n"
        "  enabled: false\n",
        encoding="utf-8",
    )
    add_runtime_model(
        build_runtime_entry(name="runtime-model", provider="deepseek", model="deepseek-chat"),
        config_path=config_path,
    )

    monkeypatch.setenv("WORKGUIDE_CONFIG_PATH", str(config_path))
    reset_app_config()
    try:
        cfg = AppConfig.from_file(str(config_path))
        names = [m.name for m in cfg.models]
        assert "base" in names
        assert "runtime-model" in names
        assert cfg.get_model_config("runtime-model") is not None
    finally:
        reset_app_config()
        monkeypatch.delenv("WORKGUIDE_CONFIG_PATH", raising=False)


# ── Router endpoints ───────────────────────────────────────────────────


@pytest.fixture
def runtime_env(tmp_path, monkeypatch):
    """Point the runtime models sidecar at a temp file and stub reload."""
    runtime_file = tmp_path / "models.runtime.yaml"
    monkeypatch.setattr(
        "workguide.config.runtime_models.runtime_models_path",
        lambda *a, **k: runtime_file,
    )
    monkeypatch.setattr(models_router, "reload_app_config", lambda *a, **k: None)
    return runtime_file


def _post_payload(**overrides):
    payload = {
        "name": "my-model",
        "provider": "deepseek",
        "model": "deepseek-chat",
        "api_base": "https://api.deepseek.com/v1",
        "api_key": "sk-test",
    }
    payload.update(overrides)
    return payload


def test_create_model(runtime_env, monkeypatch):
    app_config = _make_app_config(["base"])
    app = _make_models_app(app_config)
    monkeypatch.setattr(models_router, "get_app_config", lambda: _make_app_config(["base", "my-model"]))
    client = TestClient(app)

    resp = client.post("/api/models", json=_post_payload())
    assert resp.status_code == 201
    data = resp.json()
    assert data["name"] == "my-model"
    assert data["source"] == "runtime"
    assert data["provider"] == "deepseek"
    assert data["api_base"] == "https://api.deepseek.com/v1"
    assert data["has_api_key"] is True
    assert "api_key" not in data
    assert runtime_env.exists()


def test_create_model_duplicate(runtime_env, monkeypatch):
    app_config = _make_app_config(["base", "my-model"])
    app = _make_models_app(app_config)
    monkeypatch.setattr(models_router, "get_app_config", lambda: app_config)
    client = TestClient(app)

    resp = client.post("/api/models", json=_post_payload())
    assert resp.status_code == 409


def test_create_model_bad_provider(runtime_env, monkeypatch):
    app_config = _make_app_config(["base"])
    app = _make_models_app(app_config)
    monkeypatch.setattr(models_router, "get_app_config", lambda: app_config)
    client = TestClient(app)

    resp = client.post("/api/models", json=_post_payload(provider="evil"))
    assert resp.status_code == 422


def test_create_model_bad_name(runtime_env, monkeypatch):
    app_config = _make_app_config(["base"])
    app = _make_models_app(app_config)
    monkeypatch.setattr(models_router, "get_app_config", lambda: app_config)
    client = TestClient(app)

    resp = client.post("/api/models", json=_post_payload(name="bad name!"))
    assert resp.status_code == 422


def test_update_model_renames(runtime_env, monkeypatch):
    app_config = _make_app_config(["base"])
    app = _make_models_app(app_config)
    monkeypatch.setattr(
        models_router,
        "get_app_config",
        lambda: _make_app_config_with([("base", "base"), ("renamed", "deepseek-reasoner")]),
    )
    client = TestClient(app)

    add_runtime_model(build_runtime_entry(name="old", provider="deepseek", model="deepseek-chat"), config_path=runtime_env.parent)
    resp = client.put("/api/models/old", json=_post_payload(name="renamed", model="deepseek-reasoner"))
    assert resp.status_code == 200
    data = resp.json()
    assert data["name"] == "renamed"
    assert data["model"] == "deepseek-reasoner"
    loaded = load_runtime_models(runtime_env.parent)
    assert [m["name"] for m in loaded] == ["renamed"]


def test_update_model_missing(runtime_env, monkeypatch):
    app_config = _make_app_config(["base"])
    app = _make_models_app(app_config)
    monkeypatch.setattr(models_router, "get_app_config", lambda: app_config)
    client = TestClient(app)

    resp = client.put("/api/models/nope", json=_post_payload())
    assert resp.status_code == 404


def test_update_model_preserves_api_key(runtime_env, monkeypatch):
    app_config = _make_app_config(["base"])
    app = _make_models_app(app_config)
    monkeypatch.setattr(
        models_router,
        "get_app_config",
        lambda: _make_app_config_with([("base", "base"), ("m1", "deepseek-chat")]),
    )
    client = TestClient(app)

    add_runtime_model(
        build_runtime_entry(name="m1", provider="deepseek", model="deepseek-chat", api_key="sk-original"),
        config_path=runtime_env.parent,
    )
    payload = _post_payload(name="m1", model="deepseek-reasoner")
    payload.pop("api_key", None)
    resp = client.put("/api/models/m1", json=payload)
    assert resp.status_code == 200
    stored = load_runtime_models(runtime_env.parent)
    assert stored[0]["api_key"] == "sk-original"
    assert stored[0]["model"] == "deepseek-reasoner"


def test_delete_model(runtime_env):
    app_config = _make_app_config(["base"])
    app = _make_models_app(app_config)
    client = TestClient(app)

    add_runtime_model(build_runtime_entry(name="doomed", provider="openai", model="gpt-4o"), config_path=runtime_env.parent)
    resp = client.delete("/api/models/doomed")
    assert resp.status_code == 204
    assert load_runtime_models(runtime_env.parent) == []


def test_delete_model_missing(runtime_env):
    app_config = _make_app_config(["base"])
    app = _make_models_app(app_config)
    client = TestClient(app)

    resp = client.delete("/api/models/nope")
    assert resp.status_code == 404


def test_list_models_marks_runtime(runtime_env):
    app_config = _make_app_config(["base", "rt"])
    app = _make_models_app(app_config)
    client = TestClient(app)

    add_runtime_model(build_runtime_entry(name="rt", provider="openai", model="gpt-4o", api_key="sk-x"), config_path=runtime_env.parent)
    resp = client.get("/api/models")
    assert resp.status_code == 200
    by_name = {m["name"]: m for m in resp.json()["models"]}
    assert by_name["base"]["source"] == "config"
    assert by_name["rt"]["source"] == "runtime"
    assert by_name["rt"]["has_api_key"] is True
    assert "api_key" not in by_name["rt"]
