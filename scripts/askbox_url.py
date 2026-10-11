"""Normalización de la URL base del gateway askbox (panel / install.sh)."""
from __future__ import annotations

from urllib.parse import urlparse


def normalize_askbox_api_url(raw: str) -> str:
    """Strip trailing slash; añade ``/api`` si el path no termina ya en ``/api``."""
    text = raw.strip().rstrip("/")
    if not text:
        return ""
    parsed = urlparse(text)
    if not parsed.scheme or not parsed.netloc:
        return text
    path = (parsed.path or "").rstrip("/")
    if not path:
        return f"{parsed.scheme}://{parsed.netloc}/api"
    if path.endswith("/api"):
        return text
    return f"{text}/api"
