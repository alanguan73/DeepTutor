"""API tests for ``POST /api/v1/skills/import-package`` tag options."""

from __future__ import annotations

import importlib

import pytest

try:
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
except Exception:  # pragma: no cover
    FastAPI = None
    TestClient = None

pytestmark = pytest.mark.skipif(
    FastAPI is None or TestClient is None, reason="fastapi not installed"
)

from deeptutor.services.skill.service import SkillService


def _skill_md(name: str = "hello-world") -> bytes:
    return (
        f"---\nname: {name}\ndescription: A test skill.\ntags: []\n---\n\n"
        f"# {name}\n\nDo the thing.\n"
    ).encode("utf-8")


def _build_app() -> FastAPI:
    router = importlib.import_module("deeptutor.api.routers.skills").router
    app = FastAPI()
    app.include_router(router, prefix="/api/v1/skills")
    return app


def _client(
    tmp_path, monkeypatch: pytest.MonkeyPatch
) -> tuple[TestClient, SkillService]:
    svc = SkillService(root=tmp_path / "skills", builtin_root=None)
    monkeypatch.setattr(
        "deeptutor.api.routers.skills.get_skill_service",
        lambda: svc,
    )
    return TestClient(_build_app()), svc


def test_import_package_defaults_to_psych_tags(tmp_path, monkeypatch: pytest.MonkeyPatch) -> None:
    client, svc = _client(tmp_path, monkeypatch)
    resp = client.post(
        "/api/v1/skills/import-package",
        files={"file": ("SKILL.md", _skill_md(), "text/markdown")},
        data={"force": "false"},
    )
    assert resp.status_code == 200, resp.text
    tags = set(svc.get_detail("hello-world").tags)
    assert "psych" in tags
    assert "distilled" in tags


def test_import_package_extra_tags_and_no_psych(
    tmp_path, monkeypatch: pytest.MonkeyPatch
) -> None:
    client, svc = _client(tmp_path, monkeypatch)
    resp = client.post(
        "/api/v1/skills/import-package",
        files={"file": ("SKILL.md", _skill_md("tagged-skill"), "text/markdown")},
        data={
            "force": "false",
            "as_psych": "false",
            "extra_tags": "custom, academy",
        },
    )
    assert resp.status_code == 200, resp.text
    tags = set(svc.get_detail("tagged-skill").tags)
    assert "psych" not in tags
    assert "distilled" not in tags
    assert "custom" in tags
    assert "academy" in tags


def test_import_package_psych_plus_extra_tags(
    tmp_path, monkeypatch: pytest.MonkeyPatch
) -> None:
    client, svc = _client(tmp_path, monkeypatch)
    resp = client.post(
        "/api/v1/skills/import-package",
        files={"file": ("SKILL.md", _skill_md("combo"), "text/markdown")},
        data={
            "as_psych": "true",
            "extra_tags": "lab",
        },
    )
    assert resp.status_code == 200, resp.text
    tags = set(svc.get_detail("combo").tags)
    assert {"psych", "distilled", "lab"} <= tags
