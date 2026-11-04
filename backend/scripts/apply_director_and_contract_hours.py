import os
import sys
import psycopg2
from dotenv import load_dotenv

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

env_path = os.path.join(os.path.dirname(__file__), "..", ".env")
load_dotenv(env_path)
url = os.getenv("SYNC_DATABASE_URL")
if not url:
    raise ValueError("SYNC_DATABASE_URL not found")

print("Connecting to Supabase PostgreSQL...")
conn = psycopg2.connect(url)
conn.autocommit = True
cur = conn.cursor()

print("\n--- 1. KIỂM TRA BẢNG LƯƠNG GIÁM ĐỐC (TZ-DIR) KỲ 2026-10 ---")
cur.execute("""
    SELECT p.payroll_id, e.employee_code, e.full_name, pos.position_code,
           p.standard_working_days, p.actual_working_days, p.absent_days, p.daily_standard_hours,
           p.contract_salary, p.total_allowances, p.total_deductions, p.gross_income, p.net_salary
    FROM payrolls p
    JOIN employees e ON p.employee_id = e.employee_id
    JOIN positions pos ON e.position_id = pos.position_id
    WHERE e.employee_code = 'TZ-DIR' AND p.salary_period = '2026-10';
""")
row_dir = cur.fetchone()
print("Director row:", row_dir)

print("\n--- 2. KIỂM TRA CHI TIẾT KHOẢN MỤC CỦA GIÁM ĐỐC (TZ-DIR) ---")
if row_dir:
    pid = row_dir[0]
    cur.execute("""
        SELECT item_code, item_name, item_type, amount, calculation_formula
        FROM payroll_details WHERE payroll_id = %s
        ORDER BY detail_id;
    """, (pid,))
    for d in cur.fetchall():
        print(d)

print("\n--- 3. KIỂM TRA ĐỊNH MỨC GIỜ CỦA PHẠM QUỐC DŨNG (TZ-004) KỲ 2026-10 ---")
cur.execute("""
    SELECT p.payroll_id, e.employee_code, e.full_name,
           p.daily_standard_hours, p.contract_salary, p.actual_working_days, p.standard_working_days,
           p.gross_income, p.net_salary
    FROM payrolls p
    JOIN employees e ON p.employee_id = e.employee_id
    WHERE e.employee_code = 'TZ-004' AND p.salary_period = '2026-10';
""")
row_dung = cur.fetchone()
print("Dũng row:", row_dung)

print("\n--- 4. KIỂM TRA CHI TIẾT KHOẢN MỤC CỦA DŨNG (TZ-004) ---")
if row_dung:
    pid_d = row_dung[0]
    cur.execute("""
        SELECT item_code, item_name, item_type, amount, calculation_formula
        FROM payroll_details WHERE payroll_id = %s
        ORDER BY detail_id;
    """, (pid_d,))
    for d in cur.fetchall():
        print(d)

conn.close()
print("\nDone!")
