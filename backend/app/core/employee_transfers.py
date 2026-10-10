from sqlalchemy import text
from app.core.attendance import local_now


async def sync_transfer_schedules(db, employee_id, old_store_id, new_store_id):
    """Move outstanding schedules at the old branch, preserving shifts and attendance history.

    Caller holds the employee row lock and commits the employee + schedule changes together.
    Open attendance continues to use its stored branch/snapshot for checkout.
    """
    if new_store_id is None or old_store_id == new_store_id:
        return []
    rows = await db.execute(text('''
        UPDATE work_schedules SET store_id=:new_store
        WHERE employee_id=:emp AND work_date>=:today
          AND store_id IS NOT DISTINCT FROM :old_store AND cancelled_at IS NULL
        RETURNING schedule_id, work_date, shift_id, store_id
    '''), {'emp': employee_id, 'old_store': old_store_id, 'new_store': new_store_id,
           'today': local_now().date()})
    return [dict(row) for row in rows.mappings().all()]
