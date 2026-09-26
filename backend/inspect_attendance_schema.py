"""Read-only inspection of attendance database prerequisites."""
import asyncio
from sqlalchemy import text
from app.core.database import engine

async def main():
    async with engine.connect() as connection:
        for query in (
            "SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'attendances'",
            "SELECT indexdef FROM pg_indexes WHERE tablename = 'attendances'",
            "SELECT conname, pg_get_constraintdef(oid) FROM pg_constraint WHERE conrelid = 'attendances'::regclass",
        ):
            print((await connection.execute(text(query))).all())
    await engine.dispose()

if __name__ == '__main__':
    asyncio.run(main())
