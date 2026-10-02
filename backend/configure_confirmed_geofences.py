"""Apply the five store locations explicitly supplied on 2026-10-03."""
import asyncio
from sqlalchemy import text
from app.core.database import AsyncSessionLocal, engine

LOCATIONS = [(1,10.776,106.703),(2,10.779356986985812,106.68418923912378),
             (3,10.748,106.635),(4,10.802,106.711),(5,10.798,106.654)]

async def main():
    try:
        async with AsyncSessionLocal() as db:
            ids = set((await db.execute(text('SELECT store_id FROM stores WHERE store_id BETWEEN 1 AND 5'))).scalars())
            if ids != {1,2,3,4,5}:
                raise RuntimeError('Expected store IDs 1..5; no changes applied.')
            for store, lat, lon in LOCATIONS:
                await db.execute(text('''INSERT INTO mobile_store_geofences(store_id,latitude,longitude,radius_meters,is_active)
                    VALUES(:id,:lat,:lon,100,true) ON CONFLICT(store_id) DO UPDATE SET
                    latitude=EXCLUDED.latitude,longitude=EXCLUDED.longitude,radius_meters=100,is_active=true'''),
                    dict(id=store,lat=lat,lon=lon))
            await db.commit()
            rows = (await db.execute(text('SELECT store_id,latitude,longitude,radius_meters,is_active FROM mobile_store_geofences WHERE store_id BETWEEN 1 AND 5 ORDER BY store_id'))).all()
            for row in rows: print(tuple(row))
    finally:
        await engine.dispose()

if __name__ == '__main__': asyncio.run(main())
