import pytest

from app.api.v1.endpoints.employees import profile_detail_columns


@pytest.mark.parametrize("role", ["DIRECTOR", "HR_MANAGER"])
def test_senior_roles_get_full_profile(role):
    assert "e.tax_code" in profile_detail_columns([role])


@pytest.mark.parametrize("roles", [["ADMIN"], ["STORE_MANAGER"], ["EMPLOYEE"], []])
def test_other_roles_do_not_get_full_profile(roles):
    assert profile_detail_columns(roles) == ""
