"""PDF hợp đồng chỉ in dữ liệu thật; dữ liệu thiếu thì chừa dòng chấm, không điền giá trị giả."""
import os
import sys
from datetime import date

import pypdfium2 as pdfium

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.core.contract_pdf import BLANK, generate_contract_pdf

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
