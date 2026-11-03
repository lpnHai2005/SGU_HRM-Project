import os
import sys

sys.stdout.reconfigure(encoding='utf-8')

# 1. Update schemas.py
schemas_path = os.path.join(os.path.dirname(__file__), "..", "app", "schemas", "schemas.py")
with open(schemas_path, "r", encoding="utf-8") as f:
    content = f.read()

target = "    unpaid_leave_days: Optional[float] = 0.0\n    unworked_hours: Optional[float] = 0.0"
target_crlf = "    unpaid_leave_days: Optional[float] = 0.0\r\n    unworked_hours: Optional[float] = 0.0"

replacement = "    unpaid_leave_days: Optional[float] = 0.0\n    absent_days: Optional[float] = 0.0\n    daily_standard_hours: Optional[float] = 8.0\n    unworked_hours: Optional[float] = 0.0"
replacement_crlf = "    unpaid_leave_days: Optional[float] = 0.0\r\n    absent_days: Optional[float] = 0.0\r\n    daily_standard_hours: Optional[float] = 8.0\r\n    unworked_hours: Optional[float] = 0.0"

if target_crlf in content:
    content = content.replace(target_crlf, replacement_crlf, 1)
    print("Updated schemas.py (CRLF)")
elif target in content:
    content = content.replace(target, replacement, 1)
    print("Updated schemas.py (LF)")
else:
    print("schemas.py already updated or target not found")

with open(schemas_path, "w", encoding="utf-8") as f:
    f.write(content)

# 2. Update payrolls.py
payrolls_path = os.path.join(os.path.dirname(__file__), "..", "app", "api", "v1", "endpoints", "payrolls.py")
with open(payrolls_path, "r", encoding="utf-8") as f:
    p_content = f.read()

# 2.1 Remove PENALTY override in populate_payroll_breakdown_from_details
pen1 = """    pr_dict["penalty_deduction"] = det_map.get("PENALTY", 0.0)
    for d in details_list:
        if d.get("item_code") == "PENALTY":
            d["item_name"] = "Giảm trừ thưởng chuyên cần (Đi trễ)"
    pr_dict["extra_allowance_amount"]"""
pen1_crlf = pen1.replace("\n", "\r\n")

pen1_rep = """    pr_dict["penalty_deduction"] = det_map.get("PENALTY", 0.0)
    pr_dict["extra_allowance_amount"]"""
pen1_rep_crlf = pen1_rep.replace("\n", "\r\n")

if pen1_crlf in p_content:
    p_content = p_content.replace(pen1_crlf, pen1_rep_crlf, 1)
    print("Removed PENALTY override 1 (CRLF)")
elif pen1 in p_content:
    p_content = p_content.replace(pen1, pen1_rep, 1)
    print("Removed PENALTY override 1 (LF)")
else:
    print("PENALTY override 1 already removed or not found")

# 2.2 Add absent_days and daily_standard_hours in list_payrolls & get_payroll_detail query
q_old = """p.standard_working_days, p.actual_working_days, p.paid_leave_days, p.unpaid_leave_days,
               p.unworked_hours,"""
q_old_crlf = q_old.replace("\n", "\r\n")

q_new = """p.standard_working_days, p.actual_working_days, p.paid_leave_days, p.unpaid_leave_days,
               p.absent_days, COALESCE(p.daily_standard_hours, 8.00) AS daily_standard_hours,
               p.unworked_hours,"""
q_new_crlf = q_new.replace("\n", "\r\n")

count_crlf = p_content.count(q_old_crlf)
count_lf = p_content.count(q_old)

if count_crlf > 0:
    p_content = p_content.replace(q_old_crlf, q_new_crlf)
    print(f"Replaced {count_crlf} occurrences of query attendance cols (CRLF)")
elif count_lf > 0:
    p_content = p_content.replace(q_old, q_new)
    print(f"Replaced {count_lf} occurrences of query attendance cols (LF)")
else:
    print("Query attendance cols already updated or not found")

# 2.3 Remove PENALTY override in get_printable_payslip
pen2 = """        if d.get("item_code") == "PENALTY":
            d_dict["item_name"] = "Giảm trừ thưởng chuyên cần (Đi trễ)"
            d_dict["name"] = "Giảm trừ thưởng chuyên cần (Đi trễ)"
        else:
            d_dict["name"] = d["item_name"]"""
pen2_crlf = pen2.replace("\n", "\r\n")

pen2_rep = """        d_dict["name"] = d["item_name"]"""
pen2_rep_crlf = pen2_rep.replace("\n", "\r\n")

if pen2_crlf in p_content:
    p_content = p_content.replace(pen2_crlf, pen2_rep_crlf, 1)
    print("Removed PENALTY override 2 (CRLF)")
elif pen2 in p_content:
    p_content = p_content.replace(pen2, pen2_rep, 1)
    print("Removed PENALTY override 2 (LF)")
else:
    print("PENALTY override 2 already removed or not found")

# 2.4 Add daily_standard_hours and absent_days to attendance and attendance_summary dicts
att_old = """        "attendance": {
            "standard_working_days": float(row["standard_working_days"] if row["standard_working_days"] is not None else 26.0),
            "actual_working_days": float(row["actual_working_days"] if row["actual_working_days"] is not None else 0),
            "paid_leave_days": float(row["paid_leave_days"] if row["paid_leave_days"] is not None else 0),
            "unpaid_leave_days": float(row["unpaid_leave_days"] if row["unpaid_leave_days"] is not None else 0),
            "unworked_hours": float(row["unworked_hours"] if row["unworked_hours"] is not None else 0),"""
att_old_crlf = att_old.replace("\n", "\r\n")

att_new = """        "attendance": {
            "standard_working_days": float(row["standard_working_days"] if row["standard_working_days"] is not None else 26.0),
            "daily_standard_hours": float(row["daily_standard_hours"] if row.get("daily_standard_hours") is not None else 8.00),
            "actual_working_days": float(row["actual_working_days"] if row["actual_working_days"] is not None else 0),
            "paid_leave_days": float(row["paid_leave_days"] if row["paid_leave_days"] is not None else 0),
            "unpaid_leave_days": float(row["unpaid_leave_days"] if row["unpaid_leave_days"] is not None else 0),
            "absent_days": float(row["absent_days"] if row.get("absent_days") is not None else 0),
            "unworked_hours": float(row["unworked_hours"] if row["unworked_hours"] is not None else 0),"""
att_new_crlf = att_new.replace("\n", "\r\n")

if att_old_crlf in p_content:
    p_content = p_content.replace(att_old_crlf, att_new_crlf, 1)
    print("Updated attendance dict (CRLF)")
elif att_old in p_content:
    p_content = p_content.replace(att_old, att_new, 1)
    print("Updated attendance dict (LF)")
else:
    print("attendance dict already updated or not found")

summary_old = """        "attendance_summary": {
            "standard_working_days": float(row["standard_working_days"] if row["standard_working_days"] is not None else 26.0),
            "actual_working_days": float(row["actual_working_days"] if row["actual_working_days"] is not None else 0),
            "paid_leave_days": float(row["paid_leave_days"] if row["paid_leave_days"] is not None else 0),
            "unpaid_leave_days": float(row["unpaid_leave_days"] if row["unpaid_leave_days"] is not None else 0),
            "unworked_hours": float(row["unworked_hours"] if row["unworked_hours"] is not None else 0)
        },"""
summary_old_crlf = summary_old.replace("\n", "\r\n")

summary_new = """        "attendance_summary": {
            "standard_working_days": float(row["standard_working_days"] if row["standard_working_days"] is not None else 26.0),
            "daily_standard_hours": float(row["daily_standard_hours"] if row.get("daily_standard_hours") is not None else 8.00),
            "actual_working_days": float(row["actual_working_days"] if row["actual_working_days"] is not None else 0),
            "paid_leave_days": float(row["paid_leave_days"] if row["paid_leave_days"] is not None else 0),
            "unpaid_leave_days": float(row["unpaid_leave_days"] if row["unpaid_leave_days"] is not None else 0),
            "absent_days": float(row["absent_days"] if row.get("absent_days") is not None else 0),
            "unworked_hours": float(row["unworked_hours"] if row["unworked_hours"] is not None else 0)
        },"""
summary_new_crlf = summary_new.replace("\n", "\r\n")

if summary_old_crlf in p_content:
    p_content = p_content.replace(summary_old_crlf, summary_new_crlf, 1)
    print("Updated attendance_summary dict (CRLF)")
elif summary_old in p_content:
    p_content = p_content.replace(summary_old, summary_new, 1)
    print("Updated attendance_summary dict (LF)")
else:
    print("attendance_summary dict already updated or not found")

with open(payrolls_path, "w", encoding="utf-8") as f:
    f.write(p_content)

print("All backend files updated successfully!")

