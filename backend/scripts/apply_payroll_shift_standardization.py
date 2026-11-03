import os
import sys
import psycopg2
from dotenv import load_dotenv

sys.stdout.reconfigure(encoding='utf-8')

env_path = os.path.join(os.path.dirname(__file__), "..", ".env")
load_dotenv(env_path)
url = os.getenv("SYNC_DATABASE_URL")
if not url:
    raise ValueError(f"SYNC_DATABASE_URL not found in {env_path}")

migration_file = os.path.join(
    os.path.dirname(__file__), "..", "migrations", "20261104_standardize_payroll_shift_hours_and_unpaid_deductions.sql"
)

print(f"Reading migration file: {migration_file}...")
with open(migration_file, "r", encoding="utf-8") as f:
    sql_script = f.read()

print("Connecting to Supabase...")
conn = psycopg2.connect(url)
conn.autocommit = True
cur = conn.cursor()

print("Executing migration script on Supabase...")
cur.execute(sql_script)

print("Migration script executed successfully!")

# Verify columns in payrolls
cur.execute("""
    SELECT column_name, data_type, column_default 
    FROM information_schema.columns 
    WHERE table_name = 'payrolls' AND column_name IN ('daily_standard_hours', 'absent_days')
    ORDER BY column_name;
""")
print("\nVerifying payrolls columns:")
for row in cur.fetchall():
    print(f"  - {row[0]}: {row[1]} (default: {row[2]})")

# Verify functions and procedures
cur.execute("""
    SELECT proname, prokind 
    FROM pg_proc 
    WHERE proname IN ('fn_employee_daily_standard_hours', 'fn_sync_ot_reconciliation_to_approvals', 'sp_generate_monthly_payroll');
""")
print("\nVerifying procedures & functions:")
for row in cur.fetchall():
    kind = "FUNCTION" if row[1] == "f" else "PROCEDURE"
    print(f"  - {row[0]}: {kind}")

cur.close()
conn.close()
print("\nDatabase migration completed & verified!")

