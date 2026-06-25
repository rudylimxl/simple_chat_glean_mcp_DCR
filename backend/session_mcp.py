"""Per-session MCP connections authenticated with OAuth tokens."""

from __future__ import annotations

import logging

from mcp_client import GleanMcpClient

logger = logging.getLogger(__name__)


class SessionMcpRegistry:
    def __init__(self) -> None:
        self._clients: dict[str, GleanMcpClient] = {}

    async def get(self, session_id: str, access_token: str) -> GleanMcpClient:
        existing = self._clients.get(session_id)
        if existing and existing.has_token(access_token) and existing.is_connected():
            return existing

        if existing:
            await existing.disconnect()

        client = GleanMcpClient()
        await client.connect(access_token=access_token)
        self._clients[session_id] = client
        return client

    async def remove(self, session_id: str) -> None:
        client = self._clients.pop(session_id, None)
        if client:
            await client.disconnect()

    async def disconnect_all(self) -> None:
        for session_id in list(self._clients):
            await self.remove(session_id)


session_mcp = SessionMcpRegistry()
