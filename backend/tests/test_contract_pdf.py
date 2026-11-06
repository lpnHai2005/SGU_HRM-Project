"""PDF hợp đồng chỉ in dữ liệu thật; dữ liệu thiếu thì chừa dòng chấm, không điền giá trị giả."""
import os
import sys
from datetime import date

import pypdfium2 as pdfium

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.core.contract_pdf import BLANK, generate_contract_pdf, init_vietnamese_fonts

CONTRACT = {
    "contract_number": "HD-2026-0001",
    "contract_type": "FIXED_1_YEAR",
    "start_date": date(2026, 1, 1),
    "end_date": date(2026, 12, 31),
    "basic_salary": 8_000_000,
    "insurance_salary": 8_000_000,
    "signed_date": date(2026, 1, 1),
}
# Giống dòng lấy từ DB: có đủ khóa nhưng giá trị NULL
EMPTY_EMPLOYEE = {key: None for key in (
    "full_name", "gender", "identity_card", "identity_issued_place", "phone", "tax_code",
    "insurance_code", "bank_account_number", "bank_name", "position_name", "store_name",
)}


def pdf_text(pdf_bytes):
    pages = pdfium.PdfDocument(pdf_bytes)
    return " ".join(page.get_textpage().get_text_range() for page in pages)


def test_missing_data_is_left_blank():
    text = pdf_text(generate_contract_pdf(CONTRACT, EMPTY_EMPLOYEE, {
        "name": "", "tax_code": "", "address": "", "phone": "", "email": "",
    }))
    assert BLANK in text
    for fake in ("0316899988", "THU HÀ", "01/2024/GUQ", "NGUYỄN VĂN A", "Chuyên viên tư vấn", "Cục Cảnh sát", "None"):
        assert fake not in text


def test_real_company_and_signer_are_printed():
    text = pdf_text(generate_contract_pdf(CONTRACT, {"full_name": "Lê Văn C", "gender": "MALE"}, {
        "name": "CÔNG TY KIỂM THỬ",
        "tax_code": "1234567890",
        "representative": "Bà TRẦN THỊ B",
        "title": "Giám đốc",
    }))
    assert "CÔNG TY KIỂM THỬ" in text
    assert "1234567890" in text
    assert "TRẦN THỊ B" in text
    assert "LÊ VĂN C" in text


def test_vietnamese_unicode_fonts_loaded_and_no_tofu():
    """Đảm bảo font Unicode tiếng Việt nạp chuẩn, văn bản không bị lỗi ô vuông tofu (■)"""
    font_family = init_vietnamese_fonts()
    assert font_family != "Helvetica", "Font hệ thống không được fallback về Helvetica (gây lỗi tofu ■)"

    contract = {
        "contract_number": "HD-2026-0020",
        "contract_type": "FIXED_2_YEAR",
        "start_date": date(2026, 10, 14),
        "end_date": date(2028, 10, 13),
        "basic_salary": 15_000_000,
        "insurance_salary": 15_000_000,
        "signed_date": date(2026, 10, 12),
        "working_hours_per_week": 48,
    }
    employee = {
        "full_name": "Ngô Hoài Anh",
        "employee_code": "TZ-059",
        "gender": "NAM",
        "dob": date(1996, 6, 26),
        "identity_card": "079096000060",
        "identity_issued_date": date(2021, 4, 12),
        "identity_issued_place": "Cục Cảnh sát QLHC về TTXH",
        "permanent_address": "71 Hòa Bình, Phường Ninh Kiều, Thành phố Cần Thơ",
        "current_address": "56 Nguyễn Thiện Thuật, Phường Bàn Cờ, Thành phố Hồ Chí Minh",
        "phone": "0910000060",
        "company_email": "anh.nh@techzone.vn",
        "tax_code": "8345672248",
        "insurance_code": "7926000060",
        "bank_account_number": "19300000060",
        "bank_name": "ACB CN Bến Thành",
        "position_name": "Chuyên viên tư vấn",
        "store_name": "ĐH Sài Gòn (ADV)",
    }
    company = {
        "name": "CÔNG TY CỔ PHẦN CÔNG NGHỆ TECHZONE VIỆT NAM",
        "tax_code": "0316899988",
        "address": "273 An Dương Vương, Phường Chợ Quán, Thành phố Hồ Chí Minh",
        "phone": "1900 6868",
        "email": "hr@techzone.vn",
        "representative": "Ông PHẠM NGUYỄN VŨNG",
        "title": "Giám đốc",
    }

    pdf_bytes = generate_contract_pdf(contract, employee, company)
    text = pdf_text(pdf_bytes)

    # 1. Tuyệt đối không được xuất hiện ký tự tofu '■' (U+25A0)
    assert "■" not in text, "PDF vẫn còn ký tự lỗi font tofu (■)!"

    # 2. Toàn bộ các chuỗi tiếng Việt đặc trưng có dấu phải nguyên vẹn
    assert "HỢP ĐỒNG LAO ĐỘNG" in text
    assert "HỢP ĐỒNG LAO ĐỘNG XÁC ĐỊNH THỜI HẠN (02 NĂM)" in text
    assert "CỘNG HÒA XÃ HỘI CHỦ NGHĨA VIỆT NAM" in text
    assert "Độc lập – Tự do – Hạnh phúc" in text or "Độc lập - Tự do - Hạnh phúc" in text
    assert "CÔNG TY CỔ PHẦN CÔNG NGHỆ TECHZONE VIỆT NAM" in text
    assert "NGÔ HOÀI ANH" in text
    assert "Cục Cảnh sát QLHC về TTXH" in text
    assert "Phường Ninh Kiều" in text
    assert "Thành phố Cần Thơ" in text
    assert "Phường Bàn Cờ" in text
    assert "Thành phố Hồ Chí Minh" in text
    assert "Mười lăm triệu đồng chẵn" in text

