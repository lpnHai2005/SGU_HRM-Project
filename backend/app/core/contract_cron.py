"""
Contract Cron Jobs
Đặt lịch các task tự động cho module Contract Management:
- Tự động expire contracts khi end_date < today
"""
import asyncio
import logging
from datetime import datetime
from sqlalchemy import text
from app.core.database import async_session_maker

logger = logging.getLogger(__name__)


async def auto_expire_contracts():
    """
    Cập nhật các hợp đồng ACTIVE có end_date < today thành EXPIRED.
    Chạy mỗi ngày lúc 00:01.
    """
    try:
        async with async_session_maker() as db:
            query = text("""
                UPDATE contracts
                SET status = 'EXPIRED',
                    updated_at = CURRENT_TIMESTAMP
                WHERE status = 'ACTIVE'
                AND end_date IS NOT NULL
                AND end_date < CURRENT_DATE
                RETURNING contract_id, contract_number, end_date
            """)

            result = await db.execute(query)
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
                        "contracts": [dict(c) for c in expired_contracts],
                        "executed_at": datetime.now().isoformat()
                    }
                )
                await db.commit()

                logger.info(f"[CRON] Auto-expired {len(expired_contracts)} contracts")
            else:
                logger.debug("[CRON] No contracts to expire")

    except Exception as e:
        logger.error(f"[CRON] Error in auto_expire_contracts: {e}")


async def start_contract_cron():
    """
    Khởi động cron job loop.
    Chạy mỗi 24 giờ (86400 giây).
    """
    import time

    while True:
        try:
            # Chạy ngay khi start
            await auto_expire_contracts()
        except Exception as e:
            logger.error(f"[CRON] Error in contract cron loop: {e}")

        # Wait 24 hours
        await asyncio.sleep(86400)


# Có thể sử dụng thư viện APScheduler nếu cần:
# from apscheduler.schedulers.asyncio import AsyncIOScheduler
#
# scheduler = AsyncIOScheduler()
# scheduler.add_job(
#     auto_expire_contracts,
#     'cron',
#     hour=0,
#     minute=1,
#     id='expire_contracts'
# )
# scheduler.start()
