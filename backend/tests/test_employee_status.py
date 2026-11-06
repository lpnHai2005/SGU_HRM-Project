from datetime import date

from app.core.employee_status import plan_status

LAST_DAY = date(2026, 11, 1)


def employee(**changes):
    row = dict(
        employment_status="ACTIVE", resignation_date=None, user_active=True,
        active_contracts=1, official_contracts=1, draft_contracts=0,
        closed_status=None, closed_on=None, due_resignation_date=None,
        on_long_leave=False, long_leave_decided=False,
    )
    return {**row, **changes}


def test_nothing_to_change():
    assert plan_status(employee()) == ("ACTIVE", None, True, None)


def test_expired_contract_resigns_and_locks_account():
    row = employee(active_contracts=0, official_contracts=0, closed_status="EXPIRED", closed_on=LAST_DAY)
    assert plan_status(row) == ("RESIGNED", LAST_DAY, False, None)


def test_pending_renewal_keeps_employee_working():
    row = employee(active_contracts=0, official_contracts=0, closed_status="EXPIRED", draft_contracts=1)
    assert plan_status(row)[:3] == ("ACTIVE", None, True)


def test_resigned_employee_is_not_flipped_to_terminated():
    row = employee(employment_status="RESIGNED", resignation_date=LAST_DAY, user_active=False,
                   active_contracts=0, official_contracts=0, closed_status="TERMINATED")
    assert plan_status(row)[:3] == ("RESIGNED", LAST_DAY, False)


def test_left_employee_with_open_account_is_locked():
    row = employee(employment_status="RESIGNED", active_contracts=0, official_contracts=0)
    assert plan_status(row)[2] is False


def test_only_manual_sync_revives_left_employee():
    row = employee(employment_status="RESIGNED", resignation_date=LAST_DAY, user_active=False)
    assert plan_status(row)[:3] == ("RESIGNED", LAST_DAY, False)
    assert plan_status(row, revive_left=True)[:3] == ("ACTIVE", None, True)


def test_manually_locked_account_stays_locked():
    assert plan_status(employee(user_active=False), revive_left=True)[2] is False


def test_due_resignation_applies_and_terminates_contracts():
    assert plan_status(employee(due_resignation_date=LAST_DAY)) == ("RESIGNED", LAST_DAY, False, LAST_DAY)


def test_probation_ends_only_with_official_contract():
    assert plan_status(employee(employment_status="PROBATION"))[0] == "ACTIVE"
    assert plan_status(employee(employment_status="PROBATION", official_contracts=0))[0] == "PROBATION"


def test_maternity_starts_and_returns_to_contract_status():
    assert plan_status(employee(on_long_leave=True, long_leave_decided=True))[0] == "ON_LEAVE"
    ended = dict(employment_status="ON_LEAVE", long_leave_decided=True)
    assert plan_status(employee(**ended))[0] == "ACTIVE"
    assert plan_status(employee(**ended, official_contracts=0))[0] == "PROBATION"


def test_manual_on_leave_without_request_is_kept():
    assert plan_status(employee(employment_status="ON_LEAVE"))[0] == "ON_LEAVE"


def test_employee_without_user_account_stays_without_one():
    row = employee(user_active=None, active_contracts=0, official_contracts=0, closed_status="EXPIRED")
    assert plan_status(row)[:2] == ("RESIGNED", None)
    assert plan_status(row)[2] is None
