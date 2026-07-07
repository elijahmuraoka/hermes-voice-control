from __future__ import annotations

import json
import urllib.error
import urllib.request
from dataclasses import dataclass
from urllib.parse import urlsplit, urlunsplit

from .adapters import HermesAdapter

MAX_TTS_TEXT_CHARS = 4000
HERMES_TTS_TIMEOUT_SECONDS = 20
HERMES_TTS_RESPONSE_MAX_BYTES = 16_000_000
MOCK_AUDIO_DATA_URL = (
    "data:audio/wav;base64,"
    "UklGRiQAAABXQVZFZm10IBAAAAABAAEAgD4AAAB9AAACABAAZGF0YQAAAAA="
)


class TtsUnavailableError(Exception):
    pass


class TtsTextTooLongError(Exception):
    pass


class TtsUpstreamError(Exception):
    pass


@dataclass(frozen=True)
class TtsResult:
    audio_data_url: str
    mime_type: str
    provider: str


def tts_available(adapter: HermesAdapter) -> bool:
    diagnostics = adapter.diagnostics()
    return (
        diagnostics.get("kind") == "api"
        and bool(diagnostics.get("available"))
        and bool(getattr(adapter, "token", ""))
    )


def _http_base_from_ws(api_url: str) -> str:
    parts = urlsplit(api_url)
    scheme = "https" if parts.scheme == "wss" else "http"
    path = parts.path
    if path.endswith("/api/ws"):
        path = path[: -len("/api/ws")]
    elif path.endswith("/ws"):
        path = path[: -len("/ws")]
    return urlunsplit((scheme, parts.netloc, path.rstrip("/"), "", ""))


def _mime_type_from_data_url(data_url: str) -> str:
    if not data_url.startswith("data:") or "," not in data_url:
        raise TtsUpstreamError("invalid audio response")
    header = data_url.split(",", 1)[0]
    mime_type = header.removeprefix("data:").split(";", 1)[0]
    if not mime_type.startswith("audio/"):
        raise TtsUpstreamError("invalid audio response")
    return mime_type


def _open_without_proxies(request: urllib.request.Request):
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    return opener.open(request, timeout=HERMES_TTS_TIMEOUT_SECONDS)


def _read_json_response(response) -> dict:
    raw = response.read(HERMES_TTS_RESPONSE_MAX_BYTES + 1)
    if len(raw) > HERMES_TTS_RESPONSE_MAX_BYTES:
        raise TtsUpstreamError("voice synthesis response too large")
    payload = json.loads(raw.decode("utf-8"))
    if not isinstance(payload, dict):
        raise TtsUpstreamError("voice synthesis failed")
    return payload


def synthesize_with_hermes(adapter: HermesAdapter, text: str) -> TtsResult:
    normalized = text.strip()
    if not normalized:
        raise TtsUnavailableError("empty text")
    if len(normalized) > MAX_TTS_TEXT_CHARS:
        raise TtsTextTooLongError("text too long")
    if not tts_available(adapter):
        diagnostics = adapter.diagnostics()
        provider = str(diagnostics.get("kind") or "mock")
        if provider != "mock":
            raise TtsUpstreamError("voice synthesis unavailable")
        return TtsResult(
            audio_data_url=MOCK_AUDIO_DATA_URL,
            mime_type="audio/wav",
            provider=provider,
        )

    api_url = str(getattr(adapter, "api_url", ""))
    token = str(getattr(adapter, "token", ""))
    endpoint = f"{_http_base_from_ws(api_url)}/api/audio/speak"
    body = json.dumps({"text": normalized}, separators=(",", ":")).encode("utf-8")
    request = urllib.request.Request(
        endpoint,
        data=body,
        method="POST",
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {token}",
        },
    )
    try:
        with _open_without_proxies(request) as response:
            payload = _read_json_response(response)
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError, OSError) as exc:
        raise TtsUpstreamError("voice synthesis failed") from exc

    data_url = payload.get("data_url")
    if not isinstance(data_url, str) or not data_url:
        raise TtsUpstreamError("voice synthesis failed")
    mime_type = _mime_type_from_data_url(data_url)
    return TtsResult(
        audio_data_url=data_url,
        mime_type=mime_type,
        provider="hermes",
    )
