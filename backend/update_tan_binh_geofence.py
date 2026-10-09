"""Apply the user-confirmed Tan Binh coordinates; preserve radius and other stores."""
import asyncio
from sqlalchemy import text
from app.core.database import AsyncSessionLocal, engine


async def main():
    try:
        async with AsyncSessionLocal() as db:
            async with db.begin():
                store = (await db.execute(text('SELECT store_id, store_name FROM stores WHERE store_id=5 FOR UPDATE'))).mappings().one()
                if 'tân bình' not in store['store_name'].lower():
                    raise RuntimeError('Store 5 is not Tan Binh; no changes applied.')
                before = (await db.execute(text('SELECT latitude,longitude,radius_meters,is_active FROM mobile_store_geofences WHERE store_id=5 FOR UPDATE'))).mappings().one()
                await db.execute(text('UPDATE mobile_store_geofences SET latitude=:lat,longitude=:lon WHERE store_id=5'),
                                 {'lat': 10.749194, 'lon': 106.680100})
                after = (await db.execute(text('SELECT latitude,longitude,radius_meters,is_active FROM mobile_store_geofences WHERE store_id=5'))).mappings().one()
                print(dict(store), 'before:', dict(before), 'after:', dict(after))
            print('Committed Tan Binh coordinates only.')
    finally:
        await engine.dispose()


if __name__ == '__main__':
    asyncio.run(main())
