"""working_hours_per_week chỉ nhận 40/44/48 - khớp CHECK constraint trong DB."""
import os
import sys

import pytest
from pydantic import ValidationError

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.schemas.schemas import ContractCreate, ContractUpdate

BASE = dict(employee_id=1, start_date="2026-11-04", basic_salary=8_000_000, signed_date="2026-11-04")


def test_default_is_none_so_db_default_48_applies():
    assert ContractCreate(**BASE).working_hours_per_week is None


@pytest.mark.parametrize("hours", [40, 44, 48])
def test_allowed_values(hours):
    assert ContractCreate(**BASE, working_hours_per_week=hours).working_hours_per_week == hours
    assert ContractUpdate(working_hours_per_week=hours).working_hours_per_week == hours


@pytest.mark.parametrize("hours", [0, 24, 45, 50])
def test_rejected_values(hours):
    with pytest.raises(ValidationError):
        ContractCreate(**BASE, working_hours_per_week=hours)
    with pytest.raises(ValidationError):
        ContractUpdate(working_hours_per_week=hours)
