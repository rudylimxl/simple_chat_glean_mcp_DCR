"""Glean MCP client — connects with a per-user OAuth access token."""

from __future__ import annotations

import json
import logging
from contextlib import AsyncExitStack
from dataclasses import dataclass
from typing import Any

from mcp import ClientSession
from mcp.client.streamable_http import streamablehttp_client

from config import settings

logger = logging.getLogger(__name__)


@dataclass
class ToolInfo:
    name: str
    description: str
    input_schema: dict[str, Any]


class GleanMcpClient:
    def __init__(self) -> None:
        self._stack = AsyncExitStack()
        self._session: ClientSession | None = None
        self._tools: list[ToolInfo] = []
        self._connected = False
        self._access_token: str | None = None

    def has_token(self, access_token: str) -> bool:
        return self._access_token == access_token

    def is_connected(self) -> bool:
        return self._connected

    async def connect(self, access_token: str | None = None) -> None:
        if self._connected:
            return
        if not settings.glean_mcp_url:
            raise RuntimeError("GLEAN_MCP_URL not configured")

        token = access_token or settings.glean_mcp_token
        if not token:
            raise RuntimeError("No access token — sign in first")

        headers = {"Authorization": f"Bearer {token}"}
        url = settings.glean_mcp_url.rstrip("/")
        logger.info("Connecting to MCP at %s", url)

        transport = await self._stack.enter_async_context(
            streamablehttp_client(
                url,
                headers=headers,
                timeout=60.0,
                sse_read_timeout=300.0,
            )
        )
        read_stream, write_stream, _ = transport
        self._session = await self._stack.enter_async_context(
            ClientSession(read_stream, write_stream)
        )
        await self._session.initialize()

        result = await self._session.list_tools()
        self._tools = [
            ToolInfo(
                name=tool.name,
                description=tool.description or "",
                input_schema=tool.inputSchema if isinstance(tool.inputSchema, dict) else {},
            )
            for tool in result.tools
        ]
        self._access_token = token
        self._connected = True
        logger.info("MCP connected — %d tools", len(self._tools))

    async def disconnect(self) -> None:
        await self._stack.aclose()
        self._stack = AsyncExitStack()
        self._session = None
        self._tools.clear()
        self._connected = False
        self._access_token = None

    def resolve_tool(self, preferred: str | None = None) -> str:
        names = {t.name for t in self._tools}
        candidates = [preferred or settings.mcp_tool, "chat", "search", "glean_search"]
        for name in candidates:
            if name and name in names:
                return name
        if self._tools:
            return self._tools[0].name
        raise RuntimeError("No MCP tools available")

    async def call_tool(self, name: str, arguments: dict[str, Any]) -> str:
        if not self._session:
            raise RuntimeError("MCP not connected")

        result = await self._session.call_tool(name, arguments=arguments)
        parts: list[str] = []
        for block in result.content:
            if hasattr(block, "text"):
                parts.append(block.text)
            else:
                parts.append(str(block))
        if parts:
            return "\n".join(parts)
        return json.dumps({"status": "ok", "isError": result.isError})

    def status(self) -> dict[str, Any]:
        return {
            "connected": self._connected,
            "tool_count": len(self._tools),
            "primary_tool": self.resolve_tool() if self._tools else None,
            "tools": [{"name": t.name, "description": t.description[:100]} for t in self._tools],
        }
