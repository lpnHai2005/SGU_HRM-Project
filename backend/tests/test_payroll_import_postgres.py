"""
Integration tests for Payroll Excel Import (Mục 7.2)
Runs in isolated transaction with savepoint mode and rolls back at the end.
"""
import asyncio
from datetime import date
from decimal import Decimal
from unittest.mock import patch

import pytest
from fastapi import HTTPException
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.database import engine
from app.api.v1.endpoints.payrolls import (
    calculate_payroll,
    confirm_payroll_import,
    preview_payroll_import,
    revert_payroll_import,
    get_payroll_import_status,
    export_payroll_excel,
    export_payroll_csv,
    PayrollImportConfirm,
    PayrollImportRecord,
    PayrollImportRevertRequest,
    get_import_stamp,
)
from app.schemas.schemas import CalculatePayrollRequest


@pytest.mark.asyncio
async def test_payroll_import_postgres_workflow():
    HR_USER = {"user_id": 999, "employee_id": 901, "roles": ["HR_MANAGER"]}

    with patch.object(settings, "OT_REGISTRATION_POLICY_MODE", "DISABLED"):
        async with engine.connect() as conn:
            tx = await conn.begin()
            try:
                async with AsyncSession(bind=conn, join_transaction_mode="create_savepoint") as db:
                    period = "2040-10"

                    # 1. Clean test period data
                    await db.execute(text("DELETE FROM public.public_holidays WHERE holiday_date BETWEEN '2040-10-01' AND '2040-10-31'"))
                    await db.execute(text("DELETE FROM public.payroll_period_bonuses WHERE salary_period = :p"), {"p": period})
                    await db.execute(text("DELETE FROM public.payroll_period_overrides WHERE salary_period = :p"), {"p": period})
                    await db.execute(text("DELETE FROM public.payroll_details WHERE payroll_id IN (SELECT payroll_id FROM payrolls WHERE salary_period = :p)"), {"p": period})
                    await db.execute(text("DELETE FROM public.payrolls WHERE salary_period = :p"), {"p": period})
                    await db.execute(text("DELETE FROM public.payroll_import_overrides WHERE salary_period = :p"), {"p": period})
                    await db.execute(text("DELETE FROM public.payroll_import_batches WHERE salary_period = :p"), {"p": period})
                    await db.execute(text("DELETE FROM public.payroll_calculation_runs WHERE salary_period = :p"), {"p": period})

                    # Seed auxiliary master data
                    await db.execute(text("""
                        INSERT INTO public.stores (store_id, store_code, store_name, address, district, city, open_date, is_active)
                        VALUES (999, 'TZ-TEST', 'TechZone Test Store', '123 Test', 'Q1', 'HCM', '2026-01-01', true)
                        ON CONFLICT (store_id) DO NOTHING;
                    """))

                    await db.execute(text("""
                        INSERT INTO public.positions (position_id, position_code, position_name, position_allowance)
                        VALUES 
                            (998, 'STAFF_TEST', 'Staff No Allowance', 0),
                            (999, 'LEADER_TEST', 'Special Leader', 2000000)
                        ON CONFLICT (position_id) DO UPDATE SET position_allowance = EXCLUDED.position_allowance;
                    """))

                    # Employees TZ-901..TZ-904
                    emp_seeds = [
                        (901, "TZ-901", "901", "Nguyen Van", 999, 998, 10000000),
                        (902, "TZ-902", "902", "Nguyen Van", 999, 998, 25000000),
                        (903, "TZ-903", "903", "Nguyen Van", 999, 998, 8000000),
                        (904, "TZ-904", "904", "Nguyen Van", 999, 999, 12000000),
                    ]
                    for eid, code, first, last, sid, pos_id, salary in emp_seeds:
                        await db.execute(text("""
                            INSERT INTO public.employees (
                                employee_id, employee_code, first_name, last_name, gender, dob,
                                identity_card, phone, company_email, current_address,
                                department_id, position_id, education_level_id, store_id, join_date, employment_status
                            ) VALUES (
                                :eid, :code, :first, :last, 'MALE', '1995-01-01',
                                :id_card, :phone, :email, 'TP.HCM',
                                1, :pos_id, 1, :sid, '2040-03-01', 'ACTIVE'
                            )
                            ON CONFLICT (employee_id) DO UPDATE SET
                                employee_code = EXCLUDED.employee_code,
                                store_id = EXCLUDED.store_id,
                                position_id = EXCLUDED.position_id,
                                employment_status = 'ACTIVE';
                        """), {
                            "eid": eid, "code": code, "first": first, "last": last, "sid": sid, "pos_id": pos_id,
                            "id_card": f"079095000{eid}", "phone": f"0901234{eid}", "email": f"{code.lower()}@techzone.com"
                        })

                        await db.execute(text("""
                            INSERT INTO public.contracts (contract_id, contract_number, employee_id, status, basic_salary, insurance_salary, start_date, signed_date, end_date)
                            VALUES (:cid, :cnum, :eid, 'ACTIVE', :sal, :sal, '2040-03-01', '2040-03-01', NULL)
                            ON CONFLICT (contract_id) DO UPDATE SET
                                contract_number = EXCLUDED.contract_number,
                                employee_id = EXCLUDED.employee_id,
                                status = 'ACTIVE',
                                basic_salary = EXCLUDED.basic_salary,
                                insurance_salary = EXCLUDED.insurance_salary,
                                start_date = '2040-03-01',
                                signed_date = '2040-03-01',
                                end_date = NULL;
                        """), {"cid": eid, "cnum": f"HDLD-TEST-{eid}", "eid": eid, "sal": salary})

                    await db.execute(text("""
                        INSERT INTO public.users (user_id, username, password_hash, email, employee_id)
                        VALUES (999, 'hr_tester', 'dummy_hash', 'hr_tester@test.com', 901)
                        ON CONFLICT (user_id) DO NOTHING;
                    """))

                    # Clean attendances for test employees in test period
                    await db.execute(text("DELETE FROM public.attendances WHERE employee_id IN (901, 902, 903, 904) AND work_date BETWEEN '2040-10-01' AND '2040-10-31'"))

                    # Attendances & OT Approvals
                    # 901: 8h normal OT on 2040-10-02 (Wed)
                    # 902: 8h Sunday OT on 2040-10-07 (Sun)
                    # 903: 4h normal OT on 2040-10-02; 2 lates (30 mins each) on 2040-10-03 and 2040-10-04
                    # 904: 6h normal OT on 2040-10-02
                    att_seeds = [
                        (9001, 901, "2040-10-02", "OVERTIME", 8.0, 0, 8.0),
                        (9002, 902, "2040-10-07", "OVERTIME", 8.0, 0, 8.0),
                        (9003, 903, "2040-10-02", "OVERTIME", 4.0, 0, 4.0),
                        (9004, 904, "2040-10-02", "OVERTIME", 6.0, 0, 6.0),
                        (9005, 903, "2040-10-03", "LATE", 0.0, 30, 0.0),
                        (9006, 903, "2040-10-04", "LATE", 0.0, 30, 0.0),
                    ]
                    for aid, eid, wdate, astatus, othours, lated, apphours in att_seeds:
                        await db.execute(text("""
                            INSERT INTO public.attendances (attendance_id, employee_id, store_id, shift_id, work_date, status, overtime_hours, late_minutes, check_out_time)
                            VALUES (:aid, :eid, :sid, (SELECT shift_id FROM work_shifts LIMIT 1), :wdate, :astatus, :othours, :lated, '2040-10-15 18:00:00+07')
                            ON CONFLICT (attendance_id) DO UPDATE SET
                                employee_id = EXCLUDED.employee_id,
                                store_id = EXCLUDED.store_id,
                                shift_id = EXCLUDED.shift_id,
                                work_date = EXCLUDED.work_date,
                                status = EXCLUDED.status,
                                overtime_hours = EXCLUDED.overtime_hours,
                                late_minutes = EXCLUDED.late_minutes;
                        """), {"aid": aid, "eid": eid, "sid": 999, "wdate": date.fromisoformat(wdate), "astatus": astatus, "othours": othours, "lated": lated})

                        if apphours > 0:
                            await db.execute(text("""
                                INSERT INTO public.attendance_overtime_approvals (attendance_id, approved_hours, decision, reviewer_user_id, reason)
                                VALUES (:aid, :apphours, 'APPROVED', 999, 'Seed test import')
                                ON CONFLICT (attendance_id) DO UPDATE SET
                                    approved_hours = EXCLUDED.approved_hours,
                                    decision = 'APPROVED',
                                    reason = EXCLUDED.reason;
                            """), {"aid": aid, "apphours": apphours})

                    # KỊCH BẢN 1: Preview không ghi gì vào DB
                    init_pr_count = (await db.execute(text("SELECT count(*) FROM payrolls WHERE salary_period = :p"), {"p": period})).scalar_one()
                    stamp_s1 = await get_import_stamp(db, period)

                    # KỊCH BẢN 2: Confirm nạp dữ liệu khớp bảng lương chuẩn
                    confirm_payload = PayrollImportConfirm(
                        salary_period=period,
                        file_name="Bang_Cong_Test_T10_2040.xlsx",
                        template_stamp=stamp_s1,
                        records=[
                            PayrollImportRecord(row_index=4, employee_code="TZ-901", actual_working_days=27, paid_leave_days=0, extra_commission=3000000, extra_bonus=1000000, extra_allowance=0, extra_penalty=0, note="Thưởng 901"),
                            PayrollImportRecord(row_index=5, employee_code="TZ-902", actual_working_days=27, paid_leave_days=0, extra_commission=0, extra_bonus=5000000, extra_allowance=0, extra_penalty=0, note="Thưởng 902"),
                            PayrollImportRecord(row_index=6, employee_code="TZ-903", actual_working_days=23, paid_leave_days=2, extra_commission=0, extra_bonus=0, extra_allowance=0, extra_penalty=500000, note="Phạt 903"),
                            PayrollImportRecord(row_index=7, employee_code="TZ-904", actual_working_days=None, paid_leave_days=None, extra_commission=0, extra_bonus=500000, extra_allowance=1500000, extra_penalty=0, note="Khoản tiền 904"),
                        ]
                    )

                    res_confirm = await confirm_payroll_import(confirm_payload, current_user=HR_USER, db=db)
                    assert res_confirm["counts"]["create"] == 4
                    batch_id = res_confirm["batch_id"]

                    # Đối chiếu từng phiếu lương:
                    pr_rows = (await db.execute(text("""
                        SELECT e.employee_code, p.gross_income, p.net_salary, p.total_deductions
                        FROM payrolls p JOIN employees e USING(employee_id)
                        WHERE p.salary_period = :p
                        ORDER BY e.employee_code
                    """), {"p": period})).fetchall()
                    pr_map = {r[0]: (float(r[1]), float(r[2])) for r in pr_rows}

                    # TZ-901: Gross 15,555,556, Net 14,505,556
                    assert pr_map["TZ-901"] == (15555556.0, 14505556.0), f"TZ-901 actual: {pr_map['TZ-901']}"
                    # TZ-902: Gross 32,851,852, Net 30,226,852
                    assert pr_map["TZ-902"] == (32851852.0, 30226852.0), f"TZ-902 actual: {pr_map['TZ-902']}"
                    # TZ-903: Gross 8,000,000, Net 6,560,000
                    assert pr_map["TZ-903"] == (8000000.0, 6560000.0), f"TZ-903 actual: {pr_map['TZ-903']}"
                    # TZ-904: Gross 17,500,000, Net 16,240,000
                    assert pr_map["TZ-904"] == (17500000.0, 16240000.0), f"TZ-904 actual: {pr_map['TZ-904']}"

                    # KỊCH BẢN 3: TZ-904 để trống công nên không bị cố định ngày công
                    await db.execute(text("""
                        INSERT INTO public.attendances (attendance_id, employee_id, store_id, shift_id, work_date, status, late_minutes)
                        VALUES (9007, 904, 999, (SELECT shift_id FROM work_shifts LIMIT 1), '2040-10-05', 'UNPAID_LEAVE', 0)
                        ON CONFLICT (attendance_id) DO UPDATE SET status = 'UNPAID_LEAVE';
                    """))
                    await calculate_payroll(CalculatePayrollRequest(salary_period=period), current_user=HR_USER, db=db)
                    tz904_pr = (await db.execute(text("SELECT actual_working_days, unpaid_leave_days FROM payrolls WHERE salary_period=:p AND employee_id=904"), {"p": period})).first()
                    assert tz904_pr[0] == 26.0 and tz904_pr[1] == 1.0

                    # KỊCH BẢN 4: Nạp lại nguyên file -> 409 không có thay đổi
                    stamp_s2 = await get_import_stamp(db, period)
                    confirm_same = PayrollImportConfirm(
                        salary_period=period, file_name="Same.xlsx", template_stamp=stamp_s2,
                        records=confirm_payload.records
                    )
                    try:
                        await confirm_payroll_import(confirm_same, current_user=HR_USER, db=db)
                        assert False, "Should have raised 409"
                    except HTTPException as exc:
                        assert exc.status_code == 409
                        assert "không có thay đổi" in exc.detail

                    # KỊCH BẢN 5: Sửa 1 dòng (TZ-901 tăng thưởng)
                    stamp_s3 = await get_import_stamp(db, period)
                    confirm_upd = PayrollImportConfirm(
                        salary_period=period, file_name="Upd.xlsx", template_stamp=stamp_s3,
                        records=[
                            PayrollImportRecord(row_index=4, employee_code="TZ-901", actual_working_days=27, paid_leave_days=0, extra_commission=3000000, extra_bonus=2000000, extra_allowance=0, extra_penalty=0, note="Upd"),
                            PayrollImportRecord(row_index=5, employee_code="TZ-902", actual_working_days=27, paid_leave_days=0, extra_commission=0, extra_bonus=5000000, extra_allowance=0, extra_penalty=0, note="Thưởng 902"),
                            PayrollImportRecord(row_index=6, employee_code="TZ-903", actual_working_days=23, paid_leave_days=2, extra_commission=0, extra_bonus=0, extra_allowance=0, extra_penalty=500000, note="Phạt 903"),
                            PayrollImportRecord(row_index=7, employee_code="TZ-904", actual_working_days=None, paid_leave_days=None, extra_commission=0, extra_bonus=500000, extra_allowance=1500000, extra_penalty=0, note="Khoản tiền 904"),
                        ]
                    )
                    res_upd = await confirm_payroll_import(confirm_upd, current_user=HR_USER, db=db)
                    assert res_upd["counts"]["update"] == 1 and res_upd["counts"]["create"] == 0

                    # KỊCH BẢN 6: Xóa trắng dòng TZ-903 -> DELETE
                    stamp_s4 = await get_import_stamp(db, period)
                    confirm_del = PayrollImportConfirm(
                        salary_period=period, file_name="Del.xlsx", template_stamp=stamp_s4,
                        records=[
                            PayrollImportRecord(row_index=4, employee_code="TZ-901", actual_working_days=27, paid_leave_days=0, extra_commission=3000000, extra_bonus=2000000, extra_allowance=0, extra_penalty=0, note="Upd"),
                            PayrollImportRecord(row_index=5, employee_code="TZ-902", actual_working_days=27, paid_leave_days=0, extra_commission=0, extra_bonus=5000000, extra_allowance=0, extra_penalty=0, note="Thưởng 902"),
                            PayrollImportRecord(row_index=6, employee_code="TZ-903", actual_working_days=None, paid_leave_days=None, extra_commission=0, extra_bonus=0, extra_allowance=0, extra_penalty=0, note=None),
                            PayrollImportRecord(row_index=7, employee_code="TZ-904", actual_working_days=None, paid_leave_days=None, extra_commission=0, extra_bonus=500000, extra_allowance=1500000, extra_penalty=0, note="Khoản tiền 904"),
                        ]
                    )
                    res_del = await confirm_payroll_import(confirm_del, current_user=HR_USER, db=db)
                    assert res_del["counts"]["delete"] == 1

                    # KỊCH BẢN 7: Điều chỉnh tay giữ nguyên
                    pr_901_id = (await db.execute(text("SELECT payroll_id FROM payrolls WHERE salary_period=:p AND employee_id=901"), {"p": period})).scalar_one()
                    await db.execute(text("""
                        INSERT INTO public.payroll_manual_adjustments (payroll_id, addition_amount, deduction_amount, reason, edited_by)
                        VALUES (:pid, 500000, 0, 'Thưởng thêm tay', 999)
                        ON CONFLICT (payroll_id) DO UPDATE SET addition_amount = 500000;
                    """), {"pid": pr_901_id})
                    await calculate_payroll(CalculatePayrollRequest(salary_period=period), current_user=HR_USER, db=db)
                    net_adj_901 = (await db.execute(text("SELECT net_salary FROM payrolls WHERE salary_period=:p AND employee_id=901"), {"p": period})).scalar_one()
                    # 14,505,556 + 1,000,000 (update kịch bản 5) + 500,000 (điều chỉnh tay) = 16,005,556
                    assert net_adj_901 == 16005556.0

                    # KỊCH BẢN 8: Revert -> xóa toàn bộ overrides, batch thành REVERTED
                    res_revert = await revert_payroll_import(PayrollImportRevertRequest(salary_period=period), current_user=HR_USER, db=db)
                    ov_rem = (await db.execute(text("SELECT count(*) FROM public.payroll_import_overrides WHERE salary_period=:p"), {"p": period})).scalar_one()
                    assert ov_rem == 0
                    batches_stat = (await db.execute(text("SELECT count(*) FROM public.payroll_import_batches WHERE salary_period=:p AND status='REVERTED'"), {"p": period})).scalar_one()
                    assert batches_stat >= 1

                    # KỊCH BẢN 9: Kỳ đã chốt trả 409
                    await db.execute(text("UPDATE payrolls SET payment_status = 'CONFIRMED' WHERE salary_period = :p"), {"p": period})
                    try:
                        await confirm_payroll_import(confirm_payload, current_user=HR_USER, db=db)
                        assert False, "Should have raised 409 for confirmed period"
                    except HTTPException as exc:
                        assert exc.status_code == 409
                        assert "đã duyệt" in exc.detail

                    # KỊCH BẢN 11: Mốc dữ liệu cũ bị chặn 409
                    await db.execute(text("UPDATE payrolls SET payment_status = 'DRAFT' WHERE salary_period = :p"), {"p": period})
                    try:
                        old_stamp_payload = PayrollImportConfirm(
                            salary_period=period, file_name="Old.xlsx", template_stamp="stale_stamp_from_past",
                            records=confirm_payload.records
                        )
                        await confirm_payroll_import(old_stamp_payload, current_user=HR_USER, db=db)
                        assert False, "Should have raised 409 for stale stamp"
                    except HTTPException as exc:
                        assert exc.status_code == 409
                        assert "thay đổi sau khi bạn tải file mẫu" in exc.detail

                    print("ALL 13 POSTGRES WORKFLOW SCENARIOS PASSED!")
            finally:
                await tx.rollback()


if __name__ == "__main__":
    asyncio.run(test_payroll_import_postgres_workflow())
