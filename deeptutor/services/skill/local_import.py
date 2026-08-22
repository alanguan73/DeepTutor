"""Import standard Agent / Claude skill packages from local files.

Accepts a zip (one skill, or a folder of skills such as a cangjie-skill
delivery) or a bare ``SKILL.md``. Reuses the same install policy as hub
downloads (:meth:`SkillService.install_tree`) so local imports never bypass
``always`` stripping or the support-file whitelist.
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
import re
import shutil
import tempfile
from typing import Any

from .hub import _extract_skill_zip, _locate_package_root
from .service import (
    SkillExistsError,
    SkillImportError,
    SkillInstallResult,
    SkillService,
)

_MAX_UPLOAD_BYTES = 25 * 1024 * 1024
_DEFAULT_DESCRIPTION = "Imported skill package."
_FRONTMATTER_NAME_RE = re.compile(
    r"(?ms)^---\s*\n.*?^name:\s*[\"']?([^\n\"']+)[\"']?\s*$",
)


@dataclass(slots=True)
class LocalImportOutcome:
    """One successfully installed package from a local upload."""

    result: SkillInstallResult
    source_path: str


def discover_skill_roots(extracted: Path) -> list[Path]:
    """Locate skill package roots under an extracted archive or folder.

    Supports:

    * single package (``SKILL.md`` at root, or one wrapper dir);
    * multi-skill bundle (sibling dirs each with ``SKILL.md`` — cangjie output);
    * one wrapper containing multiple skill dirs (depth 2).
    """
    root = Path(extracted)
    if not root.is_dir():
        raise SkillImportError("Import source is not a directory.")

    if (root / "SKILL.md").is_file():
        return [root]

    depth1 = sorted(
        p for p in root.iterdir() if p.is_dir() and (p / "SKILL.md").is_file()
    )
    if depth1:
        return depth1

    depth2: list[Path] = []
    for wrapper in sorted(p for p in root.iterdir() if p.is_dir()):
        depth2.extend(
            sorted(
                q
                for q in wrapper.iterdir()
                if q.is_dir() and (q / "SKILL.md").is_file()
            )
        )
    if depth2:
        return depth2

    # Fall back to hub's single-package locator (clearer error if empty).
    return [_locate_package_root(root)]


def import_skill_bytes(
    payload: bytes,
    *,
    filename: str,
    service: SkillService,
    force: bool = False,
    extra_tags: list[str] | None = None,
    origin: dict[str, Any] | None = None,
) -> list[LocalImportOutcome]:
    """Import one or more skills from uploaded bytes.

    ``filename`` selects the shape: ``*.zip`` is extracted; anything else is
    treated as a single ``SKILL.md`` body.
    """
    raw = payload or b""
    if not raw:
        raise SkillImportError("Empty upload.")
    if len(raw) > _MAX_UPLOAD_BYTES:
        raise SkillImportError("Upload exceeds the 25 MB limit.")

    name = (filename or "skill.zip").strip() or "skill.zip"
    lower = name.lower()

    with tempfile.TemporaryDirectory(prefix="deeptutor-skill-import-") as tmp:
        tmp_path = Path(tmp)
        if lower.endswith(".zip"):
            zip_path = tmp_path / "package.zip"
            zip_path.write_bytes(raw)
            extracted = tmp_path / "extracted"
            _extract_skill_zip(zip_path, extracted)
            roots = discover_skill_roots(extracted)
        else:
            # Bare SKILL.md (or any markdown skill file).
            package = tmp_path / "package"
            package.mkdir()
            (package / "SKILL.md").write_bytes(raw)
            roots = [package]

        return _install_roots(
            roots,
            service=service,
            force=force,
            extra_tags=extra_tags,
            origin=origin
            or {
                "kind": "local",
                "filename": name,
            },
        )


def import_skill_path(
    source: str | Path,
    *,
    service: SkillService,
    force: bool = False,
    extra_tags: list[str] | None = None,
) -> list[LocalImportOutcome]:
    """Import from a local filesystem path (directory, zip, or SKILL.md)."""
    path = Path(source).expanduser().resolve()
    if not path.exists():
        raise SkillImportError(f"Path not found: {path}")

    if path.is_file() and path.suffix.lower() == ".zip":
        return import_skill_bytes(
            path.read_bytes(),
            filename=path.name,
            service=service,
            force=force,
            extra_tags=extra_tags,
            origin={"kind": "local", "filename": path.name, "path": str(path)},
        )

    if path.is_file():
        # Treat as SKILL.md content.
        return import_skill_bytes(
            path.read_bytes(),
            filename="SKILL.md",
            service=service,
            force=force,
            extra_tags=extra_tags,
            origin={"kind": "local", "filename": path.name, "path": str(path)},
        )

    # Directory: may be one skill or a multi-skill bundle.
    with tempfile.TemporaryDirectory(prefix="deeptutor-skill-import-") as tmp:
        staging = Path(tmp) / "copy"
        shutil.copytree(
            path,
            staging,
            ignore=shutil.ignore_patterns(
                ".git",
                "__pycache__",
                "node_modules",
                ".DS_Store",
            ),
        )
        roots = discover_skill_roots(staging)
        return _install_roots(
            roots,
            service=service,
            force=force,
            extra_tags=extra_tags,
            origin={"kind": "local", "path": str(path)},
        )


def _peek_package_name(root: Path) -> str:
    """Best-effort frontmatter ``name`` (falls back to directory name)."""
    skill_md = root / "SKILL.md"
    if skill_md.is_file():
        text = skill_md.read_text(encoding="utf-8", errors="replace")
        match = _FRONTMATTER_NAME_RE.search(text)
        if match:
            return match.group(1).strip()
    return root.name


def _resolve_import_tags(
    *,
    name: str | None,
    extra_tags: list[str] | None,
) -> list[str]:
    """Merge caller ``extra_tags`` and auto-stamp ``cangjie`` from the name."""
    resolved: list[str] = []
    seen: set[str] = set()
    for tag in list(extra_tags or []):
        cleaned = str(tag or "").strip()
        if cleaned and cleaned not in seen:
            seen.add(cleaned)
            resolved.append(cleaned)
    slug = (name or "").strip().lower()
    if "cangjie" in slug and "cangjie" not in seen:
        resolved.append("cangjie")
        seen.add("cangjie")
    return resolved


def _ensure_cangjie_tag(
    service: SkillService,
    result: SkillInstallResult,
) -> SkillInstallResult:
    """Post-install safety: stamp ``cangjie`` if the installed name implies it."""
    info = result.info
    if "cangjie" not in (info.name or "").lower():
        return result
    tags = list(info.tags or [])
    if "cangjie" in tags:
        return result
    updated = service.update(info.name, tags=[*tags, "cangjie"])
    return SkillInstallResult(info=updated, skipped=result.skipped)


def _install_roots(
    roots: list[Path],
    *,
    service: SkillService,
    force: bool,
    extra_tags: list[str] | None,
    origin: dict[str, Any],
) -> list[LocalImportOutcome]:
    if not roots:
        raise SkillImportError("No SKILL.md packages found.")

    outcomes: list[LocalImportOutcome] = []
    errors: list[str] = []
    for root in roots:
        try:
            peeked_name = _peek_package_name(root)
            merged_tags = _resolve_import_tags(
                name=peeked_name,
                extra_tags=extra_tags,
            )
            result = service.install_tree(
                root,
                force=force,
                fallback_description=_DEFAULT_DESCRIPTION,
                extra_tags=merged_tags,
                origin=origin,
            )
            result = _ensure_cangjie_tag(service, result)
            outcomes.append(
                LocalImportOutcome(result=result, source_path=root.name)
            )
        except SkillExistsError as exc:
            errors.append(f"{root.name}: already exists ({exc})")
        except SkillImportError as exc:
            errors.append(f"{root.name}: {exc}")
        except Exception as exc:  # noqa: BLE001 — surface per-package failures
            errors.append(f"{root.name}: {exc}")

    if not outcomes:
        raise SkillImportError(
            "No skills were imported. " + ("; ".join(errors) if errors else "")
        )
    return outcomes


__all__ = [
    "LocalImportOutcome",
    "discover_skill_roots",
    "import_skill_bytes",
    "import_skill_path",
]
