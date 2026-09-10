"""
Stream Bus — compatibility shim for psych-academy
=================================================

Upstream removed this module after v1.5.13 (replaced by the turn-scoped
stream plumbing). psych-academy capabilities (companion / counsel /
intake / dual / whisper / distill) still import
``deeptutor.core.stream_bus.StreamBus``. Restored verbatim from
96d6df9e so ``psych_academy.api.asgi:app`` can import on the
ruogu ``deeptutor:8001`` image without forking psych-academy.
"""

from __future__ import annotations

import asyncio
from contextlib import asynccontextmanager
import json
from typing import Any, AsyncIterator

from .stream import StreamEvent, StreamEventType
from .trace import merge_trace_metadata


class StreamBus:
    """Fan-out async event bus for a single chat turn."""

    def __init__(self, *, max_history: int | None = None) -> None:
        self._subscribers: list[asyncio.Queue[StreamEvent | None]] = []
        self._closed = False
        self._history: list[StreamEvent] = []
        self._input_listeners: list[asyncio.Queue[str]] = []
        self._max_history = max_history

    async def emit(self, event: StreamEvent) -> None:
        if self._closed:
            return
        self._history.append(event)
        if self._max_history is not None and len(self._history) > self._max_history:
            del self._history[: len(self._history) - self._max_history]
        for q in self._subscribers:
            await q.put(event)

    async def subscribe(self) -> AsyncIterator[StreamEvent]:
        q: asyncio.Queue[StreamEvent | None] = asyncio.Queue()
        self._subscribers.append(q)
        replay_count = len(self._history)
        try:
            for event in self._history[:replay_count]:
                yield event
            if self._closed and q.empty():
                return
            while True:
                event = await q.get()
                if event is None:
                    break
                yield event
        finally:
            self._subscribers.remove(q)

    def mark_closed(self) -> None:
        self._closed = True
        for q in self._subscribers:
            q.put_nowait(None)

    async def close(self) -> None:
        self.mark_closed()

    @asynccontextmanager
    async def stage(
        self,
        name: str,
        source: str = "",
        metadata: dict[str, Any] | None = None,
    ):
        await self.emit(
            StreamEvent(
                type=StreamEventType.STAGE_START,
                source=source,
                stage=name,
                metadata=metadata or {},
            )
        )
        try:
            yield
        finally:
            await self.emit(
                StreamEvent(
                    type=StreamEventType.STAGE_END,
                    source=source,
                    stage=name,
                    metadata=metadata or {},
                )
            )

    async def content(
        self,
        text: str,
        source: str = "",
        stage: str = "",
        metadata: dict[str, Any] | None = None,
    ) -> None:
        await self.emit(
            StreamEvent(
                type=StreamEventType.CONTENT,
                source=source,
                stage=stage,
                content=text,
                metadata=metadata or {},
            )
        )

    async def thinking(
        self,
        text: str,
        source: str = "",
        stage: str = "",
        metadata: dict[str, Any] | None = None,
    ) -> None:
        await self.emit(
            StreamEvent(
                type=StreamEventType.THINKING,
                source=source,
                stage=stage,
                content=text,
                metadata=metadata or {},
            )
        )

    async def observation(
        self,
        text: str,
        source: str = "",
        stage: str = "",
        metadata: dict[str, Any] | None = None,
    ) -> None:
        await self.emit(
            StreamEvent(
                type=StreamEventType.OBSERVATION,
                source=source,
                stage=stage,
                content=text,
                metadata=metadata or {},
            )
        )

    async def tool_call(
        self,
        tool_name: str,
        args: dict[str, Any],
        source: str = "",
        stage: str = "",
        metadata: dict[str, Any] | None = None,
    ) -> None:
        await self.emit(
            StreamEvent(
                type=StreamEventType.TOOL_CALL,
                source=source,
                stage=stage,
                content=tool_name,
                metadata=merge_trace_metadata({"args": args}, metadata),
            )
        )

    async def tool_result(
        self,
        tool_name: str,
        result: str,
        source: str = "",
        stage: str = "",
        metadata: dict[str, Any] | None = None,
    ) -> None:
        await self.emit(
            StreamEvent(
                type=StreamEventType.TOOL_RESULT,
                source=source,
                stage=stage,
                content=result,
                metadata=merge_trace_metadata({"tool": tool_name}, metadata),
            )
        )

    async def progress(
        self,
        message: str,
        current: int = 0,
        total: int = 0,
        source: str = "",
        stage: str = "",
        metadata: dict[str, Any] | None = None,
    ) -> None:
        await self.emit(
            StreamEvent(
                type=StreamEventType.PROGRESS,
                source=source,
                stage=stage,
                content=message,
                metadata=merge_trace_metadata(
                    {"current": current, "total": total},
                    metadata,
                ),
            )
        )

    async def sources(
        self,
        sources: list[dict[str, Any]],
        source: str = "",
        stage: str = "",
        metadata: dict[str, Any] | None = None,
    ) -> None:
        await self.emit(
            StreamEvent(
                type=StreamEventType.SOURCES,
                source=source,
                stage=stage,
                metadata=merge_trace_metadata({"sources": sources}, metadata),
            )
        )

    async def result(
        self,
        data: dict[str, Any],
        source: str = "",
        metadata: dict[str, Any] | None = None,
    ) -> None:
        await self.emit(
            StreamEvent(
                type=StreamEventType.RESULT,
                source=source,
                metadata=merge_trace_metadata(data, metadata),
            )
        )

    async def error(
        self,
        message: str,
        source: str = "",
        stage: str = "",
        metadata: dict[str, Any] | None = None,
    ) -> None:
        await self.emit(
            StreamEvent(
                type=StreamEventType.ERROR,
                source=source,
                stage=stage,
                content=message,
                metadata=metadata or {},
            )
        )

    async def wait_for_input(
        self,
        prompt: str,
        source: str = "",
        stage: str = "",
        timeout: float | None = None,
    ) -> str:
        await self.emit(
            StreamEvent(
                type=StreamEventType.WAIT_FOR_INPUT,
                source=source,
                stage=stage,
                content=prompt,
            )
        )
        input_queue: asyncio.Queue[str] = asyncio.Queue()
        self._input_listeners.append(input_queue)
        try:
            return await asyncio.wait_for(input_queue.get(), timeout=timeout)
        except asyncio.TimeoutError:
            return ""
        finally:
            if input_queue in self._input_listeners:
                self._input_listeners.remove(input_queue)

    def submit_input(self, content: str) -> None:
        for q in self._input_listeners:
            q.put_nowait(content)
        self._input_listeners.clear()

    @staticmethod
    def event_to_json(event: StreamEvent) -> str:
        return json.dumps(event.to_dict(), ensure_ascii=False)


_bus_registry: dict[str, StreamBus] = {}


def register_bus(turn_id: str, bus: StreamBus) -> None:
    _bus_registry[turn_id] = bus


def unregister_bus(turn_id: str) -> None:
    _bus_registry.pop(turn_id, None)


def get_bus(turn_id: str) -> StreamBus | None:
    return _bus_registry.get(turn_id)
