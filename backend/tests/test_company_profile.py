"""Thông tin công ty lấy từ bảng company_profile; chưa có dữ liệu thì để trống."""
import asyncio
import io
import os
import sys

import openpyxl

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.core.company import get_company_profile
from app.core.excel_exporter import create_multisheet_excel, create_styled_excel


class Result:
    def __init__(self, row):
        self.row = row

    def mappings(self):
        return self

    def first(self):
        return self.row


class Db:
    def __init__(self, row):
        self.row = row

    async def execute(self, *_args):
        return Result(self.row)


def header(stream):
    return openpyxl.load_workbook(io.BytesIO(stream.getvalue())).active["A1"].value


def test_missing_profile_is_empty():
    assert asyncio.run(get_company_profile(Db(None))) == {}


def test_profile_row_is_returned():
    row = {"name": "CÔNG TY KIỂM THỬ", "tax_code": "1234567890"}
    assert asyncio.run(get_company_profile(Db(row))) == row


def test_excel_header_uses_company_name():
    columns = [{"key": "a", "title": "A"}]
    assert header(create_styled_excel("T", "S", columns, [], company_name="CÔNG TY X")) == "TECHZONE - CÔNG TY X"
    assert header(create_styled_excel("T", "S", columns, [])) == "TECHZONE"
    sheet = {"name": "S1", "title": "T", "columns": columns, "data": []}
    assert header(create_multisheet_excel([sheet], "CÔNG TY X")) == "TECHZONE - CÔNG TY X"
