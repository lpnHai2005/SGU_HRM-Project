"""
Contract Cron Jobs
Đặt lịch các task tự động cho module Contract Management:
- Tự động expire contracts khi end_date < today
- Áp quy tắc trạng thái nhân viên (hết hợp đồng, hết thử việc, thôi việc, thai sản)
"""
import asyncio
import logging
from datetime import datetime, timedelta
from sqlalchemy import text
from app.core.attendance import local_now
from app.core.database import async_session_maker
from app.core.employee_status import apply_status_rules

logger = logging.getLogger(__name__)


async def auto_expire_contracts(today):
    """Cập nhật các hợp đồng ACTIVE có end_date < today thành EXPIRED."""
    try:
        async with async_session_maker() as db:
            query = text("""
                UPDATE contracts
                SET status = 'EXPIRED',
                    updated_at = CURRENT_TIMESTAMP
                WHERE status = 'ACTIVE'
                AND end_date IS NOT NULL
                AND end_date < :today
                RETURNING contract_id, contract_number, end_date
            """)

            result = await db.execute(query, {"today": today})
            expired_contracts = result.mappings().all()

            if expired_contracts:
                # Log to audit
                from app.api.deps import record_audit_log
                await record_audit_log(
                    db=db,
                    user_id=None,  # System action
                    action="CONTRACTS_AUTO_EXPIRED",
                    entity_name="contract",
                    new_values={
                        "count": len(expired_contracts),
                        "contracts": [{**c, "end_date": str(c["end_date"])} for c in expired_contracts],
                        "executed_at": datetime.now().isoformat()
                    }
                )
                await db.commit()

                logger.info(f"[CRON] Auto-expired {len(expired_contracts)} contracts")
            else:
                logger.debug("[CRON] No contracts to expire")

    except Exception as e:
        logger.error(f"[CRON] Error in auto_expire_contracts: {e}")


async def run_daily_jobs():
    today = local_now().date()
    await auto_expire_contracts(today)
    try:
        async with async_session_maker() as db:
            changes = await apply_status_rules(db, today)
        logger.info(f"[CRON] Updated {len(changes)} employee statuses")
    except Exception as e:
        logger.error(f"[CRON] Error in apply_status_rules: {e}")


async def start_contract_cron():
    """Chạy ngay khi server khởi động, sau đó vào 00:01 giờ Việt Nam mỗi ngày."""
    while True:
        await run_daily_jobs()
        now = local_now()
        next_run = (now + timedelta(days=1)).replace(hour=0, minute=1, second=0, microsecond=0)
        await asyncio.sleep((next_run - now).total_seconds())
