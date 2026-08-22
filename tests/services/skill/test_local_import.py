"""Local import of standard Agent / Claude skill packages."""

from __future__ import annotations

import io
import zipfile
from pathlib import Path

import pytest

from deeptutor.services.skill.local_import import (
    discover_skill_roots,
    import_skill_bytes,
    import_skill_path,
)
from deeptutor.services.skill.service import SkillImportError, SkillService


def _skill_md(name: str, description: str = "A test skill.") -> str:
    return (
        f"---\nname: {name}\ndescription: {description}\ntags: [imported]\n---\n\n"
        f"# {name}\n\nDo the thing.\n"
    )


def test_discover_single_and_multi(tmp_path: Path) -> None:
    single = tmp_path / "one"
    single.mkdir()
    (single / "SKILL.md").write_text(_skill_md("alpha"), encoding="utf-8")
    assert discover_skill_roots(single) == [single]

    bundle = tmp_path / "bundle"
    a = bundle / "alpha"
    b = bundle / "beta"
    a.mkdir(parents=True)
    b.mkdir(parents=True)
    (a / "SKILL.md").write_text(_skill_md("alpha"), encoding="utf-8")
    (b / "SKILL.md").write_text(_skill_md("beta"), encoding="utf-8")
    roots = discover_skill_roots(bundle)
    assert {r.name for r in roots} == {"alpha", "beta"}


def test_import_bare_skill_md(tmp_path: Path) -> None:
    svc = SkillService(root=tmp_path / "skills", builtin_root=None)
    outcomes = import_skill_bytes(
        _skill_md("hello-world").encode("utf-8"),
        filename="SKILL.md",
        service=svc,
    )
    assert len(outcomes) == 1
    assert outcomes[0].result.info.name == "hello-world"
    names = {s.name for s in svc.list_skills()}
    assert "hello-world" in names


def test_import_multi_skill_zip(tmp_path: Path) -> None:
    svc = SkillService(root=tmp_path / "skills", builtin_root=None)
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        zf.writestr("pack/alpha/SKILL.md", _skill_md("alpha"))
        zf.writestr("pack/beta/SKILL.md", _skill_md("beta"))
        zf.writestr("pack/beta/references/note.md", "extra\n")
    outcomes = import_skill_bytes(
        buf.getvalue(),
        filename="bundle.zip",
        service=svc,
    )
    assert {o.result.info.name for o in outcomes} == {"alpha", "beta"}
    assert (svc.root / "beta" / "references" / "note.md").is_file()


def test_import_path_directory(tmp_path: Path) -> None:
    svc = SkillService(root=tmp_path / "skills", builtin_root=None)
    src = tmp_path / "src" / "gamma"
    src.mkdir(parents=True)
    (src / "SKILL.md").write_text(_skill_md("gamma"), encoding="utf-8")
    outcomes = import_skill_path(src, service=svc)
    assert outcomes[0].result.info.name == "gamma"


def test_import_rejects_empty(tmp_path: Path) -> None:
    svc = SkillService(root=tmp_path / "skills", builtin_root=None)
    with pytest.raises(SkillImportError):
        import_skill_bytes(b"", filename="SKILL.md", service=svc)


def test_import_stamps_extra_and_cangjie_tags(tmp_path: Path) -> None:
    svc = SkillService(root=tmp_path / "skills", builtin_root=None)
    md = (
        "---\nname: cangjie-skill\ndescription: Engine.\ntags: []\n---\n\n# Cangjie\n"
    )
    outcomes = import_skill_bytes(
        md.encode("utf-8"),
        filename="SKILL.md",
        service=svc,
        extra_tags=["psych", "distilled"],
    )
    tags = set(outcomes[0].result.info.tags)
    assert "psych" in tags
    assert "distilled" in tags
    assert "cangjie" in tags  # auto from name
