from __future__ import annotations

import os, secrets
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

@dataclass
class EphemeralToken:
    token: str
    expires_at: datetime
    mode: str

class GeminiTokenBroker:
    mode = "unknown"

    @property
    def api_key_configured(self) -> bool:
        return False

    def create_token(self) -> EphemeralToken:
        raise NotImplementedError

class MockGeminiTokenBroker(GeminiTokenBroker):
    mode = "mock"

    def create_token(self) -> EphemeralToken:
        return EphemeralToken("mock_gemini_ephemeral_" + secrets.token_urlsafe(18), datetime.now(UTC) + timedelta(minutes=5), "mock")

class RealGeminiTokenBroker(GeminiTokenBroker):
    mode = "real"

    @property
    def model(self) -> str:
        return os.getenv("HVC_GEMINI_MODEL", "gemini-2.5-flash-native-audio-latest")

    @property
    def api_key_configured(self) -> bool:
        return bool(os.getenv("GEMINI_API_KEY") or os.getenv("GOOGLE_API_KEY"))

    def create_token(self) -> EphemeralToken:
        api_key = os.getenv("GEMINI_API_KEY") or os.getenv("GOOGLE_API_KEY")
        if not api_key:
            raise RuntimeError("Gemini API key is not configured")
        try:
            from google import genai  # type: ignore
        except Exception as exc:
            raise RuntimeError("google-genai is not installed") from exc
        client = genai.Client(api_key=api_key, http_options={"api_version": "v1alpha"})
        expires_at = datetime.now(UTC) + timedelta(minutes=10)
        new_session_expires = datetime.now(UTC) + timedelta(seconds=60)
        token = client.auth_tokens.create(config={"uses": 1, "expire_time": expires_at.isoformat().replace("+00:00", "Z"), "new_session_expire_time": new_session_expires.isoformat().replace("+00:00", "Z"), "live_connect_constraints": {"model": self.model, "config": {"response_modalities": ["AUDIO"]}}})
        name = getattr(token, "name", None)
        if not name:
            raise RuntimeError("Gemini did not return an ephemeral token")
        return EphemeralToken(name, expires_at, "real")

def build_broker(mode: str) -> GeminiTokenBroker:
    return RealGeminiTokenBroker() if mode == "real" else MockGeminiTokenBroker()
