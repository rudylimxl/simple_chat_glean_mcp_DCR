"""Always route user questions through Glean MCP."""

from __future__ import annotations

import re
from typing import Any, AsyncIterator

from mcp_client import GleanMcpClient

_METADATA_SPLIT = re.compile(r"\n---\n")


def _clean_response(text: str) -> str:
    return _METADATA_SPLIT.split(text, maxsplit=1)[0].strip()


def _build_chat_args(tool_name: str, user_message: str, history: list[dict[str, str]]) -> dict[str, Any]:
    if tool_name == "chat":
        context = [
            f"{m['role']}: {m['content']}"
            for m in history
            if m["role"] in ("user", "assistant") and m["content"].strip()
        ]
        args: dict[str, Any] = {"message": user_message}
        if context:
            args["context"] = context
        return args

    if tool_name in ("search", "glean_search"):
        return {"query": user_message}

    return {"message": user_message, "query": user_message}


async def handle_chat(
    mcp: GleanMcpClient,
    messages: list[dict[str, str]],
) -> AsyncIterator[dict[str, Any]]:
    user_messages = [m for m in messages if m["role"] == "user"]
    if not user_messages:
        yield {"type": "error", "content": "No user message provided."}
        return

    user_message = user_messages[-1]["content"].strip()
    if not user_message:
        yield {"type": "error", "content": "Empty message."}
        return

    prior = messages[:-1]
    tool_name = mcp.resolve_tool()

    args = _build_chat_args(tool_name, user_message, prior)
    yield {"type": "status", "content": "Asking Glean..."}
    yield {"type": "tool_call", "name": tool_name, "arguments": args}

    try:
        result = await mcp.call_tool(tool_name, args)
    except Exception as exc:
        yield {"type": "error", "content": f"MCP tool failed: {exc}"}
        return

    yield {"type": "tool_result", "name": tool_name, "content": result[:4000]}
    answer = _clean_response(result)
    yield {"type": "text", "content": answer}
