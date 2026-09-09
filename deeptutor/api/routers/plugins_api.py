"""Minimal plugins API kept for fork surfaces.

Upstream v1.6.6 removed the whole playground/plugins router. The psych
academy dashboard still executes the registered ``psych_timeline_summary``
tool over HTTP, so only the synchronous tool-execute endpoint is kept here;
the streaming playground endpoints died with the playground surface.
"""

import logging
from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from deeptutor.i18n.metadata_i18n import tool_description_i18n
from deeptutor.runtime.registry.capability_registry import get_capability_registry
from deeptutor.runtime.registry.tool_registry import get_tool_registry
from deeptutor.services.i18n import t

logger = logging.getLogger(__name__)

router = APIRouter()


def _discover_plugins() -> list[Any]:
    try:
        from deeptutor.plugins.loader import discover_plugins
    except Exception:
        logger.debug("Plugin loader unavailable; returning no plugins.", exc_info=True)
        return []
    return discover_plugins()


class ToolExecuteRequest(BaseModel):
    params: dict[str, Any] = Field(default_factory=dict)


@router.get("/list")
async def list_plugins():
    tool_registry = get_tool_registry()
    capability_registry = get_capability_registry()
    plugin_manifests = _discover_plugins()

    tools = [
        {
            "name": definition.name,
            "description": definition.description,
            "description_i18n": tool_description_i18n(definition.name, definition.description),
            "parameters": [
                {
                    "name": parameter.name,
                    "type": parameter.type,
                    "description": parameter.description,
                    "required": parameter.required,
                    "default": parameter.default,
                    "enum": parameter.enum,
                }
                for parameter in definition.parameters
            ],
        }
        for definition in tool_registry.get_definitions()
    ]

    return {
        "tools": tools,
        "capabilities": capability_registry.get_manifests(),
        "plugins": [
            {
                "name": plugin.name,
                "type": plugin.type,
                "description": plugin.description,
                "stages": plugin.stages,
                "version": plugin.version,
                "author": plugin.author,
            }
            for plugin in plugin_manifests
        ],
    }


@router.post("/tools/{tool_name}/execute")
async def execute_tool(tool_name: str, body: ToolExecuteRequest):
    """Execute a single tool with explicit parameters."""
    tool = get_tool_registry().get(tool_name)
    if not tool:
        raise HTTPException(status_code=404, detail=t("api.tool_not_found", name=tool_name))

    try:
        result = await tool.execute(**body.params)
        return {
            "success": result.success,
            "content": result.content,
            "sources": result.sources,
            "metadata": result.metadata,
        }
    except Exception as exc:
        logger.exception("Tool execution failed: %s", tool_name)
        raise HTTPException(status_code=500, detail=str(exc))
