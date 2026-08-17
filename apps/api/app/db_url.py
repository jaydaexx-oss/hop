"""Normalize DATABASE_URL schemes for SQLAlchemy + psycopg 3.

Fly.io `postgres attach` stores `postgres://`. SQLAlchemy 2 with psycopg 3
needs `postgresql+psycopg://`. Only the scheme is rewritten: split on the
first `://` and keep the remainder byte-for-byte so a password containing
`postgres://` cannot be corrupted.

Do not use `urllib.parse.urlsplit` / `urlunsplit` here. `urlsplit` treats a
later `://` in the password as a delimiter and would rewrite userinfo. Do not
`str.replace` the whole URL (`postgresql://` begins with `postgres://`).

This module never logs URLs or credentials.
"""

from __future__ import annotations

_PSYCOPG_SCHEME = "postgresql+psycopg"

_POSTGRES_SCHEMES = {
    "postgres": _PSYCOPG_SCHEME,
    "postgresql": _PSYCOPG_SCHEME,
    "postgresql+psycopg": _PSYCOPG_SCHEME,
}


def normalize_database_url(url: str, *, allow_sqlite: bool = True) -> str:
    """Return a SQLAlchemy URL, rewriting Postgres schemes only.

    sqlite is allowed when ``allow_sqlite`` is true (development/tests).
    Empty values, missing ``://``, and other schemes raise ValueError
    without including the URL or credentials in the message.
    """
    if url is None:
        raise ValueError("DATABASE_URL is empty")
    raw = url.strip()
    if not raw:
        raise ValueError("DATABASE_URL is empty")
    if "://" not in raw:
        raise ValueError("DATABASE_URL is missing a scheme")
    scheme, rest = raw.split("://", 1)
    scheme_key = scheme.lower()
    mapped = _POSTGRES_SCHEMES.get(scheme_key)
    if mapped is not None:
        return f"{mapped}://{rest}"
    if allow_sqlite and scheme_key.startswith("sqlite"):
        return raw
    raise ValueError("DATABASE_URL scheme is not supported")
