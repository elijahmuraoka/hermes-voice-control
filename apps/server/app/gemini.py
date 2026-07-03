from __future__ import annotations

import os, secrets
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

@dataclass
class EphemeralToken:
    token: str
    expires_at: datetime
    mode: str
    model: str | None = None
    voice_name: str | None = None

def google_genai_available() -> bool:
    try:
        from google import genai  # type: ignore # noqa: F401
    except Exception:
        return False
    return True

class GeminiTokenBroker:
    mode = "unknown"

    @property
    def api_key_configured(self) -> bool:
        return False

    @property
    def client_available(self) -> bool:
        return False

    def create_token(self) -> EphemeralToken:
        raise NotImplementedError

class MockGeminiTokenBroker(GeminiTokenBroker):
    mode = "mock"
    model = "gemini-2.5-flash-native-audio-latest"
    voice_name = "Charon"

    @property
    def client_available(self) -> bool:
        return True

    def create_token(self) -> EphemeralToken:
        return EphemeralToken(
            "mock_gemini_ephemeral_" + secrets.token_urlsafe(18),
            datetime.now(UTC) + timedelta(minutes=5),
            "mock",
            self.model,
            self.voice_name,
        )

class RealGeminiTokenBroker(GeminiTokenBroker):
    mode = "real"

    @property
    def model(self) -> str:
        return os.getenv("HVC_GEMINI_MODEL", "gemini-2.5-flash-native-audio-latest")

    @property
    def voice_name(self) -> str:
        return os.getenv("HVC_GEMINI_VOICE_NAME", "Charon")

    @property
    def api_key_configured(self) -> bool:
        return bool(os.getenv("GEMINI_API_KEY") or os.getenv("GOOGLE_API_KEY"))

    @property
    def client_available(self) -> bool:
        return google_genai_available()

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
        live_config = {
            "response_modalities": ["AUDIO"],
            "speech_config": {
                "voice_config": {
                    "prebuilt_voice_config": {"voice_name": self.voice_name}
                }
            },
        }
        token = client.auth_tokens.create(
            config={
                "uses": 1,
                "expire_time": expires_at.isoformat().replace("+00:00", "Z"),
                "new_session_expire_time": new_session_expires.isoformat().replace("+00:00", "Z"),
                "live_connect_constraints": {
                    "model": self.model,
                    "config": live_config,
                },
                # Empty means lock the non-null model/audio/voice fields while
                # still allowing the browser to add transcription and tools.
                "lock_additional_fields": [],
            }
        )
        name = getattr(token, "name", None)
        if not name:
            raise RuntimeError("Gemini did not return an ephemeral token")
        return EphemeralToken(name, expires_at, "real", self.model, self.voice_name)

def build_broker(mode: str) -> GeminiTokenBroker:
    return RealGeminiTokenBroker() if mode == "real" else MockGeminiTokenBroker()
