import base64
from binascii import Error as BinasciiError
from datetime import UTC, datetime, timedelta
import hashlib
import hmac
import json
import os
from typing import Any

PBKDF2_ALGORITHM = "pbkdf2_sha256"
PBKDF2_ITERATIONS = 260_000
JWT_ALGORITHM = 'HS256'


def hash_password(password: str) -> str:
    salt = os.urandom(16)
    password_hash = hashlib.pbkdf2_hmac(
        "sha256",
        password.encode("utf-8"),
        salt,
        PBKDF2_ITERATIONS,
    )
    return "$".join(
        [
            PBKDF2_ALGORITHM,
            str(PBKDF2_ITERATIONS),
            base64.b64encode(salt).decode("ascii"),
            base64.b64encode(password_hash).decode("ascii"),
        ]
    )


def verify_password(password: str, stored_hash: str) -> bool:
    try:
        algorithm, iterations, salt_b64, hash_b64 = stored_hash.split("$", 3)
        if algorithm != PBKDF2_ALGORITHM:
            return False

        salt = base64.b64decode(salt_b64.encode("ascii"))
        expected_hash = base64.b64decode(hash_b64.encode("ascii"))
        candidate_hash = hashlib.pbkdf2_hmac(
            "sha256",
            password.encode("utf-8"),
            salt,
            int(iterations),
        )
    except (BinasciiError, TypeError, ValueError):
        return False

    return hmac.compare_digest(candidate_hash, expected_hash)


class SessionTokenError(ValueError):
    pass


def create_session_token(
    user_id: str,
    secret_key: str,
    expires_minutes: int,
    *,
    now: datetime | None = None,
) -> str:
    issued_at = now or datetime.now(UTC)
    expires_at = issued_at + timedelta(minutes=expires_minutes)
    header = {'alg': JWT_ALGORITHM, 'typ': 'JWT'}
    payload = {
        'sub': user_id,
        'iat': int(issued_at.timestamp()),
        'exp': int(expires_at.timestamp()),
    }
    encoded_header = _encode_json_segment(header)
    encoded_payload = _encode_json_segment(payload)
    signing_input = f'{encoded_header}.{encoded_payload}'.encode('ascii')
    signature = hmac.new(
        secret_key.encode('utf-8'),
        signing_input,
        hashlib.sha256,
    ).digest()
    return f'{encoded_header}.{encoded_payload}.{_base64url_encode(signature)}'


def decode_session_token(
    token: str,
    secret_key: str,
    *,
    now: datetime | None = None,
) -> dict[str, Any]:
    try:
        encoded_header, encoded_payload, encoded_signature = token.split('.')
        header = json.loads(_base64url_decode(encoded_header))
        payload = json.loads(_base64url_decode(encoded_payload))
        provided_signature = _base64url_decode(encoded_signature)
    except (ValueError, TypeError, json.JSONDecodeError, UnicodeDecodeError) as exc:
        raise SessionTokenError('Session token tidak valid') from exc

    if header.get('alg') != JWT_ALGORITHM or header.get('typ') != 'JWT':
        raise SessionTokenError('Algoritma session token tidak valid')

    signing_input = f'{encoded_header}.{encoded_payload}'.encode('ascii')
    expected_signature = hmac.new(
        secret_key.encode('utf-8'),
        signing_input,
        hashlib.sha256,
    ).digest()
    if not hmac.compare_digest(provided_signature, expected_signature):
        raise SessionTokenError('Signature session token tidak valid')

    subject = payload.get('sub')
    expires_at = payload.get('exp')
    if not isinstance(subject, str) or not subject:
        raise SessionTokenError('Subject session token tidak valid')
    if not isinstance(expires_at, int):
        raise SessionTokenError('Masa berlaku session token tidak valid')

    current_time = now or datetime.now(UTC)
    if expires_at <= int(current_time.timestamp()):
        raise SessionTokenError('Session token sudah kedaluwarsa')

    return payload


def _encode_json_segment(value: dict[str, Any]) -> str:
    raw = json.dumps(value, separators=(',', ':'), sort_keys=True).encode('utf-8')
    return _base64url_encode(raw)


def _base64url_encode(value: bytes) -> str:
    return base64.urlsafe_b64encode(value).rstrip(b'=').decode('ascii')


def _base64url_decode(value: str) -> bytes:
    padding = '=' * (-len(value) % 4)
    try:
        return base64.urlsafe_b64decode(f'{value}{padding}'.encode('ascii'))
    except (BinasciiError, ValueError) as exc:
        raise SessionTokenError('Encoding session token tidak valid') from exc
