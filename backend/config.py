import secrets

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    glean_mcp_url: str = ""
    glean_mcp_token: str = ""
    mcp_tool: str = "chat"

    frontend_url: str = "http://localhost:5174"
    oauth_redirect_uri: str = "http://localhost:8001/api/auth/callback"
    oauth_client_name: str = "MCP Chatbot"
    session_secret: str = secrets.token_urlsafe(32)

    host: str = "0.0.0.0"
    port: int = 8001


settings = Settings()
