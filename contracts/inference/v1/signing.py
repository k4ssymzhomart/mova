"""Request signing for the Supabase <-> inference-service boundary (v1).

Both sides share a secret held in the Supabase Vault (and the service's env) — never in
the repo. The caller signs ``timestamp.body`` with HMAC-SHA256 and sends:

    X-Mova-Timestamp: <unix seconds>
    X-Mova-Signature: v1=<hex hmac>

The receiver recomputes the MAC, compares in constant time, and rejects stale timestamps
(replay protection). Pure stdlib so it runs anywhere with no dependencies.
"""

from __future__ import annotations

import hashlib
import hmac
import time

SIGNATURE_PREFIX = "v1="
DEFAULT_MAX_SKEW_SECONDS = 300


def _mac(secret: str, timestamp: int, body: bytes) -> str:
    msg = f"{timestamp}.".encode() + body
    return hmac.new(secret.encode(), msg, hashlib.sha256).hexdigest()


def sign(body: bytes, secret: str, timestamp: int | None = None) -> tuple[int, str]:
    """Return (timestamp, signature) for a request body."""
    ts = int(time.time()) if timestamp is None else int(timestamp)
    return ts, SIGNATURE_PREFIX + _mac(secret, ts, body)


def verify(
    body: bytes,
    secret: str,
    timestamp: int | str,
    signature: str,
    max_skew_seconds: int = DEFAULT_MAX_SKEW_SECONDS,
    now: int | None = None,
) -> bool:
    """Constant-time verify a signature and reject stale/forged requests."""
    try:
        ts = int(timestamp)
    except (TypeError, ValueError):
        return False
    current = int(time.time()) if now is None else int(now)
    if abs(current - ts) > max_skew_seconds:
        return False
    if not signature.startswith(SIGNATURE_PREFIX):
        return False
    expected = SIGNATURE_PREFIX + _mac(secret, ts, body)
    return hmac.compare_digest(expected, signature)


if __name__ == "__main__":
    # Self-test: a fresh signature verifies; a tampered body and a stale timestamp do not.
    secret = "test-secret"
    payload = b'{"task":"fog"}'
    ts, sig = sign(payload, secret)
    assert verify(payload, secret, ts, sig), "valid signature should verify"
    assert not verify(payload + b"x", secret, ts, sig), "tampered body must fail"
    assert not verify(payload, secret, ts, sig, now=ts + 10_000), "stale timestamp must fail"
    assert not verify(payload, "wrong", ts, sig), "wrong secret must fail"
    print("signing self-test: OK")
