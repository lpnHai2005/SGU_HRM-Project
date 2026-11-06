"""Áp migration 20261106 (lương/PC theo công, ca chuẩn 8h, OT đêm & trần 40h, kỷ luật).

Chạy: python scripts/apply_20261106_prorated_allowances.py [--period YYYY-MM]
Migration idempotent; chạy lại an toàn. --period: chạy lại đánh giá kỷ luật cho kỳ đó.
"""
import argparse
import os
import sys
from urllib.parse import urlsplit

import psycopg2
from dotenv import load_dotenv

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

BASE = os.path.dirname(__file__)
MIGRATION = os.path.join(BASE, "..", "migrations", "20261106_prorated_allowances_shift_ot_discipline.sql")

parser = argparse.ArgumentParser()
parser.add_argument("--period", help="Kỳ cần đánh giá kỷ luật đi trễ, ví dụ 2026-10")
args = parser.parse_args()

load_dotenv(os.path.join(BASE, "..", ".env"))
url = os.getenv("SYNC_DATABASE_URL")
if not url:
    raise SystemExit("SYNC_DATABASE_URL not found")
application_url = os.getenv("DATABASE_URL")
if not application_url:
    raise SystemExit("DATABASE_URL not found; no database connection was opened.")

# This helper is for the isolated TechZone Supabase Local container only.
# Never let a copied Cloud/team profile turn this local migration command into a remote write.
def _safe_target(database_url: str) -> tuple[str, int | None, str]:
    parsed = urlsplit(database_url)
    scheme = parsed.scheme.lower()
    if scheme not in {"postgres", "postgresql", "postgresql+psycopg2", "postgresql+asyncpg"}:
        raise ValueError("unsupported scheme")
    return (parsed.hostname or "").lower(), parsed.port, parsed.path.strip("/")


try:
    sync_target = _safe_target(url)
    app_target = _safe_target(application_url)
except ValueError:
    raise SystemExit("Safety guard: invalid PostgreSQL profile; no database connection was opened.")

if sync_target != app_target or not (
    sync_target[0] in {"localhost", "127.0.0.1", "::1"}
    and sync_target[1] == 55322
    and sync_target[2] == "postgres"
):
    raise SystemExit(
        "Safety guard: this migration script only allows Supabase Local at "
        "loopback:55322/postgres with DATABASE_URL and SYNC_DATABASE_URL aligned; "
        "no database connection was opened."
    )

conn = psycopg2.connect(url)
try:
    with conn, conn.cursor() as cur:
        with open(MIGRATION, encoding="utf-8") as f:
            cur.execute(f.read())
        print("Đã áp migration 20261106.")
        cur.execute("""SELECT shift_code, start_time, end_time, work_hours, break_minutes, planned_overtime_hours
                       FROM work_shifts ORDER BY shift_id""")
        for row in cur.fetchall():
            print("  ca:", row)
        if args.period:
            cur.execute("SELECT public.fn_evaluate_late_discipline(%s)", (args.period,))
            print(f"Kỳ {args.period}: {cur.fetchone()[0]} biên bản đi trễ đang hiệu lực.")
finally:
    conn.close()
