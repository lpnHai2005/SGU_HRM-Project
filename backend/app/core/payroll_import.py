import io
import os
import re
from decimal import Decimal
from typing import Any, Dict, List, Optional, Tuple
import openpyxl
from sqlalchemy import text


MAX_FILE_BYTES = 10 * 1024 * 1024  # 10 MB
MAX_ROWS = 500
FIRST_DATA_ROW = 4

EXPECTED_HEADERS = [
    "Mã nhân viên (*)",
    "Họ và tên",
    "Cửa hàng",
    "Chức danh",
    "Lương hợp đồng",
    "Công chuẩn kỳ",
    "Công đang tính",
    "Công thực tế",
    "Phép có lương",
    "OT thường (giờ)",
    "OT Chủ nhật (giờ)",
    "OT Lễ Tết (giờ)",
    "Hoa hồng ngoài POS",
    "Thưởng bổ sung",
    "Phụ cấp đặc thù",
    "Khấu trừ vi phạm / bồi hoàn",
    "Ghi chú",
]


class ImportFileError(Exception):
    """Lỗi định dạng cấu trúc file import (trả về 400 Bad Request)."""
    pass


def sanitize_file_name(name: Optional[str]) -> str:
    if not name:
        return "import.xlsx"
    base = os.path.basename(name.replace("\\", "/"))
    # Bỏ ký tự có mã < 32 và 0x7F
    cleaned = "".join(ch for ch in base if ord(ch) >= 32 and ord(ch) != 0x7F)
    cleaned = cleaned.strip()[:255]
    return cleaned if cleaned else "import.xlsx"


def parse_import_workbook(content: bytes, period: str) -> Tuple[str, List[Dict[str, Any]], List[Dict[str, Any]]]:
    """
    Parse file Excel import bảng công và các khoản bổ sung.
    Trả về (template_stamp, rows, errors).
    Nếu lỗi cấu trúc file -> raise ImportFileError.
    """
    try:
        wb_data = openpyxl.load_workbook(io.BytesIO(content), read_only=True, data_only=True)
    except Exception:
        raise ImportFileError("File không phải .xlsx hợp lệ")

    try:
        wb_formula = openpyxl.load_workbook(io.BytesIO(content), read_only=True, data_only=False)
    except Exception:
        wb_data.close()
        raise ImportFileError("File không phải .xlsx hợp lệ")

    try:
        ws_data = wb_data.active
        ws_formula = wb_formula.active

        # 1. Kiểm tra B1 và C1
        # iter_rows lấy dòng 1..3
        header_rows_data = list(ws_data.iter_rows(min_row=1, max_row=3, max_col=17, values_only=True))
        if len(header_rows_data) < 3:
            raise ImportFileError("File không đúng mẫu, thiếu thông tin tiêu đề")

        row1 = header_rows_data[0]
        # B1: Kỳ lương: {period}
        b1_val = str(row1[1]).strip() if len(row1) > 1 and row1[1] is not None else ""
        expected_b1 = f"Kỳ lương: {period}"
        if b1_val != expected_b1:
            raise ImportFileError(f"Kỳ lương trong file ({b1_val or 'trống'}) không khớp với kỳ đang thao tác ({expected_b1})")

        # C1: Mốc dữ liệu: {stamp}
        c1_val = str(row1[2]).strip() if len(row1) > 2 and row1[2] is not None else ""
        stamp_prefix = "Mốc dữ liệu:"
        if not c1_val.startswith(stamp_prefix):
            raise ImportFileError("File không đúng mẫu, thiếu ô mốc dữ liệu C1")
        template_stamp = c1_val[len(stamp_prefix):].strip()
        if not template_stamp:
            raise ImportFileError("File không đúng mẫu, mốc dữ liệu C1 trống")

        # Dòng 3: danh sách header
        row3 = header_rows_data[2]
        actual_headers = [str(col).strip() if col is not None else "" for col in row3[:17]]
        if len(actual_headers) < len(EXPECTED_HEADERS):
            raise ImportFileError("File không đúng mẫu, hãy tải mẫu mới")
        for idx, expected_h in enumerate(EXPECTED_HEADERS):
            if actual_headers[idx] != expected_h:
                raise ImportFileError(f"Cột {idx+1} không đúng mẫu (kỳ vọng '{expected_h}', thực tế '{actual_headers[idx]}'), hãy tải mẫu mới")

        # Đọc dữ liệu từ dòng 4 tới tối đa FIRST_DATA_ROW + MAX_ROWS
        # min_row=4, max_row=504, max_col=17
        data_rows = list(ws_data.iter_rows(min_row=FIRST_DATA_ROW, max_row=FIRST_DATA_ROW + MAX_ROWS, max_col=17, values_only=True))
        formula_rows = list(ws_formula.iter_rows(min_row=FIRST_DATA_ROW, max_row=FIRST_DATA_ROW + MAX_ROWS, max_col=17, values_only=True))

        # Kiểm tra nếu dòng 501 còn dữ liệu -> lỗi quá 500 dòng
        if len(data_rows) == MAX_ROWS + 1:
            last_row = data_rows[-1]
            if any(cell is not None and str(cell).strip() != "" for cell in last_row):
                raise ImportFileError("File chứa quá 500 dòng dữ liệu nhân viên")
            # Nếu dòng 501 trống hoàn toàn, loại bỏ dòng đó
            data_rows = data_rows[:MAX_ROWS]
            formula_rows = formula_rows[:MAX_ROWS]

        rows: List[Dict[str, Any]] = []
        errors: List[Dict[str, Any]] = []
        seen_employee_codes: set = set()

        for idx, (r_data, r_form) in enumerate(zip(data_rows, formula_rows)):
            row_idx = FIRST_DATA_ROW + idx

            # Cột A: Mã NV
            a_val = r_data[0] if len(r_data) > 0 else None
            # Các ô nhập liệu: H (idx 7), I (idx 8), M (idx 12), N (idx 13), O (idx 14), P (idx 15), Q (idx 16)
            input_cells = [
                r_data[i] if len(r_data) > i else None
                for i in [7, 8, 12, 13, 14, 15, 16]
            ]
            has_input_data = any(c is not None and str(c).strip() != "" for c in input_cells)
            has_emp_code = a_val is not None and str(a_val).strip() != ""

            # Bỏ qua dòng trống hoàn toàn (A trống và mọi ô nhập liệu trống)
            if not has_emp_code and not has_input_data:
                continue

            # Cột A trống nhưng có ô nhập liệu -> lỗi
            if not has_emp_code and has_input_data:
                errors.append({
                    "row_index": row_idx,
                    "employee_code": "",
                    "field": "employee_code",
                    "reason": "Thiếu mã nhân viên"
                })
                continue

            emp_code = str(a_val).strip().upper()
            if not re.match(r"^TZ-\d{3,}$", emp_code):
                errors.append({
                    "row_index": row_idx,
                    "employee_code": emp_code,
                    "field": "employee_code",
                    "reason": f"Mã nhân viên '{emp_code}' không đúng định dạng (TZ-xxx)"
                })
                continue

            if emp_code in seen_employee_codes:
                errors.append({
                    "row_index": row_idx,
                    "employee_code": emp_code,
                    "field": "employee_code",
                    "reason": f"Mã nhân viên {emp_code} bị lặp lại trong file"
                })
                continue
            seen_employee_codes.add(emp_code)

            row_has_error = False

            # Helper kiểm tra ô số
            def parse_number_cell(val_data: Any, val_form: Any, field_name: str) -> Tuple[Optional[float], bool]:
                nonlocal row_has_error
                # Kiểm tra công thức chưa được tính: val_data là None nhưng val_form là chuỗi bắt đầu bằng '='
                if val_data is None and isinstance(val_form, str) and val_form.strip().startswith("="):
                    errors.append({
                        "row_index": row_idx,
                        "employee_code": emp_code,
                        "field": field_name,
                        "reason": "Ô chứa công thức chưa được Excel tính — mở file bằng Excel, bấm Lưu rồi tải lên lại"
                    })
                    row_has_error = True
                    return None, False

                if val_data is None or str(val_data).strip() == "":
                    return None, True

                # openpyxl có thể đọc boolean (True/False)
                if isinstance(val_data, bool):
                    errors.append({
                        "row_index": row_idx,
                        "employee_code": emp_code,
                        "field": field_name,
                        "reason": "Ô phải là số"
                    })
                    row_has_error = True
                    return None, False

                if isinstance(val_data, (int, float)):
                    return float(val_data), True

                # Nếu là string
                try:
                    num = float(str(val_data).strip().replace(",", ""))
                    return num, True
                except ValueError:
                    errors.append({
                        "row_index": row_idx,
                        "employee_code": emp_code,
                        "field": field_name,
                        "reason": "Ô phải là số"
                    })
                    row_has_error = True
                    return None, False

            # H: Công thực tế
            actual_days, _ = parse_number_cell(r_data[7], r_form[7], "actual_working_days")
            # I: Phép có lương
            paid_leave, _ = parse_number_cell(r_data[8], r_form[8], "paid_leave_days")

            # J, K, L: OT (chỉ để đọc và so sánh với hệ thống, không lưu)
            ot_norm, _ = parse_number_cell(r_data[9], r_form[9], "ot_normal")
            ot_wknd, _ = parse_number_cell(r_data[10], r_form[10], "ot_weekend")
            ot_holi, _ = parse_number_cell(r_data[11], r_form[11], "ot_holiday")

            # M: Hoa hồng ngoài POS
            extra_comm, _ = parse_number_cell(r_data[12], r_form[12], "extra_commission")
            # N: Thưởng bổ sung
            extra_bonus, _ = parse_number_cell(r_data[13], r_form[13], "extra_bonus")
            # O: Phụ cấp đặc thù
            extra_allowance, _ = parse_number_cell(r_data[14], r_form[14], "extra_allowance")
            # P: Khấu trừ vi phạm
            extra_penalty, _ = parse_number_cell(r_data[15], r_form[15], "extra_penalty")

            # Q: Ghi chú
            q_val = r_data[16] if len(r_data) > 16 else None
            note = str(q_val).strip()[:255] if q_val is not None and str(q_val).strip() != "" else None

            if not row_has_error:
                rows.append({
                    "row_index": row_idx,
                    "employee_code": emp_code,
                    "actual_working_days": actual_days,
                    "paid_leave_days": paid_leave,
                    "extra_commission": extra_comm if extra_comm is not None else 0.0,
                    "extra_bonus": extra_bonus if extra_bonus is not None else 0.0,
                    "extra_allowance": extra_allowance if extra_allowance is not None else 0.0,
                    "extra_penalty": extra_penalty if extra_penalty is not None else 0.0,
                    "note": note,
                    "ot_file": (ot_norm, ot_wknd, ot_holi),
                })

        return template_stamp, rows, errors

    finally:
        wb_data.close()
        wb_formula.close()


async def get_approved_ot_hours(db, period: str) -> Dict[int, Tuple[float, float, float]]:
    """Đọc số giờ OT đã duyệt chia 3 mức (thường, chủ nhật, lễ) theo employee_id."""
    res = await db.execute(text("""
        SELECT 
            a.employee_id,
            SUM(CASE 
                WHEN h.holiday_date IS NOT NULL THEN 0 
                WHEN EXTRACT(DOW FROM a.work_date) = 0 THEN 0 
                ELSE COALESCE(ota.approved_hours, 0) 
            END) AS ot_normal_hours,
            SUM(CASE 
                WHEN h.holiday_date IS NOT NULL THEN 0 
                WHEN EXTRACT(DOW FROM a.work_date) = 0 THEN COALESCE(ota.approved_hours, 0) 
                ELSE 0 
            END) AS ot_weekend_hours,
            SUM(CASE 
                WHEN h.holiday_date IS NOT NULL THEN COALESCE(ota.approved_hours, 0) 
                ELSE 0 
            END) AS ot_holiday_hours
        FROM attendances a
        JOIN attendance_overtime_approvals ota ON a.attendance_id = ota.attendance_id AND ota.decision = 'APPROVED'
        LEFT JOIN public.public_holidays h ON a.work_date = h.holiday_date
        WHERE TO_CHAR(a.work_date, 'YYYY-MM') = :period
        GROUP BY a.employee_id
    """), {"period": period})

    ot_map = {}
    for r in res.fetchall():
        ot_map[r[0]] = (float(r[1] or 0), float(r[2] or 0), float(r[3] or 0))
    return ot_map


def _norm(rec: Dict[str, Any]) -> Tuple:
    """Chuẩn hóa dữ liệu override để so sánh chính xác giữa DB và File."""
    d2 = lambda v: None if v is None else Decimal(str(v)).quantize(Decimal("0.01"))
    return (
        d2(rec.get("unpaid_leave_days")),
        d2(rec.get("paid_leave_days")),
        int(round(float(rec.get("extra_commission") or 0))),
        int(round(float(rec.get("extra_bonus") or 0))),
        int(round(float(rec.get("extra_allowance") or 0))),
        int(round(float(rec.get("extra_penalty") or 0))),
        (str(rec.get("note")).strip() if rec.get("note") and str(rec.get("note")).strip() else None)
    )


async def classify_import_rows(db, period: str, rows: List[Dict[str, Any]]) -> Dict[str, Any]:
    """
    Kiểm tra nghiệp vụ và phân loại từng dòng thành CREATE, UPDATE, DELETE, UNCHANGED.
    Trả về: {standard_working_days, actions, invalid_records, warnings}
    """
    # 1. Đọc ngày công chuẩn
    std_res = await db.execute(text("SELECT public.fn_payroll_standard_days(:period)"), {"period": period})
    raw_std = std_res.scalar_one_or_none()
    std = Decimal(str(raw_std or 26.0))

    # 2. Đọc danh sách nhân viên ACTIVE / PROBATION
    emp_res = await db.execute(text("""
        SELECT employee_id, employee_code, full_name, employment_status
        FROM employees
        WHERE employment_status IN ('ACTIVE', 'PROBATION')
    """))
    emp_map = {r[1]: {"employee_id": r[0], "full_name": r[2]} for r in emp_res.fetchall()}

    # 3. Đọc override hiện có trong DB
    ov_res = await db.execute(text("""
        SELECT salary_period, employee_id, batch_id, unpaid_leave_days, paid_leave_days,
               extra_commission, extra_bonus, extra_allowance, extra_penalty, note
        FROM public.payroll_import_overrides
        WHERE salary_period = :period
    """), {"period": period})
    db_overrides = {r[1]: dict(r._mapping) for r in ov_res.fetchall()}

    # 4. Đọc OT đã duyệt
    approved_ot = await get_approved_ot_hours(db, period)

    # 5. Đọc điều chỉnh tay hiện có
    adj_res = await db.execute(text("""
        SELECT p.employee_id, a.addition_amount, a.deduction_amount
        FROM payrolls p
        JOIN payroll_manual_adjustments a USING (payroll_id)
        WHERE p.salary_period = :period
    """), {"period": period})
    adj_map = {r[0]: (float(r[1] or 0), float(r[2] or 0)) for r in adj_res.fetchall()}

    invalid_records: List[Dict[str, Any]] = []
    actions: List[Dict[str, Any]] = []
    warnings: List[Dict[str, Any]] = []

    for r in rows:
        row_idx = r.get("row_index")
        code = r["employee_code"]

        # Kiểm tra nhân viên tồn tại và hợp lệ
        if code not in emp_map:
            invalid_records.append({
                "row_index": row_idx,
                "employee_code": code,
                "field": "employee_code",
                "reason": f"Nhân viên '{code}' không tồn tại hoặc đã nghỉ việc"
            })
            continue

        emp_info = emp_map[code]
        emp_id = emp_info["employee_id"]
        full_name = emp_info["full_name"]

        # Kiểm tra cặp công / phép
        actual_days_raw = r.get("actual_working_days")
        paid_leave_raw = r.get("paid_leave_days")

        has_actual = actual_days_raw is not None
        has_paid = paid_leave_raw is not None

        if has_actual != has_paid:
            invalid_records.append({
                "row_index": row_idx,
                "employee_code": code,
                "field": "actual_working_days",
                "reason": "Nhập Công thực tế thì phải nhập Phép có lương (ghi 0 nếu không có) và ngược lại"
            })
            continue

        row_error = False
        cong_dec: Optional[Decimal] = None
        phep_dec: Optional[Decimal] = None
        unpaid_dec: Optional[Decimal] = None

        if has_actual and has_paid:
            # Cho phép sai số 1e-6 trước khi làm tròn 2 chữ số thập phân
            if abs(actual_days_raw - round(actual_days_raw, 2)) > 1e-6:
                invalid_records.append({
                    "row_index": row_idx,
                    "employee_code": code,
                    "field": "actual_working_days",
                    "reason": f"Công thực tế ({actual_days_raw}) có nhiều hơn 2 chữ số thập phân"
                })
                row_error = True

            if abs(paid_leave_raw - round(paid_leave_raw, 2)) > 1e-6:
                invalid_records.append({
                    "row_index": row_idx,
                    "employee_code": code,
                    "field": "paid_leave_days",
                    "reason": f"Phép có lương ({paid_leave_raw}) có nhiều hơn 2 chữ số thập phân"
                })
                row_error = True

            cong_round = round(actual_days_raw, 2)
            phep_round = round(paid_leave_raw, 2)

            if not (0 <= cong_round <= float(std)):
                invalid_records.append({
                    "row_index": row_idx,
                    "employee_code": code,
                    "field": "actual_working_days",
                    "reason": f"Công thực tế ({cong_round}) vượt công chuẩn ({std}). Giờ làm thêm phải được duyệt ở màn Phê duyệt OT."
                })
                row_error = True

            if not (0 <= phep_round <= cong_round):
                invalid_records.append({
                    "row_index": row_idx,
                    "employee_code": code,
                    "field": "paid_leave_days",
                    "reason": f"Phép có lương ({phep_round}) không thể vượt quá công thực tế ({cong_round}) hoặc nhỏ hơn 0"
                })
                row_error = True

            if not row_error:
                cong_dec = Decimal(str(cong_round))
                phep_dec = Decimal(str(phep_round))
                unpaid_dec = (std - cong_dec).quantize(Decimal("0.01"))

        # Kiểm tra 4 khoản tiền M, N, O, P
        money_fields = [
            ("extra_commission", "Hoa hồng ngoài POS"),
            ("extra_bonus", "Thưởng bổ sung"),
            ("extra_allowance", "Phụ cấp đặc thù"),
            ("extra_penalty", "Khấu trừ vi phạm / bồi hoàn"),
        ]

        parsed_money: Dict[str, int] = {}
        for key, label in money_fields:
            m_val = r.get(key, 0.0) or 0.0
            if abs(m_val - round(m_val)) > 1e-6:
                invalid_records.append({
                    "row_index": row_idx,
                    "employee_code": code,
                    "field": key,
                    "reason": f"{label} phải là số nguyên, không được có phần thập phân lẻ"
                })
                row_error = True
            m_int = int(round(m_val))
            if m_int < 0 or m_int > 100_000_000:
                invalid_records.append({
                    "row_index": row_idx,
                    "employee_code": code,
                    "field": key,
                    "reason": f"{label} ({m_int:,} đ) phải nằm trong khoảng từ 0 đến 100,000,000 đ"
                })
                row_error = True
            parsed_money[key] = m_int

        if row_error:
            continue

        note_val = r.get("note")
        note_str = str(note_val).strip() if note_val and str(note_val).strip() else None

        # Kiểm tra dòng trống: không có công/phép và cả 4 khoản tiền đều bằng 0
        is_empty_row = (cong_dec is None) and all(v == 0 for v in parsed_money.values())
        if is_empty_row and note_str:
            warnings.append({
                "employee_code": code,
                "type": "NOTE_IGNORED",
                "message": f"Dòng nhân viên {code} không có công hay khoản tiền nào, ghi chú sẽ bị bỏ qua"
            })

        # Cấu trúc bản ghi file sau chuẩn hóa để so khớp
        file_rec = {
            "unpaid_leave_days": unpaid_dec,
            "paid_leave_days": phep_dec,
            "extra_commission": parsed_money["extra_commission"],
            "extra_bonus": parsed_money["extra_bonus"],
            "extra_allowance": parsed_money["extra_allowance"],
            "extra_penalty": parsed_money["extra_penalty"],
            "note": note_str if not is_empty_row else None
        }

        db_rec = db_overrides.get(emp_id)
        action = "UNCHANGED"

        if is_empty_row:
            if db_rec is not None:
                action = "DELETE"
            else:
                action = "UNCHANGED"
        else:
            if db_rec is None:
                action = "CREATE"
            else:
                # So sánh chuẩn hóa 2 phía
                if _norm(file_rec) == _norm(db_rec):
                    action = "UNCHANGED"
                else:
                    action = "UPDATE"

        # Kiểm tra cảnh báo nghiệp vụ:
        # 1. MANUAL_ADJUSTMENT_EXISTING
        if action in ("CREATE", "UPDATE") and emp_id in adj_map:
            add_amt, ded_amt = adj_map[emp_id]
            warnings.append({
                "employee_code": code,
                "type": "MANUAL_ADJUSTMENT_EXISTING",
                "message": f"Nhân viên {code} đã có điều chỉnh thủ công (+{add_amt:,.0f} đ, -{ded_amt:,.0f} đ). Bản ghi import sẽ áp dụng đồng thời với điều chỉnh thủ công."
            })

        # 2. OVERTIME_READONLY_DIFF
        ot_file = r.get("ot_file")
        if ot_file and emp_id in approved_ot:
            app_norm, app_wknd, app_holi = approved_ot[emp_id]
            f_norm, f_wknd, f_holi = ot_file
            diffs = []
            if f_norm is not None and abs(f_norm - app_norm) > 0.01:
                diffs.append(f"OT thường: file {f_norm}h vs duyệt {app_norm}h")
            if f_wknd is not None and abs(f_wknd - app_wknd) > 0.01:
                diffs.append(f"OT Chủ nhật: file {f_wknd}h vs duyệt {app_wknd}h")
            if f_holi is not None and abs(f_holi - app_holi) > 0.01:
                diffs.append(f"OT Lễ Tết: file {f_holi}h vs duyệt {app_holi}h")
            if diffs:
                warnings.append({
                    "employee_code": code,
                    "type": "OVERTIME_READONLY_DIFF",
                    "message": f"Nhân viên {code} có giờ OT trên file khác giờ đã duyệt ({'; '.join(diffs)}). Giờ OT trên file chỉ để xem và sẽ không được áp dụng."
                })

        actions.append({
            "row_index": row_idx,
            "employee_id": emp_id,
            "employee_code": code,
            "full_name": full_name,
            "action": action,
            "actual_working_days": float(cong_dec) if cong_dec is not None else None,
            "paid_leave_days": float(phep_dec) if phep_dec is not None else None,
            "unpaid_leave_days": float(unpaid_dec) if unpaid_dec is not None else None,
            "extra_commission": parsed_money["extra_commission"],
            "extra_bonus": parsed_money["extra_bonus"],
            "extra_allowance": parsed_money["extra_allowance"],
            "extra_penalty": parsed_money["extra_penalty"],
            "note": note_str if not is_empty_row else None
        })

    return {
        "standard_working_days": float(std),
        "actions": actions,
        "invalid_records": invalid_records,
        "warnings": warnings,
    }
