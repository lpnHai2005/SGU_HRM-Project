"""Configure exactly one confirmed store: no implicit default store."""
import argparse
import asyncio
import sys
from sqlalchemy import text
from app.core.database import AsyncSessionLocal, engine

async def main(args):
    try:
        async with AsyncSessionLocal() as db:
            store = (await db.execute(text('SELECT store_name FROM stores WHERE store_id=:id'), {'id': args.store_id})).scalar_one_or_none()
            if not store:
                raise SystemExit('Store does not exist; nothing changed.')
            await db.execute(text('''INSERT INTO mobile_store_geofences (store_id,latitude,longitude,radius_meters,is_active)
                VALUES (:id,:lat,:lon,:radius,true) ON CONFLICT (store_id) DO UPDATE SET
                latitude=EXCLUDED.latitude,longitude=EXCLUDED.longitude,radius_meters=EXCLUDED.radius_meters,is_active=true'''),
                {'id': args.store_id, 'lat': args.latitude, 'lon': args.longitude, 'radius': args.radius})
            await db.commit()
            print(f'Configured store {args.store_id}: {store}; {args.latitude}, {args.longitude}; radius {args.radius} m')
    finally:
        await engine.dispose()

if __name__ == '__main__':
    sys.stdout.reconfigure(encoding='utf-8')
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--store-id', type=int, required=True)
    parser.add_argument('--latitude', type=float, required=True)
    parser.add_argument('--longitude', type=float, required=True)
    parser.add_argument('--radius', type=int, default=100)
    args = parser.parse_args()
    if not (-90 <= args.latitude <= 90 and -180 <= args.longitude <= 180 and 10 <= args.radius <= 5000):
        parser.error('Invalid coordinates or radius (10..5000 m).')
    asyncio.run(main(args))
