"""CLI tests for ``deeptutor skills import-package`` tag flags."""

from __future__ import annotations

from pathlib import Path

import pytest
from typer.testing import CliRunner

from deeptutor.services.skill.service import SkillService
from deeptutor_cli.main import app

runner = CliRunner()


def _write_skill(path: Path, name: str = "cli-skill") -> Path:
    path.write_text(
        f"---\nname: {name}\ndescription: CLI import.\ntags: []\n---\n\n# {name}\n",
        encoding="utf-8",
    )
    return path


def _patch_service(monkeypatch: pytest.MonkeyPatch, svc: SkillService) -> None:
    import deeptutor.services.skill.service as skill_service_mod

    monkeypatch.setattr(skill_service_mod, "get_skill_service", lambda: svc)


def test_import_package_defaults_psych_tags(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    svc = SkillService(root=tmp_path / "skills", builtin_root=None)
    _patch_service(monkeypatch, svc)
    src = _write_skill(tmp_path / "SKILL.md")

    result = runner.invoke(app, ["skills", "import-package", str(src)])
    assert result.exit_code == 0, result.stdout + result.stderr
    tags = set(svc.get_detail("cli-skill").tags)
    assert "psych" in tags
    assert "distilled" in tags


def test_import_package_no_psych_and_repeatable_tags(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    svc = SkillService(root=tmp_path / "skills", builtin_root=None)
    _patch_service(monkeypatch, svc)

    src = _write_skill(tmp_path / "SKILL.md", name="tagged")
    result = runner.invoke(
        app,
        [
            "skills",
            "import-package",
            str(src),
            "--no-psych",
            "--tag",
            "alpha",
            "--tag",
            "beta",
        ],
    )
    assert result.exit_code == 0, result.stdout + result.stderr
    tags = set(svc.get_detail("tagged").tags)
    assert "psych" not in tags
    assert "distilled" not in tags
    assert "alpha" in tags
    assert "beta" in tags
