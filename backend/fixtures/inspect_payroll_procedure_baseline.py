"""Read-only snapshot of installed Payroll procedure for owner review.

No database URL, credentials, or row data are printed or written.
"""

from __future__ import annotations

import hashlib
from pathlib import Path

import psycopg

from app.core.config import settings


OUTPUT = Path(__file__).resolve().parent / "payroll_procedure_baseline_review.sql"


def main() -> None:
    try:
        with psycopg.connect(settings.SYNC_DATABASE_URL, autocommit=False) as connection:
            connection.execute("SET TRANSACTION READ ONLY")
            rows = connection.execute("""SELECT pg_get_functiondef(p.oid)
                FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
                WHERE n.nspname='public' AND p.proname='sp_generate_monthly_payroll'
                  AND p.prokind='p' AND p.pronargs=2""").fetchall()
            if len(rows) != 1:
                raise RuntimeError(f"Expected one installed Payroll procedure, found {len(rows)}")
            definition = rows[0][0]
            connection.rollback()
    except psycopg.Error:
        raise SystemExit("PAYROLL_BASELINE_BLOCKED: read-only connection failed; credentials were not printed") from None
    digest = hashlib.sha256(definition.encode("utf-8")).hexdigest()
    OUTPUT.write_text(
        "-- READ-ONLY captured procedure definition for local review. DO NOT APPLY.\n"
        f"-- SHA256: {digest}\n" + definition + "\n", encoding="utf-8"
    )
    print(f"PAYROLL_BASELINE_READ_ONLY sha256={digest} legacy_source="
          f"{'attendance_overtime_approvals' in definition} verified_source="
          f"{'v_overtime_verified_current' in definition}")


if __name__ == "__main__":
    main()
