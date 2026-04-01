from __future__ import annotations

import hashlib
import json
import subprocess
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

import requests


ROOT = Path(__file__).resolve().parents[2]
CACHE_DIR = ROOT / 'data' / 'cache' / 'http'


def _normalize_for_cache(value: Any) -> Any:
    if isinstance(value, dict):
        return {str(key): _normalize_for_cache(value[key]) for key in sorted(value)}
    if isinstance(value, (list, tuple)):
        return [_normalize_for_cache(item) for item in value]
    if isinstance(value, bytes):
        return value.decode('utf-8')
    return value


def _cache_path(
    *,
    method: str,
    url: str,
    params: dict[str, Any] | None,
    data: str | bytes | None,
    cache_namespace: str,
) -> Path:
    cache_payload = {
        'method': method.upper(),
        'url': url,
        'params': _normalize_for_cache(params or {}),
        'data': _normalize_for_cache(data),
    }
    digest = hashlib.sha256(
        json.dumps(cache_payload, sort_keys=True, ensure_ascii=True).encode('utf-8'),
    ).hexdigest()
    return CACHE_DIR / cache_namespace / f'{digest}.json'


def _read_cached_text(path: Path, *, cache_ttl_hours: float | None) -> tuple[str | None, bool]:
    if not path.exists():
        return None, False

    try:
        payload = json.loads(path.read_text(encoding='utf-8'))
        body = payload.get('body')
        fetched_at_raw = payload.get('fetchedAt')
        if not isinstance(body, str) or not isinstance(fetched_at_raw, str):
            return None, False

        if cache_ttl_hours is None:
            return body, True

        fetched_at = datetime.fromisoformat(fetched_at_raw)
        expires_at = fetched_at + timedelta(hours=cache_ttl_hours)
        if expires_at >= datetime.now(timezone.utc):
            return body, True
        return body, False
    except Exception:  # noqa: BLE001
        return None, False


def _write_cached_text(path: Path, body: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        'fetchedAt': datetime.now(timezone.utc).isoformat(),
        'body': body,
    }
    path.write_text(json.dumps(payload, ensure_ascii=True), encoding='utf-8')


def fetch_text_with_curl_fallback(
    url: str,
    *,
    method: str = 'GET',
    params: dict[str, Any] | None = None,
    data: str | bytes | None = None,
    headers: dict[str, str] | None = None,
    timeout_seconds: float = 30.0,
    cache_namespace: str | None = None,
    cache_ttl_hours: float | None = None,
) -> str | None:
    cache_path = (
        _cache_path(
            method=method,
            url=url,
            params=params,
            data=data,
            cache_namespace=cache_namespace,
        )
        if cache_namespace
        else None
    )

    stale_cached_text: str | None = None
    if cache_path is not None:
        cached_text, is_fresh = _read_cached_text(cache_path, cache_ttl_hours=cache_ttl_hours)
        if cached_text is not None:
            if is_fresh:
                return cached_text
            stale_cached_text = cached_text

    request_headers = headers or {}
    try:
        response = requests.request(
            method=method.upper(),
            url=url,
            params=params,
            data=data,
            headers=request_headers,
            timeout=timeout_seconds,
        )
        response.raise_for_status()
        if cache_path is not None:
            _write_cached_text(cache_path, response.text)
        return response.text
    except Exception:  # noqa: BLE001
        command = ['curl', '-sS', '--fail', '--max-time', str(int(timeout_seconds))]
        if request_headers:
            for key, value in request_headers.items():
                command.extend(['-H', f'{key}: {value}'])
        if method.upper() == 'POST':
            command.extend(['-X', 'POST'])
        if params:
            command.append('--get')
            for key, value in params.items():
                command.extend(['--data-urlencode', f'{key}={value}'])
        if data is not None:
            command.extend(['--data-binary', '@-'])
        command.append(url)
        try:
            result = subprocess.run(
                command,
                input=data.decode('utf-8') if isinstance(data, bytes) else data,
                check=True,
                capture_output=True,
                text=True,
                timeout=timeout_seconds + 5,
            )
            if cache_path is not None:
                _write_cached_text(cache_path, result.stdout)
            return result.stdout
        except Exception:  # noqa: BLE001
            return stale_cached_text


def fetch_json_with_curl_fallback(
    url: str,
    *,
    method: str = 'GET',
    params: dict[str, Any] | None = None,
    data: str | bytes | None = None,
    headers: dict[str, str] | None = None,
    timeout_seconds: float = 30.0,
    cache_namespace: str | None = None,
    cache_ttl_hours: float | None = None,
) -> Any:
    text = fetch_text_with_curl_fallback(
        url,
        method=method,
        params=params,
        data=data,
        headers=headers,
        timeout_seconds=timeout_seconds,
        cache_namespace=cache_namespace,
        cache_ttl_hours=cache_ttl_hours,
    )
    if text is None:
        return None

    try:
        return json.loads(text)
    except json.JSONDecodeError:
        return None
