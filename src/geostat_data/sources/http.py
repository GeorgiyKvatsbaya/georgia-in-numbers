"""A polite HTTP client: sequential, throttled, retried. Geostat servers are fragile."""

from __future__ import annotations

import time
from typing import Any

import requests
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry


class PoliteClient:
    def __init__(self, base_url: str, delay: float = 0.2, timeout: int = 60) -> None:
        self.base_url = base_url.rstrip("/")
        self.delay = delay
        self.timeout = timeout
        self.session = requests.Session()
        retry = Retry(
            total=3,
            backoff_factor=1.0,
            status_forcelist=(502, 503, 504),
            allowed_methods=("GET",),
        )
        self.session.mount("https://", HTTPAdapter(max_retries=retry))
        self._last_call = 0.0

    def url(self, path: str) -> str:
        return f"{self.base_url}/{path.lstrip('/')}"

    def get(self, path: str, params: dict[str, Any] | None = None) -> requests.Response:
        wait = self.delay - (time.monotonic() - self._last_call)
        if wait > 0:
            time.sleep(wait)
        try:
            return self.session.get(self.url(path), params=params, timeout=self.timeout)
        finally:
            self._last_call = time.monotonic()

    def get_json(self, path: str, params: dict[str, Any] | None = None) -> Any:
        response = self.get(path, params)
        response.raise_for_status()
        return response.json()
