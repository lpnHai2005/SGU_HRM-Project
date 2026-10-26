"""Create a fresh, isolated loopback-only overtime workflow PostgreSQL fixture.

This intentionally refuses an existing database and never reads backend/.env.
"""

from __future__ import annotations

import os
import re
import sys
from ipaddress import ip_interface
from datetime import datetime, timedelta, time, timezone
from pathlib import Path

import bcrypt
import psycopg
from psycopg import sql


DATABASE = os.getenv("OT_MISSION9_TEST_DATABASE", "ot_cutover02_m9_full_e2e")
if not re.fullmatch(r"ot_cutover02_m9_[a-z0-9_]+", DATABASE):
    raise RuntimeError("OT_MISSION9_TEST_DATABASE must use the isolated ot_cutover02_m9_* namespace")
DATABASE_MARKER = "TECHZONE_MISSION9_SYNTHETIC_FIXTURE_20261020"
ROOT = Path(__file__).resolve().parents[1]
MAINTENANCE = "postgresql://postgres@127.0.0.1:5432/postgres"
MIGRATIONS = (
    "20261017_overtime_requests.sql",
    "20261018_overtime_request_notes.sql",
    "20261019_overtime_lifecycle.sql",
    "20261020_overtime_privilege_reconciliation.sql",
    "20261021_overtime_reconciliations.sql",
    "20261022_overtime_revocation_eligibility.sql",
    "20261023_overtime_reconciliation_exceptions.sql",
)


def require_loopback(connection: psycopg.Connection) -> None:
    database, address = connection.execute(
        "SELECT current_database(), inet_server_addr()::text"
    ).fetchone()
    if database != "postgres" or ip_interface(address).ip.is_loopback is not True:
        raise RuntimeError("Refusing setup outside local PostgreSQL maintenance DB")


def main() -> None:
    if sys.argv[1:] in (["--add-browser-schedule"], ["--add-manager-browser-schedule"]):
        target = f"postgresql://postgres@127.0.0.1:5432/{DATABASE}"
        with psycopg.connect(target) as connection:
            actual_db, actual_address = connection.execute(
                "SELECT current_database(), inet_server_addr()::text"
            ).fetchone()
            if actual_db != DATABASE or not ip_interface(actual_address).ip.is_loopback:
                raise RuntimeError("Refusing fixture schedule outside dedicated loopback DB")
            vn_today = (datetime.now(timezone.utc) + timedelta(hours=7)).date()
            day = vn_today + timedelta(days=17 if sys.argv[1] == "--add-manager-browser-schedule" else 9)
            start = datetime.combine(day, time(9), timezone(timedelta(hours=7)))
            end = datetime.combine(day, time(17), timezone(timedelta(hours=7)))
            connection.execute("""INSERT INTO work_schedules
                (employee_id,store_id,shift_id,work_date,starts_at,ends_at)
                SELECT 21,1,8,%s,%s,%s WHERE NOT EXISTS
                (SELECT 1 FROM work_schedules WHERE employee_id=21 AND work_date=%s)""",
                (day, start, end, day))
            connection.commit()
            print(f"LOCAL_SYNTHETIC_BROWSER_SCHEDULE={day}")
        return
    if sys.argv[1:] == ["--repair-email"]:
        target = f"postgresql://postgres@127.0.0.1:5432/{DATABASE}"
        with psycopg.connect(target) as connection:
            actual_db, actual_address = connection.execute(
                "SELECT current_database(), inet_server_addr()::text"
            ).fetchone()
            if actual_db != DATABASE or not ip_interface(actual_address).ip.is_loopback:
                raise RuntimeError("Refusing fixture repair outside dedicated loopback DB")
            connection.execute(
                "UPDATE users SET email = username || '@example.invalid' WHERE email IS NULL"
            )
            connection.commit()
            print("LOCAL_SYNTHETIC_EMAIL_FIXED")
        return
    with psycopg.connect(MAINTENANCE, autocommit=True) as maintenance:
        require_loopback(maintenance)
        exists = maintenance.execute(
            "SELECT 1 FROM pg_database WHERE datname = %s", (DATABASE,)
        ).fetchone()
        if exists:
            raise RuntimeError(f"Refusing existing database {DATABASE}; inspect it manually")
        maintenance.execute(sql.SQL("CREATE DATABASE {}").format(sql.Identifier(DATABASE)))
        maintenance.execute(sql.SQL("COMMENT ON DATABASE {} IS {}").format(
            sql.Identifier(DATABASE), sql.Literal(DATABASE_MARKER)))

    password = os.getenv("OT_MISSION9_TEST_PASSWORD", "OT9-local-synthetic-only!")
    password_hash = bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()
    target = f"postgresql://postgres@127.0.0.1:5432/{DATABASE}"
    with psycopg.connect(target) as connection:
        actual_db, actual_address = connection.execute(
            "SELECT current_database(), inet_server_addr()::text"
        ).fetchone()
        if actual_db != DATABASE or ip_interface(actual_address).ip.is_loopback is not True:
            raise RuntimeError("Refusing schema setup outside dedicated loopback DB")
        connection.execute((ROOT / "fixtures" / "overtime_workflow_schema.sql").read_text(encoding="utf-8"))
        for name in MIGRATIONS:
            connection.execute((ROOT / "migrations" / name).read_text(encoding="utf-8"))

        accounts = (
            (1, "ot9_admin", 99, 1), (2, "ot9_manager", 20, 3),
            (3, "ot9_employee", 21, 4), (4, "ot9_hr", 22, 2),
            (5, "ot9_outsider", 30, 4), (6, "ot9_second_hr", 23, 2),
        )
        for user_id, username, employee_id, role_id in accounts:
            connection.execute(
                "INSERT INTO users(user_id,username,password_hash,employee_id,email) VALUES(%s,%s,%s,%s,%s)",
                (user_id, username, password_hash, employee_id, f"{username}@example.invalid"),
            )
            connection.execute(
                "INSERT INTO user_roles(user_id,role_id) VALUES(%s,%s)",
                (user_id, role_id),
            )

        vn_today = (datetime.now(timezone.utc) + timedelta(hours=7)).date()
        work_day = vn_today + timedelta(days=5)
        conflict_day = work_day + timedelta(days=1)
        for employee_id, store_id in ((21, 1), (30, 2)):
            for day in (work_day, conflict_day, work_day + timedelta(days=4),
                        work_day + timedelta(days=8)):
                start = datetime.combine(day, time(9), timezone(timedelta(hours=7)))
                end = datetime.combine(day, time(17), timezone(timedelta(hours=7)))
                connection.execute(
                    """INSERT INTO work_schedules
                       (employee_id,store_id,shift_id,work_date,starts_at,ends_at)
                       VALUES(%s,%s,8,%s,%s,%s)""",
                    (employee_id, store_id, day, start, end),
                )
        connection.execute(
            "INSERT INTO leave_requests(employee_id,start_date,end_date,status) VALUES(21,%s,%s,'PENDING')",
            (conflict_day, conflict_day),
        )
        connection.commit()

        counts = connection.execute("""SELECT
            (SELECT count(*) FROM users), (SELECT count(*) FROM employees),
            (SELECT count(*) FROM work_schedules),
            (SELECT count(*) FROM overtime_requests)""").fetchone()
        print(f"LOCAL_SYNTHETIC_READY database={DATABASE} users={counts[0]} "
              f"employees={counts[1]} schedules={counts[2]} ot_requests={counts[3]} "
              f"work_day={work_day}")
        print("Migrations 20261020-20261023 were applied in dependency order on the "
              "loopback synthetic fixture; this is not evidence of Supabase Cloud ACLs.")


if __name__ == "__main__":
    main()
