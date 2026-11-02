"""Apply the idempotent notification-read migration to the configured PostgreSQL."""
import os, sys
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import asyncio
from pathlib import Path
from sqlalchemy import text
from app.core.database import engine

async def main():
    migration = Path(__file__).parent.parent / 'migrations' / '20261012_notification_reads.sql'
    async with engine.begin() as conn:
        await conn.execute(text(migration.read_text(encoding='utf-8')))
    await engine.dispose()
    print('notification_reads migration applied')

if __name__ == '__main__':
    asyncio.run(main())
