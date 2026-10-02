"""Apply the versioned attendance migration atomically using configured PostgreSQL."""
import asyncio
import argparse
from pathlib import Path
from app.core.database import engine

async def main(migration='20260926_attendance_sessions.sql'):
    sql = (Path(__file__).parent / 'migrations' / migration).read_text(encoding='utf-8')
    async with engine.connect() as connection:
        raw = await connection.get_raw_connection()
        await raw.driver_connection.execute(sql)
    await engine.dispose()
    print(f'Applied: {migration}')

if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--migration', choices=['20260926_attendance_sessions.sql', '20261001_attendance_schedule_snapshot.sql', '20261001_mobile_attendance.sql'],
                        default='20260926_attendance_sessions.sql')
    asyncio.run(main(parser.parse_args().migration))
