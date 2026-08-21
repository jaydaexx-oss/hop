#!/usr/bin/env python3
"""Inspect the local development Postgres. Never touches hop-uokqmg-db.

Does not copy production rows (including jaydae). Does not insert fake identity
keys — register throwaway handles such as `devtester` from the mobile app
against the local API instead.
"""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from sqlalchemy import text
from sqlmodel import Session

from app.config import (
    assert_development_database_is_not_production_fly,
    database_url_targets_production_fly,
    development_database_host_label,
    get_settings,
)
from app.db import get_engine


def main() -> int:
    settings = get_settings()
    if database_url_targets_production_fly(settings.database_url):
        print(
            "Refusing hop-uokqmg DATABASE_URL. Seed is local Postgres only.",
            file=sys.stderr,
        )
        return 2
    assert_development_database_is_not_production_fly(settings)
    host = development_database_host_label(settings.database_url)
    print(f"HOP seed DEV  env={settings.app_env}  database_host={host}  (not hop-uokqmg)")
    engine = get_engine()
    with Session(engine) as session:
        try:
            users = session.execute(text("SELECT count(*) FROM users")).scalar_one()
            print(f"users: {users}")
        except Exception as exc:
            print(f"users table not ready ({exc}). Run: alembic upgrade head", file=sys.stderr)
            return 1
    print(
        "Seed contents: empty users (working Alembic schema only). "
        "Do not copy production handles. Register throwaway accounts such as "
        "`devtester` / `devtester2` from the app against this local API."
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
