from __future__ import annotations

from collections.abc import Mapping, Sequence

SECRET_KEYS = {"authorization", "cookie", "set-cookie", "x-api-key", "api_key", "apikey", "token", "access_token", "refresh_token", "gemini_token", "pin", "password", "secret", "session", "session_id", "client_secret"}


def redact(value):
    if isinstance(value, Mapping):
        result = {}
        for key, item in value.items():
            lowered = str(key).lower()
            if lowered in SECRET_KEYS or any(marker in lowered for marker in ("token", "secret", "password", "cookie", "pin")):
                result[key] = "[REDACTED]"
            else:
                result[key] = redact(item)
        return result
    if isinstance(value, Sequence) and not isinstance(value, (str, bytes, bytearray)):
        return [redact(item) for item in value]
    return value
