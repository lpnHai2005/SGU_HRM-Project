"""Apply the versioned attendance migration atomically using configured PostgreSQL."""
import asyncio
from pathlib import Path
from app.core.database import engine

async def main():
    sql = (Path(__file__).parent / 'migrations/20260926_attendance_sessions.sql').read_text(encoding='utf-8')
    async with engine.connect() as connection:
        raw = await connection.get_raw_connection()
        await raw.driver_connection.execute(sql)
    await engine.dispose()
    print('Attendance session migration applied.')

if __name__ == '__main__':
    asyncio.run(main())
