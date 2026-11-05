"""Quy tắc gia hạn và ngày hợp đồng: loại HĐ mới, thử việc 30-180 ngày, ngày nối tiếp HĐ cũ."""
import asyncio
import os
import sys
from datetime import date

import pytest
from fastapi import HTTPException
from pydantic import ValidationError

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.core.contract_service import ContractService
from app.schemas.schemas import ContractCreate, ContractRenew, ContractTypeEnum, ContractUpdate

OLD_END = date(2026, 12, 31)


def check_dates(contract_type, start, end):
    asyncio.run(ContractService.validate_date_range(contract_type, start, end))


def test_fixed_contract_can_become_indefinite():
    ContractService.validate_renewal("FIXED_1_YEAR", OLD_END, "INDEFINITE", date(2027, 1, 1))
    check_dates("INDEFINITE", date(2027, 1, 1), None)


def test_probation_can_become_fixed():
    ContractService.validate_renewal("PROBATION", OLD_END, "FIXED_1_YEAR", date(2027, 1, 1))


@pytest.mark.parametrize("current_type,new_type,new_start", [
    ("INDEFINITE", "FIXED_1_YEAR", date(2027, 1, 1)),
    ("FIXED_1_YEAR", "PROBATION", date(2027, 1, 1)),
    ("FIXED_1_YEAR", "FIXED_1_YEAR", OLD_END),
])
def test_invalid_renewals(current_type, new_type, new_start):
    with pytest.raises(HTTPException) as exc:
        ContractService.validate_renewal(current_type, OLD_END, new_type, new_start)
    assert exc.value.status_code == 400


def test_indefinite_rejects_end_date():
    with pytest.raises(HTTPException):
        check_dates("INDEFINITE", date(2027, 1, 1), date(2028, 1, 1))


@pytest.mark.parametrize("end,ok", [
    (date(2027, 1, 29), False),  # 29 ngày
    (date(2027, 1, 30), True),   # 30 ngày
    (date(2027, 3, 31), True),   # 90 ngày
    (date(2027, 6, 29), True),   # 180 ngày
    (date(2027, 6, 30), False),  # 181 ngày
])
def test_probation_length(end, ok):
    if ok:
        check_dates("PROBATION", date(2027, 1, 1), end)
    else:
        with pytest.raises(HTTPException):
            check_dates("PROBATION", date(2027, 1, 1), end)


@pytest.mark.parametrize("contract_type", ["FIXED_1_YEAR", ContractTypeEnum.FIXED_1_YEAR])
def test_fixed_end_date_must_match_type(contract_type):
    check_dates(contract_type, date(2027, 1, 1), date(2027, 12, 31))
    with pytest.raises(HTTPException):
        check_dates(contract_type, date(2027, 1, 1), date(2028, 6, 30))


@pytest.mark.parametrize("start,years,end", [
    (date(2027, 1, 1), 3, date(2029, 12, 31)),
    (date(2024, 2, 29), 1, date(2025, 2, 28)),
    (date(2023, 3, 1), 1, date(2024, 2, 29)),
])
def test_fixed_term_end_date(start, years, end):
    assert ContractService.fixed_term_end_date(start, years) == end


def test_custom_type_is_rejected_everywhere():
    with pytest.raises(ValidationError):
        ContractCreate(employee_id=1, contract_type="FIXED_TERM", start_date="2027-01-01",
                       basic_salary=8_000_000, signed_date="2027-01-01")
    with pytest.raises(ValidationError):
        ContractUpdate(contract_type="FIXED_TERM")
    with pytest.raises(ValidationError):
        ContractRenew(new_start_date="2027-01-01", new_contract_type="FIXED_TERM")


def test_renew_schema_keeps_old_terms_when_empty():
    data = ContractRenew(new_start_date="2027-01-01")
    assert data.new_contract_type is None
    assert data.new_insurance_salary is None
    assert data.new_working_hours_per_week is None


def test_renew_schema_rejects_bad_hours():
    with pytest.raises(ValidationError):
        ContractRenew(new_start_date="2027-01-01", new_working_hours_per_week=45)
