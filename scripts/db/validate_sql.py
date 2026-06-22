#!/usr/bin/env python3
"""Validate every Supabase SQL artifact against the real PostgreSQL grammar.

This is a *syntactic* gate, not a live apply. It parses each migration, the seed,
and the pgTAP tests with libpg_query (the parser PostgreSQL itself uses, vendored
via ``pglast``), so a green run means the SQL is grammatically valid for Postgres
— without needing a running database, Docker, or the Supabase CLI.

It also validates ``supabase/config.toml`` as TOML.

Run:  python scripts/db/validate_sql.py
Exit: 0 if everything parses, 1 otherwise.

Install the one dependency in an isolated env if needed:
    python -m venv .venv-sqlcheck && .venv-sqlcheck/bin/pip install pglast
    .venv-sqlcheck/bin/python scripts/db/validate_sql.py
"""

from __future__ import annotations

import sys
import tomllib
from pathlib import Path

try:
    from pglast import parse_sql
    from pglast.parser import ParseError
except ModuleNotFoundError:  # pragma: no cover - guidance path
    sys.stderr.write(
        "pglast is required. Install it:\n"
        "  python -m venv .venv-sqlcheck && .venv-sqlcheck/bin/pip install pglast\n"
        "  .venv-sqlcheck/bin/python scripts/db/validate_sql.py\n"
    )
    raise SystemExit(2)

REPO = Path(__file__).resolve().parents[2]
SUPABASE = REPO / "supabase"


def _context(text: str, location: int) -> str:
    """A one-line window around a parser error cursor, with a caret."""
    if location is None or location < 0:
        return ""
    line_start = text.rfind("\n", 0, location) + 1
    line_end = text.find("\n", location)
    line_end = len(text) if line_end < 0 else line_end
    line_no = text.count("\n", 0, location) + 1
    snippet = text[line_start:line_end]
    caret = " " * (location - line_start) + "^"
    return f"    line {line_no}: {snippet}\n             {caret}"


def validate_sql_file(path: Path) -> str | None:
    """Return None on success, or an error string."""
    text = path.read_text(encoding="utf-8")
    if not text.strip():
        return None
    try:
        parse_sql(text)
    except ParseError as exc:
        loc = getattr(exc, "location", None)
        ctx = _context(text, loc) if loc is not None else ""
        return f"{exc}\n{ctx}" if ctx else str(exc)
    return None


def validate_toml_file(path: Path) -> str | None:
    try:
        tomllib.loads(path.read_text(encoding="utf-8"))
    except tomllib.TOMLDecodeError as exc:
        return str(exc)
    return None


def main() -> int:
    if not SUPABASE.exists():
        sys.stderr.write(f"no supabase/ directory at {SUPABASE}\n")
        return 1

    sql_files = sorted(
        [*(SUPABASE / "migrations").glob("*.sql")]
        + ([SUPABASE / "seed.sql"] if (SUPABASE / "seed.sql").exists() else [])
        + sorted((SUPABASE / "tests").glob("*.sql"))
    )

    failures = 0
    checked = 0
    for path in sql_files:
        checked += 1
        err = validate_sql_file(path)
        rel = path.relative_to(REPO)
        if err:
            failures += 1
            print(f"FAIL  {rel}\n    {err}")
        else:
            print(f"ok    {rel}")

    config = SUPABASE / "config.toml"
    if config.exists():
        checked += 1
        err = validate_toml_file(config)
        rel = config.relative_to(REPO)
        if err:
            failures += 1
            print(f"FAIL  {rel}\n    {err}")
        else:
            print(f"ok    {rel}")

    print(
        f"\n{checked - failures}/{checked} artifacts valid"
        f"  ({'all clean' if failures == 0 else f'{failures} FAILED'})"
    )
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
