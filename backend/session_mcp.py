"""Per-session MCP connections authenticated with OAuth tokens."""

from __future__ import annotations

from mcp_client import GleanMcpClient


class SessionMcpRegistry:
    def __init__(self) -> None:
        self._clients: dict[str, GleanMcpClient] = {}

    async def get(self, session_id: str, access_token: str, mcp_url: str) -> GleanMcpClient:
        existing = self._clients.get(session_id)
        if (
            existing
            and existing.has_token(access_token)
            and existing.has_mcp_url(mcp_url)
            and existing.is_connected()
        ):
            return existing

        if existing:
            await existing.disconnect()

        client = GleanMcpClient()
        await client.connect(access_token=access_token, mcp_url=mcp_url)
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
