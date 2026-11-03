import os
import sys

sys.stdout.reconfigure(encoding='utf-8')

# 1. Update frontend-web/src/types/index.ts
types_path = os.path.join(os.path.dirname(__file__), "..", "..", "frontend-web", "src", "types", "index.ts")
with open(types_path, "r", encoding="utf-8") as f:
    t_content = f.read()

t_target = """  unpaid_leave_days?: number;
  unworked_hours?: number;"""
t_target_crlf = t_target.replace("\n", "\r\n")

t_rep = """  unpaid_leave_days?: number;
  absent_days?: number;            // Số ngày vắng mặt không phép
  daily_standard_hours?: number;   // Định mức giờ làm việc chuẩn mỗi ngày
  unworked_hours?: number;"""
t_rep_crlf = t_rep.replace("\n", "\r\n")

if t_target_crlf in t_content:
    t_content = t_content.replace(t_target_crlf, t_rep_crlf, 1)
    print("Updated types/index.ts (CRLF)")
elif t_target in t_content:
    t_content = t_content.replace(t_target, t_rep, 1)
    print("Updated types/index.ts (LF)")
else:
    print("types/index.ts already updated or target not found")

with open(types_path, "w", encoding="utf-8") as f:
    f.write(t_content)


# 2. Update frontend-web/src/pages/PayrollPage.tsx
payroll_page_path = os.path.join(os.path.dirname(__file__), "..", "..", "frontend-web", "src", "pages", "PayrollPage.tsx")
with open(payroll_page_path, "r", encoding="utf-8") as f:
    pp_content = f.read()

# 2.1 Drawer detail: absent_days & daily_standard_hours
dr_old = """                          <div>Nghỉ không lương: <strong style={{ color: (selectedPayroll.unpaid_leave_days || 0) > 0 ? 'var(--status-error)' : 'inherit' }}>{selectedPayroll.unpaid_leave_days ?? 0}</strong> ngày</div>
                          <div>Giờ công: <strong>{Number(selectedPayroll.attendance_hours || 0).toFixed(1)}h</strong></div>"""
dr_old_crlf = dr_old.replace("\n", "\r\n")

dr_new = """                          <div>Nghỉ không lương: <strong style={{ color: (selectedPayroll.unpaid_leave_days || 0) > 0 ? 'var(--status-error)' : 'inherit' }}>{selectedPayroll.unpaid_leave_days ?? 0}</strong> ngày</div>
                          <div>Vắng không phép: <strong style={{ color: (selectedPayroll.absent_days || 0) > 0 ? 'var(--status-error)' : 'inherit' }}>{selectedPayroll.absent_days ?? 0}</strong> ngày</div>
                          <div>Định mức ca: <strong>{selectedPayroll.daily_standard_hours ?? 8}h/ngày</strong></div>
                          <div>Giờ công: <strong>{Number(selectedPayroll.attendance_hours || 0).toFixed(1)}h</strong></div>"""
dr_new_crlf = dr_new.replace("\n", "\r\n")

if dr_old_crlf in pp_content:
    pp_content = pp_content.replace(dr_old_crlf, dr_new_crlf, 1)
    print("Updated Drawer in PayrollPage.tsx (CRLF)")
elif dr_old in pp_content:
    pp_content = pp_content.replace(dr_old, dr_new, 1)
    print("Updated Drawer in PayrollPage.tsx (LF)")
else:
    print("Drawer in PayrollPage.tsx already updated or target not found")

# 2.2 Remove duplicate time_deduction_amount row in Table II DEDUCTIONS
ded_old = """                              {(selectedPayroll.time_deduction_amount || 0) > 0 && (
                                <tr>
                                  <td style={{ padding: '8px 12px' }}>Giảm trừ đi trễ / về sớm</td>
                                  <td style={{ padding: '8px 12px', textAlign: 'right', fontFamily: 'var(--font-mono)', color: 'var(--status-error)' }}>
                                    -{formatCurrency(selectedPayroll.time_deduction_amount)}
                                  </td>
                                </tr>
                              )}"""
ded_old_crlf = ded_old.replace("\n", "\r\n")

if ded_old_crlf in pp_content:
    pp_content = pp_content.replace(ded_old_crlf, "")
    print("Removed duplicate deduction row in PayrollPage.tsx (CRLF)")
elif ded_old in pp_content:
    pp_content = pp_content.replace(ded_old, "")
    print("Removed duplicate deduction row in PayrollPage.tsx (LF)")
else:
    print("Duplicate deduction row already removed or target not found")

# 2.3 Print payslip modal: absent_days & daily_standard_hours
prt_old = """                    <div>Nghỉ không lương: <strong>{monthlyPrintData.attendance?.unpaid_leave_days ?? selectedPayroll?.unpaid_leave_days ?? 0} ngày</strong></div>
                    <div>Giờ công thực: <strong>{monthlyPrintData.attendance?.actual_work_hours ?? 0} giờ</strong></div>"""
prt_old_crlf = prt_old.replace("\n", "\r\n")

prt_new = """                    <div>Nghỉ không lương: <strong>{monthlyPrintData.attendance?.unpaid_leave_days ?? selectedPayroll?.unpaid_leave_days ?? 0} ngày</strong></div>
                    <div>Vắng không phép: <strong>{monthlyPrintData.attendance?.absent_days ?? selectedPayroll?.absent_days ?? 0} ngày</strong></div>
                    <div>Định mức ca: <strong>{monthlyPrintData.attendance?.daily_standard_hours ?? selectedPayroll?.daily_standard_hours ?? 8}h/ngày</strong></div>
                    <div>Giờ công thực: <strong>{monthlyPrintData.attendance?.actual_work_hours ?? 0} giờ</strong></div>"""
prt_new_crlf = prt_new.replace("\n", "\r\n")

if prt_old_crlf in pp_content:
    pp_content = pp_content.replace(prt_old_crlf, prt_new_crlf, 1)
    print("Updated Print modal in PayrollPage.tsx (CRLF)")
elif prt_old in pp_content:
    pp_content = pp_content.replace(prt_old, prt_new, 1)
    print("Updated Print modal in PayrollPage.tsx (LF)")
else:
    print("Print modal in PayrollPage.tsx already updated or target not found")

with open(payroll_page_path, "w", encoding="utf-8") as f:
    f.write(pp_content)


# 3. Update EmployeeAttendanceDetailModal.tsx
att_modal_path = os.path.join(os.path.dirname(__file__), "..", "..", "frontend-web", "src", "pages", "EmployeeAttendanceDetailModal.tsx")
with open(att_modal_path, "r", encoding="utf-8") as f:
    am_content = f.read()

am_target = "Giảm trừ thưởng chuyên cần: {formatCurrency(totalLatePenalty)}"
am_rep = "Tiền phạt vi phạm quy chế: {formatCurrency(totalLatePenalty)}"

if am_target in am_content:
    am_content = am_content.replace(am_target, am_rep, 1)
    print("Updated EmployeeAttendanceDetailModal.tsx")
    with open(att_modal_path, "w", encoding="utf-8") as f:
        f.write(am_content)
else:
    print("EmployeeAttendanceDetailModal.tsx already updated or target not found")


# 4. Update MonthlyAttendancePage.tsx
monthly_att_path = os.path.join(os.path.dirname(__file__), "..", "..", "frontend-web", "src", "pages", "MonthlyAttendancePage.tsx")
with open(monthly_att_path, "r", encoding="utf-8") as f:
    ma_content = f.read()

ma_target = "Giảm trừ chuyên cần dự kiến:{' '}"
ma_rep = "Tiền phạt vi phạm quy chế dự kiến:{' '}"

if ma_target in ma_content:
    ma_content = ma_content.replace(ma_target, ma_rep, 1)
    print("Updated MonthlyAttendancePage.tsx")
    with open(monthly_att_path, "w", encoding="utf-8") as f:
        f.write(ma_content)
else:
    print("MonthlyAttendancePage.tsx already updated or target not found")


# 5. Update PayrollRegulationDialog.tsx
reg_dialog_path = os.path.join(os.path.dirname(__file__), "..", "..", "frontend-web", "src", "pages", "PayrollRegulationDialog.tsx")
with open(reg_dialog_path, "r", encoding="utf-8") as f:
    rd_content = f.read()

rd_target1 = '<span className="prd-badge">PHẠT CHUYÊN CẦN</span>'
rd_rep1 = '<span className="prd-badge">PHẠT VI PHẠM QUY CHẾ</span>'

rd_target2 = "Trễ &gt; 15p bị trừ chuyên cần theo mức phạt quy chế (<code>LATE_PENALTY_AMOUNT</code>) + trừ theo số phút thiếu."
rd_rep2 = "Trễ &gt; 15p bị phạt vi phạm quy chế (<code>LATE_PENALTY_AMOUNT</code>) + trừ lương theo số phút thiếu."

if rd_target1 in rd_content:
    rd_content = rd_content.replace(rd_target1, rd_rep1, 1)
    print("Updated PayrollRegulationDialog.tsx badge")

if rd_target2 in rd_content:
    rd_content = rd_content.replace(rd_target2, rd_rep2, 1)
    print("Updated PayrollRegulationDialog.tsx text")

with open(reg_dialog_path, "w", encoding="utf-8") as f:
    f.write(rd_content)

print("All frontend files updated successfully!")

