"""Thay toàn bộ dữ liệu phát sinh bằng bộ dữ liệu demo sạch (60 nhân viên, 08/2026 -> 06/11/2026).

XÓA dữ liệu nhân sự/nghiệp vụ, giữ danh mục. Chạy trong MỘT transaction, tự kiểm tra rồi mới commit.
Cố ý không đọc .env: phải truyền URL tường minh để không vô tình chạy vào database thật.

    SEED_DATABASE_URL=postgresql://... python scripts/seed_clean_data.py --dry-run   # chạy thử rồi rollback
    SEED_DATABASE_URL=postgresql://... python scripts/seed_clean_data.py --yes-wipe  # commit thật
"""
import argparse
import calendar
import json
import os
import random
import sys
from datetime import date, datetime, time, timedelta, timezone
from zoneinfo import ZoneInfo

import bcrypt
import psycopg2
from psycopg2.extras import Json, execute_values

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

VN = ZoneInfo("Asia/Ho_Chi_Minh")
CUTOFF = date(2026, 11, 6)            # không có chấm công/lương từ ngày này trở đi
LAST_ATTENDANCE = CUTOFF - timedelta(days=1)  # hôm nay để trống cho demo check-in
PERIOD_START = date(2026, 8, 1)
SCHEDULE_END = date(2026, 11, 30)     # lịch tương lai là kế hoạch, cần cho demo check-in
PERIODS = ["2026-08", "2026-09", "2026-10"]
HOLIDAYS = {date(2026, 9, 1), date(2026, 9, 2)}
DEMO_PASSWORD = "TechZone@2026"
SHIFTS = {1: (time(8), time(16), 7.0), 2: (time(13), time(21), 8.0), 4: (time(8), time(17), 8.0)}
SHIFT_NAMES = {1: "Ca sáng bán lẻ", 2: "Ca chiều bán lẻ", 4: "Ca hành chính văn phòng"}
ROLE = {"ADMIN": 1, "HR_MANAGER": 2, "STORE_MANAGER": 3, "EMPLOYEE": 4, "DIRECTOR": 5}
POS = {"ADMIN_SYS": 1, "HR_DIR": 2, "HR_STAFF": 3, "STORE_MGR": 4, "SALES_LEAD": 5,
       "SALES_STAFF": 6, "TECH_STAFF": 7, "CASHIER": 8, "DIRECTOR": 9}
SALARY = {"ADMIN_SYS": (15, 25), "HR_DIR": (18, 30), "HR_STAFF": (9, 14), "STORE_MGR": (14, 22),
          "SALES_LEAD": (10, 16), "SALES_STAFF": (7, 12), "TECH_STAFF": (8.5, 15),
          "CASHIER": (7.5, 11), "DIRECTOR": (50, 100)}
STORES = {1: date(2024, 1, 15), 2: date(2024, 6, 20), 3: date(2025, 2, 10),
          4: date(2025, 8, 5), 5: date(2025, 11, 12), 6: date(2026, 10, 14)}
# 9 nhân sự gốc: tài liệu, tài khoản demo và test đang nhắc tới họ. Ngày, cửa hàng, lương được chỉnh để đúng quy chế.
LEGACY = [
    dict(code="TZ-001", first="An", last="Nguyễn Văn", female=False, pos="ADMIN_SYS", store=None, role="ADMIN", mail="admin",
         personal="an.nguyen", join=date(2023, 1, 10), dob=date(1995, 4, 12), identity="079095000001", phone="0901112221",
         bank="Vietcombank CN HCM", account="1234567890", tax="8345672189", salary=21_000_000),
    dict(code="TZ-002", first="Bình", last="Trần Thị", female=True, pos="HR_DIR", store=None, role="HR_MANAGER", mail="hr_manager",
         personal="binh.tran", join=date(2023, 3, 1), dob=date(1992, 8, 25), identity="079092000002", phone="0902223332",
         bank="Techcombank CN Hội Sở", account="19038882223334", tax="8345672190", salary=22_000_000),
    dict(code="TZ-003", first="Cường", last="Lê Văn", female=False, pos="STORE_MGR", store=1, role="STORE_MANAGER", mail="store_mgr_q1",
         personal="cuong.le", join=date(2024, 1, 15), dob=date(1994, 11, 15), identity="079094000003", phone="0903334443",
         bank="Vietinbank CN Quận 1", account="102839485761", tax="8345672191", salary=16_500_000),
    dict(code="TZ-004", first="Dũng", last="Phạm Quốc", female=False, pos="SALES_STAFF", store=2, role="EMPLOYEE", mail="dung.pq",
         personal="dung.pham", join=date(2024, 5, 10), dob=date(2001, 2, 18), identity="079101000004", phone="0904445554",
         bank="Techcombank CN Tân Bình", account="19036788899999", tax="8345672192", salary=12_000_000),
    dict(code="TZ-005", first="Em", last="Hoàng Thị", female=True, pos="TECH_STAFF", store=5, role="EMPLOYEE", mail="em.ht",
         personal="em.hoang", join=date(2024, 6, 1), dob=date(2000, 9, 5), identity="079100000005", phone="0905556665",
         bank="Vietcombank CN Nam Sài Gòn", account="0381000456789", tax="8345672193", salary=9_500_000),
    dict(code="TZ-006", first="Giang", last="Vũ Trường", female=False, pos="SALES_LEAD", store=3, role="EMPLOYEE", mail="giang.vt",
         personal="giang.vu", join=date(2024, 6, 20), dob=date(1993, 7, 20), identity="079093000006", phone="0906667776",
         bank="Techcombank CN Gia Định", account="19037776665554", tax="8345672194", salary=12_000_000),
    dict(code="TZ-007", first="Hoa", last="Đỗ Mai", female=True, pos="STORE_MGR", store=3, role="STORE_MANAGER", mail="hoa.dm",
         personal="hoa.do", join=date(2024, 8, 1), dob=date(1998, 12, 10), identity="079098000007", phone="0907778887",
         bank="MB Bank CN TP.HCM", account="686899992222", tax="8345672195", salary=15_000_000),
    dict(code="TZ-008", first="Khánh", last="Ngô Quốc", female=False, pos="SALES_STAFF", store=1, role="EMPLOYEE", mail="khanh.nq",
         personal="khanh.ngo", join=date(2024, 2, 1), dob=date(1999, 5, 30), identity="079099000008", phone="0908889998",
         bank="ACB CN Bến Thành", account="090911223344", tax="8345672196", salary=8_000_000),
    dict(code="TZ-DIR", first="Vượng", last="Phạm Nguyệt", female=False, pos="DIRECTOR", store=None, role="DIRECTOR", mail="director",
         personal="vuong.pham", join=date(2024, 1, 1), dob=date(1980, 1, 1), identity="079080000009", phone="0909000001",
         bank="Vietcombank CN HCM", account="0071000123456", tax="8345672197", salary=60_000_000),
]
STORE_LINEUP = ["STORE_MGR", "SALES_LEAD", "SALES_STAFF", "SALES_STAFF", "SALES_STAFF",
                "SALES_STAFF", "TECH_STAFF", "TECH_STAFF", "CASHIER"]

# Con trước, cha sau. Các bảng sự kiện append-only được TRUNCATE riêng (trigger chặn DELETE).
APPEND_ONLY = ["overtime_reconciliation_case_events", "overtime_reconciliation_events", "overtime_request_events"]
WIPE = ["overtime_reconciliation_cases", "attendance_overtime_approvals", "overtime_reconciliations",
        "overtime_requests", "mobile_attendance_proofs", "attendance_photo_proofs", "attendances",
        "work_schedule_audits", "work_schedules", "fixed_schedule_audits", "fixed_schedule_rules",
        "leave_requests", "resignation_requests", "payroll_details", "payroll_manual_adjustments", "payrolls",
        "payroll_calculation_runs", "payroll_period_bonuses", "payroll_period_overrides",
        "payroll_import_overrides", "payroll_import_batches", "commissions", "employee_sales",
        "project_members", "position_histories", "contracts", "ai_chat_action_proposals", "ai_chat_messages",
        "notification_reads", "notifications", "audit_logs", "user_roles", "users", "employees"]

MALE = ["An", "Bảo", "Cường", "Dũng", "Đạt", "Đức", "Hải", "Hiếu", "Hoàng", "Huy", "Khang", "Khoa", "Kiên",
        "Lâm", "Long", "Minh", "Nam", "Nghĩa", "Phát", "Phong", "Phúc", "Quân", "Quang", "Sơn", "Tài", "Thắng",
        "Thành", "Thịnh", "Tiến", "Trung", "Tuấn", "Việt", "Vinh"]
FEMALE = ["Anh", "Châu", "Chi", "Diệp", "Dung", "Giang", "Hà", "Hạnh", "Hiền", "Hoa", "Hương", "Lan", "Linh",
          "Loan", "Mai", "My", "Nga", "Ngân", "Ngọc", "Nhung", "Oanh", "Phương", "Quyên", "Tâm", "Thảo", "Thu",
          "Thủy", "Trang", "Trâm", "Uyên", "Vân", "Vy", "Yến"]
SURNAMES = ["Nguyễn", "Trần", "Lê", "Phạm", "Hoàng", "Huỳnh", "Phan", "Vũ", "Võ", "Đặng", "Bùi", "Đỗ", "Hồ", "Ngô", "Dương"]
MIDDLE_M = ["Văn", "Quốc", "Minh", "Đức", "Hữu", "Thanh", "Gia", "Anh"]
MIDDLE_F = ["Thị", "Ngọc", "Thu", "Mai", "Thanh", "Kim", "Bích", "Hoài"]
STREETS = [("Lý Tự Trọng", "Phường Sài Gòn"), ("Tú Xương", "Phường Xuân Hòa"), ("Phan Đăng Lưu", "Phường Bình Thạnh"),
           ("Trường Chinh", "Phường Tân Bình"), ("Thành Thái", "Phường Diên Hồng"), ("Quang Trung", "Phường Gò Vấp"),
           ("Tôn Đức Thắng", "Phường Sài Gòn"), ("Trần Quốc Thảo", "Phường Xuân Hòa"), ("Hậu Giang", "Phường Bình Tiên"),
           ("An Dương Vương", "Phường Chợ Quán"), ("Cộng Hòa", "Phường Tân Sơn Nhất"), ("Lê Văn Sỹ", "Phường Nhiêu Lộc")]
BANKS = ["Vietcombank CN HCM", "Techcombank CN Tân Bình", "Vietinbank CN Quận 1", "MB Bank CN TP.HCM", "ACB CN Bến Thành"]
STORE_SLUG = {1: "q1", 2: "q3", 3: "q6", 4: "bt", 5: "tb", 6: "q5"}
# Đơn nghỉ ốm/thai sản bắt buộc có minh chứng (TZ-DOC-04): dùng lại tệp đã upload trong dữ liệu cũ.
PROOF_URL = "https://res.cloudinary.com/fnh16fft/image/upload/v1793029528/techzone-leaves/4/48535d64-c01.png"
LEAVE_REASONS = {1: ["Về quê thăm gia đình", "Nghỉ phép năm đi du lịch cùng gia đình", "Giải quyết việc gia đình"],
                 2: ["Sốt siêu vi, có giấy khám bệnh", "Đau dạ dày cấp, bác sĩ yêu cầu nghỉ ngơi"],
                 4: ["Đám cưới em ruột", "Tang lễ người thân"],
                 5: ["Việc cá nhân đột xuất", "Chăm người nhà nằm viện"]}
OT_REASONS = ["Tăng ca kiểm kê hàng tồn kho", "Tăng ca phụ trách đợt khuyến mãi", "Tăng ca chốt doanh thu quầy thu ngân",
              "Tăng ca nhận và sắp xếp lô hàng mới", "Tăng ca xử lý đơn bảo hành tồn"]


def shift_times(shift_id, day):
    # TZ-DOC-01: khối văn phòng làm Thứ 7 buổi sáng 08:00-12:00.
    return (time(8), time(12), 4.0) if shift_id == 4 and day.weekday() == 5 else SHIFTS[shift_id]


def last_work_day(p):
    if p.get("maternity"):
        return p["maternity"] - timedelta(days=1)
    return p["resign"]


def vn(day, at):
    return datetime.combine(day, at, VN)


def month_end(period):
    y, m = map(int, period.split("-"))
    return date(y, m, calendar.monthrange(y, m)[1])


def add_years(day, years):
    return day.replace(year=day.year + years, day=min(day.day, 28))


def weekdays_between(start, end):
    day = start
    while day <= end:
        yield day
        day += timedelta(days=1)


def insert(cur, table, cols, rows):
    if rows:
        execute_values(cur, f"INSERT INTO {table} ({','.join(cols)}) VALUES %s", rows, page_size=1000)


def wipe(cur):
    cur.execute(f"TRUNCATE {','.join(APPEND_ONLY)}")
    for table in WIPE[:-2]:
        cur.execute(f"DELETE FROM {table}")
    # Bảng giữ lại nhưng trỏ tới users/employees: gỡ tham chiếu trước khi xóa người.
    cur.execute("""
        SELECT c.conrelid::regclass::text, a.attname FROM pg_constraint c
        JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=ANY(c.conkey)
        WHERE c.contype='f' AND c.confrelid IN ('public.users'::regclass,'public.employees'::regclass)
          AND c.connamespace='public'::regnamespace""")
    wiped = set(WIPE) | set(APPEND_ONLY)
    for table, column in cur.fetchall():
        if table.replace("public.", "") not in wiped:
            cur.execute(f"UPDATE {table} SET {column}=NULL WHERE {column} IS NOT NULL")
    cur.execute("DELETE FROM users")
    cur.execute("DELETE FROM employees")
    cur.execute("DELETE FROM departments WHERE department_code='BGD'")  # trùng với BOD


def build_people(rng):
    specs = [("HR_STAFF", None, "EMPLOYEE")] * 3
    for store in STORES:
        specs += [(p, store, "STORE_MANAGER" if p == "STORE_MGR" else "EMPLOYEE") for p in STORE_LINEUP]
    people = []
    for idx, person in enumerate(LEGACY, 1):
        # Hoa là cửa hàng trưởng cũ của Q6, nên chiếm một chỗ bán hàng thay vì chỗ của người kế nhiệm.
        slot = ("SALES_STAFF", 3, "EMPLOYEE") if person["code"] == "TZ-007" else (person["pos"], person["store"], person["role"])
        if slot in specs:
            specs.remove(slot)
        people.append(dict(person, id=idx, legacy=True, status="ACTIVE", resign=None,
                           shift=4 if person["store"] is None else (1 if idx % 2 else 2)))
    seen_names = {(p["last"], p["first"]) for p in people}
    seen_mail = {p["mail"] for p in people}
    for idx, (pos, store, role) in enumerate(specs, len(people) + 1):
        while True:
            female = rng.random() < 0.45
            given = rng.choice(FEMALE if female else MALE)
            surname = rng.choice(SURNAMES)
            last = f"{surname} {rng.choice(MIDDLE_F if female else MIDDLE_M)}"
            if (last, given) not in seen_names:
                seen_names.add((last, given))
                break
        initials = "".join(word[0] for word in last.split())
        base = f"store_mgr_{STORE_SLUG[store]}" if pos == "STORE_MGR" else _ascii(f"{given}.{initials}")
        mail, n = base, 1
        while mail in seen_mail:
            n += 1
            mail = f"{base}{n}"
        seen_mail.add(mail)
        if store is None:
            join = date(2023, 1, 10) + timedelta(days=rng.randint(0, 500))
        elif store == 6:
            join = STORES[6]  # chi nhánh khai trương 14/10/2026
        else:
            latest = min(STORES[store] + timedelta(days=400), date(2026, 5, 15))
            join = STORES[store] + timedelta(days=0 if pos == "STORE_MGR" else rng.randint(0, (latest - STORES[store]).days))
        lo, hi = SALARY[pos]
        dob = date(rng.randint(1978, 1985) if store is None or pos == "STORE_MGR" else rng.randint(1990, 2004),
                   rng.randint(1, 12), rng.randint(1, 28))
        people.append(dict(id=idx, code=f"TZ-{idx - 1:03d}", pos=pos, store=store, role=role, first=given, last=last,
                           female=female, mail=mail, personal=_ascii(f"{given}.{surname}"), join=join, status="ACTIVE",
                           resign=None, salary=int(rng.uniform(lo, hi) * 10) * 100_000, dob=dob,
                           identity=f"079{dob.year // 1000 - 1}{dob.year % 100:02d}{idx:06d}", phone=f"09{idx + 10000000:08d}",
                           bank=rng.choice(BANKS), account=f"19{idx + 3000000000:010d}", tax=str(8345672188 + idx),
                           shift=4 if store is None else (1 if idx % 2 else 2)))
    for p in people:
        p["username"] = p["code"].replace("-", "").lower()
    return people


def _ascii(value):
    import unicodedata
    value = value.replace("đ", "d").replace("Đ", "D")
    return "".join(c for c in unicodedata.normalize("NFD", value) if unicodedata.category(c) != "Mn").lower()


def manager_on(people, store, day):
    managers = [p for p in people if p["store"] == store and p["pos"] == "STORE_MGR"]
    return next((p for p in managers if p["join"] <= day and (p["resign"] is None or p["resign"] >= day)), managers[-1])


def apply_story(people):
    """Gán các nhân vật tình huống cho demo: thử việc, sắp hết hạn, thôi việc, thai sản."""
    by_store = lambda store, pos: [p for p in people if p["store"] == store and p["pos"] == pos and not p.get("legacy")]
    legacy = {p["code"]: p for p in people}
    for offset, store in enumerate((1, 2, 3, 4)):
        by_store(store, "SALES_STAFF")[-1].update(status="PROBATION", join=date(2026, 9, 21) + timedelta(days=offset * 7))
    for offset, p in enumerate(by_store(5, "SALES_STAFF")[:3] + by_store(5, "CASHIER")):
        p.update(join=date(2025, 11, 17) + timedelta(days=offset * 6), expiring=True)
    by_store(3, "STORE_MGR")[0]["join"] = date(2026, 10, 16)  # kế nhiệm Đỗ Mai Hoa
    story = dict(resigned=[(legacy["TZ-008"], date(2026, 8, 31), "Chuyển nơi sinh sống về Đồng Nai"),
                           (legacy["TZ-007"], date(2026, 10, 15), "Theo học chương trình sau đại học")],
                 pending=by_store(3, "SALES_STAFF")[0], rejected=by_store(4, "CASHIER")[0])
    for p, last_day, _ in story["resigned"]:
        p["resign"] = last_day
    mother = next(p for p in people if p["female"] and p["store"] in (1, 2, 3, 5) and p["pos"] in ("TECH_STAFF", "CASHIER")
                  and not p.get("legacy") and p is not story["rejected"] and not p.get("expiring"))
    mother.update(status="ON_LEAVE", maternity=date(2026, 10, 1))
    story["maternity"] = mother
    return story


def seed_people(cur, rng, people, pw_hash):
    emp, users, roles = [], [], []
    for p in people:
        street, ward = rng.choice(STREETS)
        address = f"{rng.randint(5, 480)} {street}, {ward}, Thành phố Hồ Chí Minh"
        emp.append((p["id"], p["code"], p["first"], p["last"], "FEMALE" if p["female"] else "MALE", p["dob"],
                    p["identity"], date(2021, 4, 12), "Cục Cảnh sát QLHC về TTXH",
                    p["phone"], f"{p['personal']}@gmail.com", f"{p['mail']}@techzone.vn", address, address,
                    p["store"], 5 if p["store"] else (1 if p["pos"] in ("DIRECTOR", "ADMIN_SYS") else 2), POS[p["pos"]],
                    4 if p["pos"] in ("HR_DIR", "HR_STAFF", "ADMIN_SYS", "STORE_MGR", "DIRECTOR") else rng.choice((1, 2, 3)),
                    p["join"], p["status"], p["account"], p["bank"], p["tax"], f"79{p['id'] + 26000000:08d}"))
        users.append((p["id"], p["id"], p["username"], pw_hash, f"{p['mail']}@techzone.vn", p["phone"], True))
        roles.append((p["id"], ROLE[p["role"]]))
    insert(cur, "employees", ["employee_id", "employee_code", "first_name", "last_name", "gender", "dob", "identity_card",
                              "identity_issued_date", "identity_issued_place", "phone", "personal_email", "company_email",
                              "permanent_address", "current_address", "store_id", "department_id", "position_id",
                              "education_level_id", "join_date", "employment_status", "bank_account_number", "bank_name",
                              "tax_code", "insurance_code"], emp)
    insert(cur, "users", ["user_id", "employee_id", "username", "password_hash", "email", "phone", "is_active"], users)
    insert(cur, "user_roles", ["user_id", "role_id"], roles)
    for p in people:
        if p["pos"] == "STORE_MGR" and not p["resign"]:
            cur.execute("UPDATE stores SET manager_employee_id=%s WHERE store_id=%s", (p["id"], p["store"]))


def seed_contracts(cur, rng, people, hr_user):
    rows, next_id, renewals, per_year = [], 1, 0, {}

    def add(p, ctype, start, end, status, previous=None):
        nonlocal next_id
        per_year[start.year] = per_year.get(start.year, 0) + 1
        p["ctype"] = ctype
        dept = 5 if p["store"] else (1 if p["pos"] in ("DIRECTOR", "ADMIN_SYS") else 2)
        rows.append((next_id, f"HD-{start.year}-{per_year[start.year]:04d}", p["id"], ctype, start, end, p["salary"], p["salary"], 100,
                     40 if p["pos"] == "DIRECTOR" else 48, status, start - timedelta(days=2), hr_user, previous, POS[p["pos"]], dept))
        next_id += 1
        return next_id - 1

    for p in people:
        join = p["join"]
        if p["status"] == "PROBATION":
            p["contract"] = add(p, "PROBATION", join, join + timedelta(days=89), "ACTIVE")
        elif p.get("expiring"):
            p["contract"] = add(p, "FIXED_1_YEAR", join, add_years(join, 1) - timedelta(days=1), "ACTIVE")
        elif join >= date(2025, 8, 1):
            p["contract"] = add(p, "FIXED_2_YEAR", join, add_years(join, 2) - timedelta(days=1), "ACTIVE")
        elif renewals < 10 and join <= date(2025, 6, 30) and p["store"]:
            renewals += 1
            first_end = add_years(join, 1) - timedelta(days=1)
            old = add(p, "FIXED_1_YEAR", join, first_end, "EXPIRED")
            start = first_end + timedelta(days=1)
            p["contract"] = add(p, "FIXED_3_YEAR", start, add_years(start, 3) - timedelta(days=1), "ACTIVE", old)
        else:
            p["contract"] = add(p, "INDEFINITE", join, None, "ACTIVE")
    insert(cur, "contracts", ["contract_id", "contract_number", "employee_id", "contract_type", "start_date", "end_date",
                              "basic_salary", "insurance_salary", "salary_percentage", "working_hours_per_week", "status",
                              "signed_date", "created_by", "previous_contract_id", "position_id", "department_id"], rows)


def worker_days(p):
    """Ngày phải đi làm (T2-T7, trừ lễ) trong kỳ, tính cả kế hoạch tới hết tháng 11."""
    start = max(PERIOD_START, p["join"])
    end = min(SCHEDULE_END, last_work_day(p) or SCHEDULE_END)
    return [d for d in weekdays_between(start, end) if d.weekday() != 6 and d not in HOLIDAYS]


def seed_schedules(cur, people, hr_user):
    """Trả về {(employee_id, ngày): schedule}. Giám đốc không chấm công nên không có lịch."""
    rules, rows, schedules, next_id = [], [], {}, 1
    for p in people:
        if p["pos"] == "DIRECTOR":
            continue
        store = p["store"] or 1
        rule_start = max(PERIOD_START, p["join"])
        final_day = last_work_day(p)
        stopped = vn(final_day, time(21)) if final_day else None
        note = "Phân ca nhân viên thử việc" if p["status"] == "PROBATION" else "Phân ca nhân viên chính thức"
        rules.append((p["id"], p["id"], store, p["shift"], rule_start, note, hr_user,
                      vn(rule_start, time(8)) - timedelta(days=3), stopped, "1,2,3,4,5,6", final_day))
        for day in worker_days(p):
            start_t, end_t, _ = shift_times(p["shift"], day)
            sch = dict(schedule_id=next_id, shift_id=p["shift"], store_id=store,
                       starts_at=vn(day, start_t).isoformat(), ends_at=vn(day, end_t).isoformat(), candidate_count=1)
            schedules[(p["id"], day)] = sch
            rows.append((next_id, p["id"], store, p["shift"], day, note,
                         vn(day, start_t), vn(day, end_t), p["id"]))
            next_id += 1
    insert(cur, "fixed_schedule_rules", ["rule_id", "employee_id", "store_id", "shift_id", "start_date", "notes", "created_by",
                                         "created_at", "stopped_at", "weekdays", "end_date"], rules)
    insert(cur, "work_schedules", ["schedule_id", "employee_id", "store_id", "shift_id", "work_date", "notes", "starts_at",
                                   "ends_at", "fixed_rule_id"], rows)
    return schedules, next_id


def seed_leaves(cur, rng, people, by_role):
    """Đơn HR_APPROVED trả về {(employee_id, ngày): (trạng thái chấm công, ghi chú)} để thay dòng chấm công."""
    hr, director = by_role["HR_DIR"], by_role["DIRECTOR"]
    managers = {p["store"]: p for p in people if p["pos"] == "STORE_MGR"}
    staff = [p for p in people if p["store"] and p["pos"] != "STORE_MGR" and p["status"] == "ACTIVE" and not p["resign"]]
    used, rows, leave_days, used_annual = set(), [], {}, {}
    type_names = {1: "Nghỉ phép năm", 2: "Nghỉ ốm đau (Hưởng BHXH)", 4: "Nghỉ việc riêng hưởng nguyên lương", 5: "Nghỉ không hưởng lương"}

    def pick_range(p, lo, hi, length):
        for _ in range(60):
            start = lo + timedelta(days=rng.randint(0, (hi - lo).days))
            days = []
            day = start
            while len(days) < length:
                if day.weekday() != 6 and day not in HOLIDAYS:
                    days.append(day)
                day += timedelta(days=1)
            if start.weekday() != 6 and days[-1] - days[0] == timedelta(days=length - 1) and days[0] >= p["join"] + timedelta(days=30) \
                    and not any((p["id"], d) in used for d in days):
                used.update((p["id"], d) for d in days)
                return days
        return None

    def add(p, ltype, days, status, reject=None):
        created = vn(days[0], time(9)) - timedelta(days=rng.randint(3, 7))
        created = min(created, vn(CUTOFF, time(9)) - timedelta(hours=rng.randint(2, 30)))
        approved = created + timedelta(hours=rng.randint(3, 20))
        hr_at = approved + timedelta(hours=rng.randint(3, 24))
        is_office_lead = p["role"] in ("HR_MANAGER", "ADMIN")
        is_manager = p["role"] == "STORE_MANAGER"
        mgr = None if is_office_lead or is_manager else manager_on(people, p["store"], days[0])["id"]
        store_at = approved if mgr and status in ("STORE_APPROVED", "HR_APPROVED") else None
        final_hr = hr["id"] if status == "HR_APPROVED" and not is_office_lead else None
        final_dir = director["id"] if status == "HR_APPROVED" and is_office_lead else None
        rows.append((p["id"], ltype, days[0], days[-1], float(len(days)), rng.choice(LEAVE_REASONS[ltype]),
                     PROOF_URL if ltype == 2 else None, status,
                     mgr if store_at else None, store_at, "Đồng ý, đã sắp xếp người thay ca" if store_at else None,
                     final_hr, hr_at if final_hr else None, reject,
                     (mgr or hr["id"]) if reject else None, approved if reject else None, final_dir,
                     hr_at if final_dir else None, created))
        if status == "HR_APPROVED":
            state = "ANNUAL_LEAVE" if ltype in (1, 4) else "UNPAID_LEAVE"
            note = f"{type_names[ltype]} - {'Hưởng lương' if state == 'ANNUAL_LEAVE' else 'Có trừ lương'}"
            leave_days.update({(p["id"], d): (state, note) for d in days})

    past_hi = date(2026, 10, 30)
    for _ in range(42):
        p = rng.choice(staff)
        ltype = rng.choices((1, 2, 4, 5), (60, 15, 10, 15))[0]
        length = rng.randint(1, 3)
        if ltype == 1 and used_annual.get(p["id"], 0) + length > 8:
            ltype = 5
        days = pick_range(p, PERIOD_START, past_hi, length)
        if days:
            if ltype == 1:
                used_annual[p["id"]] = used_annual.get(p["id"], 0) + length
            add(p, ltype, days, "HR_APPROVED")
    for p in list(managers.values())[:5]:  # cửa hàng trưởng bỏ qua cấp 1
        days = pick_range(p, PERIOD_START if p["join"] < PERIOD_START else p["join"], past_hi, 1)
        if days:
            add(p, 1, days, "HR_APPROVED")
    for p in (hr, by_role["ADMIN_SYS"]):  # HR/Admin do Giám đốc duyệt
        days = pick_range(p, PERIOD_START, past_hi, 2)
        add(p, 1, days, "HR_APPROVED")
    for _ in range(8):
        days = pick_range(p := rng.choice(staff), PERIOD_START, past_hi, rng.randint(1, 2))
        if days:
            add(p, rng.choice((1, 5)), days, "REJECTED", "Trùng lịch cao điểm, cửa hàng không đủ nhân sự")
    for _ in range(4):
        days = pick_range(p := rng.choice(staff), PERIOD_START, past_hi, 1)
        if days:
            add(p, 1, days, "CANCELLED")
    future = (date(2026, 11, 9), date(2026, 11, 27))
    for status, count in (("PENDING", 8), ("STORE_APPROVED", 6)):  # đơn cho ngày sắp tới, chờ duyệt để demo
        for _ in range(count):
            days = pick_range(p := rng.choice(staff), *future, rng.randint(1, 3))
            if days:
                add(p, 1, days, status)
    days = pick_range(next(iter(managers.values())), *future, 2)  # đơn của cửa hàng trưởng chờ HR
    add(next(iter(managers.values())), 1, days, "PENDING")
    mother = next(p for p in people if p.get("maternity"))
    start = mother["maternity"]
    approved = vn(start, time(9)) - timedelta(days=20)
    rows.append((mother["id"], 3, start, start + timedelta(days=179), 180.0, "Nghỉ chế độ thai sản theo quy định luật lao động",
                 PROOF_URL, "HR_APPROVED", managers[mother["store"]]["id"], approved - timedelta(hours=6), "Đồng ý, đã sắp xếp người thay ca",
                 hr["id"], approved, None, None, None, None, None, approved - timedelta(days=1)))
    insert(cur, "leave_requests", ["employee_id", "leave_type_id", "start_date", "end_date", "total_days", "reason", "attachment_url", "status",
                                   "store_manager_id", "store_approved_at", "store_manager_note", "hr_approver_id", "hr_approved_at",
                                   "rejection_reason", "rejected_by_id", "rejected_at", "director_approver_id",
                                   "director_approved_at", "created_at"], rows)
    return leave_days, len(rows)


def context(sch, shift_id, day):
    start, end, hours = shift_times(shift_id, day)
    return dict(version=1, schedule_status="MATCHED", planned=sch,
                actual=dict(shift_id=shift_id, shift_name=SHIFT_NAMES[shift_id], start_time=start.isoformat(),
                            end_time=end.isoformat(), work_hours=hours))


def attendance_row(aid, p, day, sch, rng, leave):
    store, shift = sch["store_id"], sch["shift_id"]
    start_t, end_t, hours = shift_times(shift, day)
    ctx = context(sch, shift, day)
    base = dict(id=aid, emp=p["id"], store=store, shift=shift, day=day, cin=None, cout=None, late=0, early=0, ot=0.0,
                hours=0.0, status="NORMAL", notes=None, ctx=ctx)
    if leave:
        return dict(base, status=leave[0], notes=leave[1])
    roll = rng.random()
    if roll < 0.008:
        return dict(base, status="ABSENT", notes="Vắng không phép")
    cin = vn(day, start_t) - timedelta(minutes=rng.randint(1, 14))
    cout = vn(day, end_t) + timedelta(minutes=rng.randint(0, 8))
    late = early = 0
    status = "NORMAL"
    if roll < 0.04:      # trễ trong ân hạn
        late = rng.randint(1, 15)
        cin = vn(day, start_t) + timedelta(minutes=late)
    elif roll < 0.07:    # trễ quá ân hạn, bị phạt
        late = rng.randint(16, 70)
        cin = vn(day, start_t) + timedelta(minutes=late)
        status = "LATE"
    elif roll < 0.09:    # về sớm
        early = rng.randint(10, 60)
        cout = vn(day, end_t) - timedelta(minutes=early)
        status = "EARLY"
    elif roll < 0.095:   # vừa muộn vừa sớm
        late, early = rng.randint(16, 40), rng.randint(10, 40)
        cin = vn(day, start_t) + timedelta(minutes=late)
        cout = vn(day, end_t) - timedelta(minutes=early)
        status = "LATE_AND_EARLY"
    elif roll < 0.105:   # quên check-out: lượt mở chặn mọi lần check-in sau; TZ-DOC-08: HR xác minh, CHT không được sửa
        return dict(base, cin=cin, cout=vn(day, end_t), hours=hours,
                    notes="Quên check-out, HR đã xác minh phiên bất thường")
    worked = max(0.0, hours - (late if late > 15 else 0) / 60 - early / 60)
    return dict(base, cin=cin, cout=cout, late=late, early=early, hours=round(worked, 2), status=status)


def seed_attendance(cur, rng, people, schedules, leave_days):
    rows, att_id, index = [], 1, {}
    for p in people:
        for day in worker_days(p):
            if day > LAST_ATTENDANCE or (p["id"], day) not in schedules:
                continue
            row = attendance_row(att_id, p, day, schedules[(p["id"], day)], rng, leave_days.get((p["id"], day)))
            rows.append(row)
            index[(p["id"], day)] = row
            att_id += 1
    return rows, index, att_id


def flush_attendance(cur, rows):
    insert(cur, "attendances", ["attendance_id", "employee_id", "store_id", "shift_id", "work_date", "check_in_time",
                                "check_out_time", "late_minutes", "early_minutes", "overtime_hours", "actual_work_hours",
                                "status", "notes", "attendance_context"],
           [(r["id"], r["emp"], r["store"], r["shift"], r["day"], r["cin"], r["cout"], r["late"], r["early"], r["ot"],
             r["hours"], r["status"], r["notes"], Json(r["ctx"])) for r in rows])


def seed_overtime(cur, rng, people, by_role, schedules, att_rows, att_index, next_sched, next_att):
    hr_user = by_role["HR_DIR"]["id"]
    morning = [p for p in people if p["store"] and p["shift"] == 1 and p["pos"] != "STORE_MGR" and p["store"] != 6
               and p["status"] == "ACTIVE" and not p["resign"]]
    extra_sched, requests, events, recon, recon_events = [], [], [], [], []
    taken = set()

    def overtime_window(day, hours):
        return vn(day, time(16)), vn(day, time(16)) + timedelta(hours=hours)

    def normal_day(p, lo, hi):
        for _ in range(200):
            day = lo + timedelta(days=rng.randint(0, (hi - lo).days))
            row = att_index.get((p["id"], day))
            if row and row["status"] == "NORMAL" and row["cout"] and row["late"] == 0 and (p["id"], day) not in taken:
                taken.add((p["id"], day))
                return day, row
        return None, None

    def extra_day(p, day):
        """Trực Chủ nhật / ngày lễ: thêm lịch + chấm công rồi tăng ca sau ca."""
        nonlocal next_sched, next_att
        start_t, end_t, hours = SHIFTS[1]
        sch = dict(schedule_id=next_sched, shift_id=1, store_id=p["store"], starts_at=vn(day, start_t).isoformat(),
                   ends_at=vn(day, end_t).isoformat(), candidate_count=1)
        extra_sched.append((next_sched, p["id"], p["store"], 1, day, "Trực theo kế hoạch cao điểm", vn(day, start_t), vn(day, end_t)))
        next_sched += 1
        row = dict(id=next_att, emp=p["id"], store=p["store"], shift=1, day=day, cin=vn(day, time(7, 55)),
                   cout=vn(day, end_t), late=0, early=0, ot=0.0, hours=hours, status="NORMAL", notes=None, ctx=context(sch, 1, day))
        next_att += 1
        att_rows.append(row)
        taken.add((p["id"], day))
        return row

    def add_request(p, day, hours, status, row=None, recon_status=None, reason_extra=None):
        rid = len(requests) + 1
        start, end = overtime_window(day, hours)
        created = min(start - timedelta(days=2), vn(CUTOFF, time(9)) - timedelta(hours=4))
        manager_user = manager_on(people, p["store"], day)["id"]
        confirmed = created + timedelta(hours=3)
        reviewed = created + timedelta(hours=8)
        has_review = status in ("APPROVED", "REJECTED")
        self_registered = status in ("PENDING_HR", "APPROVED", "REJECTED") and rng.random() < 0.5
        creator = p["id"] if self_registered else manager_user
        requests.append((rid, p["id"], p["store"], day, start, end, rng.choice(OT_REASONS), creator, status,
                         confirmed if status in ("PENDING_HR", "APPROVED", "REJECTED") else None,
                         confirmed if status in ("PENDING_HR", "APPROVED", "REJECTED", "EMPLOYEE_DECLINED") else None,
                         hr_user if has_review else None, reviewed if has_review else None,
                         "Không đủ ngân sách tăng ca tháng này" if status == "REJECTED" else None,
                         manager_user if status == "CANCELLED" else None, confirmed if status == "CANCELLED" else None, created))
        flow = [("CREATE", None, "DRAFT", creator, created),
                ("SUBMIT", "DRAFT", "PENDING_HR" if self_registered else "PENDING_EMPLOYEE_CONFIRMATION", creator,
                 created + timedelta(minutes=5))]
        if status in ("PENDING_HR", "APPROVED", "REJECTED") and not self_registered:
            flow.append(("EMPLOYEE_CONFIRM", "PENDING_EMPLOYEE_CONFIRMATION", "PENDING_HR", p["id"], confirmed))
        if status == "APPROVED":
            flow.append(("APPROVE", "PENDING_HR", "APPROVED", hr_user, reviewed))
        if status == "REJECTED":
            flow.append(("REJECT", "PENDING_HR", "REJECTED", hr_user, reviewed))
        if status == "EMPLOYEE_DECLINED":
            flow.append(("EMPLOYEE_DECLINE", "PENDING_EMPLOYEE_CONFIRMATION", "EMPLOYEE_DECLINED", p["id"], confirmed))
        if status == "CANCELLED":
            flow.append(("CANCEL", "PENDING_EMPLOYEE_CONFIRMATION", "CANCELLED", manager_user, confirmed))
        events.extend((rid, actor, action, frm, to, at) for action, frm, to, actor, at in flow)
        if row is None:
            return
        row["cout"] = end
        row["status"] = "OVERTIME"
        row["hours"] = round(SHIFTS[1][2] + hours, 2)
        micro = int(hours * 3_600_000_000)
        interval = [dict(starts_at=start.astimezone(timezone.utc).isoformat(), ends_at=end.astimezone(timezone.utc).isoformat())]
        issues = []
        if recon_status == "NEEDS_REVIEW":
            row["ctx"] = dict(row["ctx"], schedule_status="SHIFT_MISMATCH")
            row["notes"] = "Chấm công lệch ca so với lịch phân công"
            micro, interval, issues = 0, [], ["SCHEDULE_SNAPSHOT_MISSING_OR_MISMATCH"]
        decided = recon_status in ("VERIFIED", "REJECTED")
        review_at = end + timedelta(days=2)
        recon.append(dict(rid=rid, emp=p["id"], store=p["store"], status=recon_status, version=2 if decided else 1, proposed=micro,
                          verified=micro if recon_status == "VERIFIED" else None, intervals=interval, att=[row["id"]], issues=issues,
                          reviewed_by=hr_user if decided else None, reviewed_at=review_at if decided else None,
                          reason="Không có xác nhận của cửa hàng trưởng" if recon_status == "REJECTED" else None,
                          calc=end + timedelta(days=1)))

    aug_oct = (date(2026, 8, 3), date(2026, 10, 30))
    nov = (date(2026, 11, 2), date(2026, 11, 3))
    for _ in range(26):
        p = rng.choice(morning)
        day, row = normal_day(p, *aug_oct)
        if row:
            add_request(p, day, rng.choice((1, 1.5, 2, 2, 3)), "APPROVED", row, "VERIFIED")
    for day in (date(2026, 8, 30), date(2026, 9, 27), date(2026, 10, 25)):  # Chủ nhật 200%
        p = rng.choice(morning)
        add_request(p, day, 2, "APPROVED", extra_day(p, day), "VERIFIED")
    for p in rng.sample(morning, 2):                                         # Lễ 02/09 300%
        add_request(p, date(2026, 9, 2), 2, "APPROVED", extra_day(p, date(2026, 9, 2)), "VERIFIED")
    for recon_status, lo_hi, count in (("PENDING_RECONCILIATION", nov, 3), ("NEEDS_REVIEW", (date(2026, 10, 19), date(2026, 10, 30)), 2),
                                       ("REJECTED", aug_oct, 2)):
        for _ in range(count):
            p = rng.choice(morning)
            day, row = normal_day(p, *lo_hi)
            if row:
                add_request(p, day, 2, "APPROVED", row, recon_status)
    for status, count in (("REJECTED", 3), ("EMPLOYEE_DECLINED", 2), ("CANCELLED", 2)):
        for _ in range(count):
            p = rng.choice(morning)
            day, row = normal_day(p, *aug_oct)
            if day:
                add_request(p, day, 2, status)
    for status, count in (("PENDING_HR", 3), ("PENDING_EMPLOYEE_CONFIRMATION", 2)):  # đề xuất cho ngày sắp tới
        for offset in range(count):
            add_request(rng.choice(morning), date(2026, 11, 10) + timedelta(days=offset * 2), 2, status)

    insert(cur, "work_schedules", ["schedule_id", "employee_id", "store_id", "shift_id", "work_date", "notes", "starts_at", "ends_at"], extra_sched)
    flush_attendance(cur, att_rows)
    insert(cur, "overtime_requests", ["request_id", "employee_id", "store_id", "work_date", "starts_at", "ends_at", "reason", "created_by",
                                      "status", "employee_confirmed_at", "employee_responded_at", "reviewed_by", "reviewed_at",
                                      "rejection_reason", "cancelled_by", "cancelled_at", "created_at"], requests)
    insert(cur, "overtime_request_events", ["request_id", "actor_id", "action", "from_status", "to_status", "created_at"], events)
    for r in recon:
        cur.execute("""INSERT INTO overtime_reconciliations (request_id,employee_id,store_id,status,version,source_signature,
            proposed_microseconds,verified_microseconds,eligible_intervals,attendance_ids,review_issues,reviewed_by,reviewed_at,
            decision_reason,calculated_at,created_at,updated_at) VALUES (%s,%s,%s,%s,%s,'pending',%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)""",
                    (r["rid"], r["emp"], r["store"], r["status"], r["version"], r["proposed"], r["verified"], Json(r["intervals"]),
                     Json(r["att"]), Json(r["issues"]), r["reviewed_by"], r["reviewed_at"], r["reason"], r["calc"], r["calc"],
                     r["reviewed_at"] or r["calc"]))
    return recon, len(requests)


def finalize_reconciliations(cur, recon, hr_user):
    # Chữ ký băm cả overtime_hours/updated_at của chấm công; trigger sync đã đổi chúng nên phải tính sau cùng,
    # và tắt trigger khi ghi chữ ký để nó không đổi tiếp. Sai chữ ký thì đơn đã duyệt tự rơi về NEEDS_REVIEW.
    cur.execute("ALTER TABLE overtime_reconciliations DISABLE TRIGGER trg_sync_ot_reconciliation_to_approvals")
    cur.execute("UPDATE overtime_reconciliations SET source_signature=public.ot_reconciliation_source_signature(request_id)")
    cur.execute("ALTER TABLE overtime_reconciliations ENABLE TRIGGER trg_sync_ot_reconciliation_to_approvals")
    rows = []
    for r in recon:
        first = "NEEDS_REVIEW" if r["status"] == "NEEDS_REVIEW" else "PENDING_RECONCILIATION"
        payload = dict(status=first, version=1, proposed_microseconds=r["proposed"], verified_microseconds=None,
                       attendance_ids=r["att"], review_issues=r["issues"])
        rows.append((r["rid"], hr_user, "PREVIEW", None, first, 1, None, Json(payload), r["calc"]))
        if r["status"] in ("VERIFIED", "REJECTED"):
            action = "VERIFY" if r["status"] == "VERIFIED" else "REJECT"
            final = dict(payload, status=r["status"], version=2, verified_microseconds=r["verified"])
            rows.append((r["rid"], hr_user, action, first, r["status"], 2, r["reason"], Json(final), r["reviewed_at"]))
    insert(cur, "overtime_reconciliation_events", ["request_id", "actor_id", "action", "from_status", "to_status", "version",
                                                   "reason", "new_values", "created_at"], rows)


def seed_projects(cur, rng, people):
    # Giữ nguyên 3 dự án gốc và 8 định mức gốc (id <= 8) vì TZ-DOC-03 ghi đích danh; chỉ thêm 3 dự án mới.
    new_codes = ["PRJ-SALES-TRAINING", "PRJ-BTS-2026", "PRJ-BLACKFRIDAY-2026"]
    cur.execute("DELETE FROM project_role_allowances WHERE id>8")
    cur.execute("DELETE FROM projects WHERE project_code=ANY(%s)", (new_codes,))
    new = [(new_codes[0], "Chương trình Đào tạo Kỹ năng Tư vấn Bán hàng 2026", "2026-08-10", "2026-12-15", 150_000_000, "IN_PROGRESS",
            "Nâng cao kỹ năng tư vấn cho đội ngũ bán hàng toàn chuỗi"),
           (new_codes[1], "Chiến dịch Back to School 2026", "2026-06-01", "2026-07-31", 300_000_000, "COMPLETED",
            "Chương trình ưu đãi laptop cho học sinh, sinh viên"),
           (new_codes[2], "Chiến dịch Black Friday & Cuối năm 2026", "2026-12-01", "2027-01-15", 500_000_000, "PLANNING",
            "Kế hoạch khuyến mãi cao điểm cuối năm")]
    insert(cur, "projects", ["project_code", "project_name", "start_date", "end_date", "budget", "status", "description"], new)
    cur.execute("SELECT project_code, project_id FROM projects WHERE project_code=ANY(%s)", (new_codes,))
    ids = dict(cur.fetchall())
    training, school, black_friday = (ids[c] for c in new_codes)
    standard = (("PROJECT_LEAD", 1_500_000), ("CORE_MEMBER", 1_200_000), ("MEMBER", 500_000))
    insert(cur, "project_role_allowances", ["project_id", "role_code", "allowance_amount", "notes"],
           [(pid, role, amount, "Định mức theo TZ-DOC-03") for pid in (training, school, black_friday) for role, amount in standard])
    eligible = [p for p in people if p["store"] not in (None, 6) and p["status"] == "ACTIVE" and not p["resign"]
                and p["join"] <= date(2026, 5, 1)]
    rng.shuffle(eligible)
    leaders = [p for p in eligible if p["pos"] in ("STORE_MGR", "SALES_LEAD")]
    techs = [p for p in eligible if p["pos"] == "TECH_STAFF"]
    members = [p for p in eligible if p["pos"] in ("SALES_STAFF", "CASHIER")]
    rows = []

    def add(pid, p, role, amount, joined, left=None):
        rows.append((pid, p["id"], role, amount, joined, left, left is None))

    # Vai trò và mức phụ cấp đúng bảng định mức của từng dự án gốc
    add(1, leaders[0], "PROJECT_LEAD", 2_000_000, "2026-08-01")
    add(1, leaders[1], "CORE_MEMBER", 1_200_000, "2026-08-01")
    add(2, techs[0], "TECH_LEAD", 1_000_000, "2026-09-01")
    add(2, leaders[2], "KEY_MEMBER", 1_500_000, "2026-09-01")
    add(3, leaders[3], "PROJECT_LEAD", 1_500_000, "2026-07-01")
    add(training, leaders[4], "PROJECT_LEAD", 1_500_000, "2026-08-10")
    add(training, leaders[5], "CORE_MEMBER", 1_200_000, "2026-08-10")
    for i, (pid, joined) in enumerate(((1, "2026-08-01"), (2, "2026-09-01"), (3, "2026-07-01"), (training, "2026-08-10"))):
        for p in members[i * 3:i * 3 + 4]:
            add(pid, p, "MEMBER", 500_000, joined)
    add(school, leaders[0], "PROJECT_LEAD", 1_500_000, "2026-06-01", "2026-07-31")
    for p in members[:4]:
        add(school, p, "MEMBER", 500_000, "2026-06-01", "2026-07-31")
    insert(cur, "project_members", ["project_id", "employee_id", "project_role", "project_allowance", "joined_date", "left_date", "is_active"], rows)
    return len(rows)


def seed_sales(cur, rng, people):
    sales = [p for p in people if p["pos"] in ("SALES_STAFF", "SALES_LEAD")]
    rows = []
    for period in PERIODS:
        start, end = date.fromisoformat(period + "-01"), month_end(period)
        for p in sales:
            if p["join"] > end or (p["resign"] and p["resign"] < start):
                continue
            target = rng.choice((280, 300, 320) if p["pos"] == "SALES_LEAD" else (200, 220)) * 1_000_000
            worked = (min(end, p["resign"] or end) - max(start, p["join"])).days + 1
            total = target * rng.uniform(0.7, 1.35) * worked / ((end - start).days + 1)
            phone, laptop = total * rng.uniform(0.45, 0.6), total * rng.uniform(0.25, 0.35)
            rows.append((p["id"], p["store"], period, round(phone, -3), round(laptop, -3),
                         round(total - phone - laptop, -3), target))
    insert(cur, "employee_sales", ["employee_id", "store_id", "salary_period", "phone_revenue", "laptop_revenue",
                                   "accessory_revenue", "target_kpi"], rows)
    return len(rows)


def run_payroll(cur, hr_user):
    insert(cur, "payroll_period_bonuses", ["salary_period", "bonus_code", "bonus_name", "calculation_type", "base_amount",
                                           "applies_to", "created_by"],
           [("2026-09", "HOLIDAY_BONUS", "Thưởng Lễ Quốc khánh 2/9", "COEFFICIENT", 1_000_000, "ALL", hr_user)])
    for period in PERIODS:
        end = month_end(period)
        cur.execute("CALL sp_calculate_monthly_commission(%s)", (period,))
        cur.execute("CALL sp_generate_monthly_payroll(%s,%s)", (period, hr_user))
        cur.execute("INSERT INTO payroll_calculation_runs(salary_period,calculated_at) VALUES (%s,%s)",
                    (period, vn(end + timedelta(days=3), time(10))))
        if period != PERIODS[-1]:  # 08, 09 đã chi trả; 10 để DRAFT chờ chốt
            pay_day = end + timedelta(days=5)
            cur.execute("UPDATE payrolls SET payment_status='PAID',payment_date=%s WHERE salary_period=%s", (pay_day, period))


def notice_days(p):
    return {"INDEFINITE": 45, "PROBATION": 3}.get(p["ctype"], 30)


def finish_people(cur, people, story, by_role):
    hr, hr_user = by_role["HR_DIR"], by_role["HR_DIR"]["id"]
    for p in people:
        cur.execute("UPDATE employees SET employment_status=%s WHERE employee_id=%s", (p["status"], p["id"]))
    rows = []
    for p, last_day, reason in story["resigned"]:
        submitted = last_day - timedelta(days=notice_days(p))
        rows.append((p["id"], p["contract"], submitted, last_day, reason, "APPROVED", None, last_day, hr_user, hr_user,
                     vn(submitted + timedelta(days=4), time(10))))
        cur.execute("UPDATE employees SET employment_status='RESIGNED',resignation_date=%s WHERE employee_id=%s", (last_day, p["id"]))
        cur.execute("UPDATE users SET is_active=FALSE WHERE employee_id=%s", (p["id"],))
        cur.execute("""UPDATE contracts SET status='TERMINATED',termination_date=%s,termination_reason=%s,terminated_by=%s
                       WHERE contract_id=%s""", (last_day, reason, hr_user, p["contract"]))
    p = story["pending"]
    rows.append((p["id"], p["contract"], date(2026, 11, 3), date(2026, 11, 3) + timedelta(days=notice_days(p)), "Có định hướng nghề nghiệp mới", "PENDING", None, None, hr_user, None, None))
    p = story["rejected"]
    rows.append((p["id"], p["contract"], date(2026, 10, 12), date(2026, 10, 20), "Lý do cá nhân", "REJECTED",
                 "Chưa đảm bảo thời hạn báo trước theo hợp đồng", None, hr_user, hr_user, vn(date(2026, 10, 14), time(9))))
    insert(cur, "resignation_requests", ["employee_id", "contract_id", "submitted_date", "requested_last_working_date", "reason",
                                         "status", "rejection_reason", "approved_last_working_date", "created_by", "approved_by",
                                         "approved_at"], rows)


def seed_audit(cur, rng, people, by_role):
    hr = by_role["HR_DIR"]["id"]
    rows = [(hr, "CALCULATE_PAYROLL", "payrolls", period, Json({"salary_period": period}), "127.0.0.1", vn(month_end(period) + timedelta(days=3), time(10)))
            for period in PERIODS]
    rows += [(hr, "ATTENDANCE_SESSION_RESOLVE", "attendances", None, Json({"note": "Xác minh phiên quên check-out"}), "127.0.0.1",
              vn(date(2026, 10, 20) + timedelta(days=i), time(10))) for i in range(3)]
    rows += [(hr, "RESIGNATION_APPROVED", "resignation_requests", "1", Json({"status": "APPROVED"}), "127.0.0.1", vn(date(2026, 9, 5), time(10)))]
    for p in rng.sample([p for p in people if not p["resign"]], 15):
        rows.append((p["id"], "LOGIN", "users", str(p["id"]), Json({"username": p["username"]}), "127.0.0.1",
                     vn(date(2026, 11, 2) + timedelta(days=rng.randint(0, 2)), time(rng.randint(7, 18), rng.randint(0, 59)))))
    insert(cur, "audit_logs", ["user_id", "action", "entity_name", "entity_id", "new_values", "ip_address", "created_at"], rows)


def reset_sequences(cur):
    cur.execute("""
        SELECT s.oid::regclass::text, t.oid::regclass::text, a.attname FROM pg_class s
        JOIN pg_depend d ON d.objid=s.oid AND d.deptype IN ('a','i') JOIN pg_class t ON t.oid=d.refobjid
        JOIN pg_attribute a ON a.attrelid=t.oid AND a.attnum=d.refobjsubid
        WHERE s.relkind='S' AND s.relnamespace='public'::regnamespace""")
    for seq, table, column in cur.fetchall():
        cur.execute(f"SELECT setval(%s, COALESCE((SELECT MAX({column}) FROM {table}), 1), (SELECT COUNT(*)>0 FROM {table}))", (seq,))


def self_check(cur):
    checks = {
        "60 nhân viên, 60 tài khoản, 58 đăng nhập được":
            ("""SELECT (SELECT count(*) FROM employees)=60 AND (SELECT count(*) FROM users)=60
                AND (SELECT count(*) FROM users WHERE is_active)=58""",),
        "9 nhân sự gốc giữ đúng mã": ("""SELECT count(*)=9 FROM employees WHERE employee_code IN
            ('TZ-001','TZ-002','TZ-003','TZ-004','TZ-005','TZ-006','TZ-007','TZ-008','TZ-DIR')""",),
        "Giám đốc tên Phạm Nguyệt Vượng": ("SELECT count(*)=1 FROM employees WHERE employee_code='TZ-DIR' AND full_name='Phạm Nguyệt Vượng'",),
        "người nghỉ giữa kỳ có phiếu tháng cuối":
            ("""SELECT count(*)=2 FROM payrolls p JOIN employees e USING(employee_id)
                WHERE e.employment_status='RESIGNED' AND p.salary_period=to_char(e.resignation_date,'YYYY-MM')""",),
        "phiếu lương dùng đúng lương hợp đồng":
            ("""SELECT count(*)=0 FROM payrolls p WHERE NOT EXISTS (SELECT 1 FROM contracts c
                WHERE c.employee_id=p.employee_id AND c.basic_salary=p.contract_salary)""",),
        "không chấm công từ hôm nay": ("SELECT count(*)=0 FROM attendances WHERE work_date>=%s", (CUTOFF,)),
        "không còn lượt mở chặn check-in":
            ("SELECT count(*)=0 FROM attendances WHERE check_in_time IS NOT NULL AND check_out_time IS NULL",),
        "người đang làm có đúng 1 hợp đồng ACTIVE":
            ("""SELECT count(*)=0 FROM employees e WHERE employment_status IN ('ACTIVE','PROBATION')
                AND (SELECT count(*) FROM contracts c WHERE c.employee_id=e.employee_id AND c.status='ACTIVE')<>1""",),
        "hợp đồng ACTIVE chưa hết hạn": ("SELECT count(*)=0 FROM contracts WHERE status='ACTIVE' AND end_date<%s", (CUTOFF,)),
        "không có lương âm": ("SELECT count(*)=0 FROM payrolls WHERE net_salary<0",),
        "không có phiếu lương trước ngày vào làm":
            ("""SELECT count(*)=0 FROM payrolls p JOIN employees e USING(employee_id)
                WHERE (p.salary_period||'-01')::date + interval '1 month' <= e.join_date""",),
        "không có phiếu lương sau ngày nghỉ":
            ("""SELECT count(*)=0 FROM payrolls p JOIN employees e USING(employee_id)
                WHERE e.resignation_date < (p.salary_period||'-01')::date""",),
        "08 và 09 đã PAID, 10 là DRAFT":
            ("""SELECT bool_and(CASE WHEN salary_period='2026-10' THEN payment_status='DRAFT' ELSE payment_status='PAID' END) FROM payrolls""",),
        "chữ ký đối soát khớp":
            ("SELECT count(*)=0 FROM overtime_reconciliations WHERE source_signature<>public.ot_reconciliation_source_signature(request_id)",),
        "mã hợp đồng HD-YYYY-NNNN": ("SELECT count(*)=0 FROM contracts WHERE contract_number !~ '^HD-[0-9]{4}-[0-9]{4}$'",),
        "lương hợp đồng trong khung chức vụ":
            ("""SELECT count(*)=0 FROM contracts c JOIN positions p USING(position_id)
                WHERE c.basic_salary NOT BETWEEN p.base_salary_min AND p.base_salary_max""",),
        "thử việc 30-180 ngày":
            ("SELECT count(*)=0 FROM contracts WHERE contract_type='PROBATION' AND end_date-start_date+1 NOT BETWEEN 30 AND 180",),
        "đơn nghỉ ốm/thai sản có minh chứng":
            ("SELECT count(*)=0 FROM leave_requests WHERE leave_type_id IN (2,3) AND attachment_url IS NULL",),
        "đơn HR/Admin do Giám đốc duyệt":
            ("""SELECT count(*)=0 FROM leave_requests l JOIN users u USING(employee_id) JOIN user_roles ur USING(user_id)
                WHERE ur.role_id IN (1,2) AND l.status='HR_APPROVED' AND l.director_approver_id IS NULL""",),
        "thôi việc báo trước đúng hạn":
            ("""SELECT count(*)=0 FROM resignation_requests r JOIN contracts c USING(contract_id) WHERE r.status<>'REJECTED'
                AND r.requested_last_working_date-r.submitted_date < CASE c.contract_type WHEN 'INDEFINITE' THEN 45 WHEN 'PROBATION' THEN 3 ELSE 30 END""",),
        "thai sản không có phiếu lương từ tháng nghỉ":
            ("""SELECT count(*)=0 FROM payrolls p JOIN employees e USING(employee_id)
                WHERE e.employment_status='ON_LEAVE' AND p.salary_period>='2026-10'""",),
        "phụ cấp dự án đúng định mức":
            ("""SELECT count(*)=0 FROM project_members m LEFT JOIN project_role_allowances a
                ON a.project_id=m.project_id AND a.role_code=m.project_role
                WHERE a.allowance_amount IS DISTINCT FROM m.project_allowance""",),
        "giờ OT đã xác nhận có trong lương":
            ("SELECT count(*)>0 FROM payroll_details WHERE item_code='OVERTIME'",),
        "có đủ OT Chủ nhật và Lễ":
            ("SELECT count(*)>=2 FROM payroll_details WHERE item_code='OVERTIME' AND (calculation_formula LIKE '%%Chủ nhật%%' OR calculation_formula LIKE '%%Lễ/Tết%%')",),
    }
    failed = []
    for name, query in checks.items():
        cur.execute(*query)
        ok = cur.fetchone()[0]
        print(f"  [{'OK' if ok else 'LỖI'}] {name}")
        if not ok:
            failed.append(name)
    if failed:
        raise SystemExit(f"Tự kiểm tra thất bại, rollback: {failed}")


def main():
    parser = argparse.ArgumentParser()
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--dry-run", action="store_true")
    mode.add_argument("--yes-wipe", action="store_true")
    args = parser.parse_args()
    url = os.environ.get("SEED_DATABASE_URL")
    if not url:
        raise SystemExit("Thiếu SEED_DATABASE_URL.")

    rng = random.Random(2026)
    pw_hash = bcrypt.hashpw(DEMO_PASSWORD.encode(), bcrypt.gensalt()).decode()
    people = build_people(rng)
    story = apply_story(people)
    by_role = {p["pos"]: p for p in people if p["pos"] in ("ADMIN_SYS", "DIRECTOR", "HR_DIR")}
    hr_user = by_role["HR_DIR"]["id"]

    conn = psycopg2.connect(url)
    try:
        with conn.cursor() as cur:
            cur.execute("SET LOCAL statement_timeout=0")
            wipe(cur)
            seed_people(cur, rng, people, pw_hash)
            seed_contracts(cur, rng, people, hr_user)
            schedules, next_sched = seed_schedules(cur, people, hr_user)
            leave_days, leave_count = seed_leaves(cur, rng, people, by_role)
            att_rows, att_index, next_att = seed_attendance(cur, rng, people, schedules, leave_days)
            recon, ot_count = seed_overtime(cur, rng, people, by_role, schedules, att_rows, att_index, next_sched, next_att)
            members = seed_projects(cur, rng, people)
            sales = seed_sales(cur, rng, people)
            finish_people(cur, people, story, by_role)
            run_payroll(cur, hr_user)
            finalize_reconciliations(cur, recon, hr_user)
            seed_audit(cur, rng, people, by_role)
            reset_sequences(cur)
            print(f"Sinh xong: {len(people)} NV, {len(schedules)} lịch, {len(att_rows)} chấm công, {leave_count} đơn nghỉ, "
                  f"{ot_count} đơn OT, {members} thành viên dự án, {sales} dòng doanh số")
            self_check(cur)
        if args.yes_wipe:
            conn.commit()
            print("Đã COMMIT.")
        else:
            conn.rollback()
            print("Dry-run: đã ROLLBACK, database không đổi.")
    except BaseException:
        conn.rollback()
        raise
    finally:
        conn.close()


if __name__ == "__main__":
    main()
