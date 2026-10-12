"""Admin store/geofence configuration; reads the same geofence used by mobile."""
import json
import ipaddress
from datetime import date
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field, ConfigDict, field_validator
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.exc import IntegrityError
from app.api.deps import require_roles
from app.core.database import get_db

router = APIRouter()
admin = require_roles(['ADMIN'])
class StoreWrite(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)
    store_code: str = Field(min_length=1,max_length=20)
    store_name: str = Field(min_length=1,max_length=150)
    address: str = Field(min_length=1,max_length=255)
    district: str = Field(min_length=1,max_length=50)
    city: str = Field(default='TP. Hồ Chí Minh',min_length=1,max_length=50)
    open_date: date
    manager_employee_id: int | None = Field(default=None,gt=0)
    is_active: bool = True
    latitude: float = Field(ge=-90,le=90,allow_inf_nan=False)
    longitude: float = Field(ge=-180,le=180,allow_inf_nan=False)
    radius_meters: int = Field(ge=10,le=5000)
    wifi_networks: list[str] = Field(default_factory=list,max_length=10)

    @field_validator('wifi_networks')
    @classmethod
    def valid_networks(cls, values: list[str]) -> list[str]:
        try:
            canonical = [str(ipaddress.ip_network(value.strip(), strict=False)) for value in values]
        except ValueError as exc:
            raise ValueError('IP hoặc dải CIDR không hợp lệ') from exc
        if len(set(canonical)) != len(canonical):
            raise ValueError('Dải IP bị lặp')
        return canonical

@router.get('')
async def list_stores(user=Depends(admin),db:AsyncSession=Depends(get_db)):
    return [dict(r) for r in (await db.execute(text('''SELECT s.*,g.latitude,g.longitude,g.radius_meters,
        COALESCE((SELECT array_agg(n.network::text ORDER BY n.network::text)
                  FROM store_web_attendance_networks n WHERE n.store_id=s.store_id),ARRAY[]::text[]) AS wifi_networks,
        e.full_name AS manager_name FROM stores s LEFT JOIN mobile_store_geofences g USING(store_id)
        LEFT JOIN employees e ON e.employee_id=s.manager_employee_id ORDER BY s.store_id'''))).mappings().all()]

async def save_store(req,store_id,user,db):
    values=req.model_dump()
    values.pop('wifi_networks')
    if req.manager_employee_id:
        manager=(await db.execute(text('''SELECT e.store_id FROM employees e JOIN users u USING(employee_id)
          JOIN user_roles ur USING(user_id) JOIN roles r USING(role_id)
          WHERE e.employee_id=:id AND r.role_code='STORE_MANAGER' AND e.employment_status='ACTIVE'
          FOR UPDATE OF e'''),{'id':req.manager_employee_id})).mappings().first()
        if not manager or (store_id and manager['store_id']!=store_id):
            raise HTTPException(422,'Quản lý phải là cửa hàng trưởng đang làm việc tại cửa hàng này')
        if store_id is None:
            raise HTTPException(422,'Tạo cửa hàng trước, điều chuyển quản lý rồi cập nhật người phụ trách')
    old=None
    try:
        if store_id:
            old=(await db.execute(text('SELECT * FROM stores WHERE store_id=:id FOR UPDATE'),{'id':store_id})).mappings().first()
            if not old: raise HTTPException(404,'Không tìm thấy cửa hàng')
            await db.execute(text('''UPDATE stores SET store_code=:store_code,store_name=:store_name,address=:address,
              district=:district,city=:city,open_date=:open_date,manager_employee_id=:manager_employee_id,is_active=:is_active
              WHERE store_id=:id'''),dict(values,id=store_id))
        else:
            store_id=(await db.execute(text('''INSERT INTO stores(store_code,store_name,address,district,city,open_date,manager_employee_id,is_active)
              VALUES(:store_code,:store_name,:address,:district,:city,:open_date,:manager_employee_id,:is_active) RETURNING store_id'''),values)).scalar_one()
        await db.execute(text('''INSERT INTO mobile_store_geofences(store_id,latitude,longitude,radius_meters,is_active)
            VALUES(:id,:latitude,:longitude,:radius_meters,:is_active) ON CONFLICT(store_id) DO UPDATE
            SET latitude=EXCLUDED.latitude,longitude=EXCLUDED.longitude,radius_meters=EXCLUDED.radius_meters,is_active=EXCLUDED.is_active'''),dict(values,id=store_id))
        await db.execute(text('DELETE FROM store_web_attendance_networks WHERE store_id=:id'),{'id':store_id})
        for network in req.wifi_networks:
            await db.execute(text('INSERT INTO store_web_attendance_networks(store_id,network) VALUES(:id,CAST(:network AS cidr))'),
                             {'id':store_id,'network':network})
        await db.execute(text('''INSERT INTO audit_logs(user_id,action,entity_name,entity_id,old_values,new_values)
          VALUES(:user,'CONFIGURE_STORE','stores',:id,CAST(:old AS jsonb),CAST(:new AS jsonb))'''),
          {'user':user['user_id'],'id':str(store_id),'old':json.dumps(dict(old),default=str) if old else None,'new':req.model_dump_json()})
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise HTTPException(409,'Mã cửa hàng đã tồn tại hoặc dữ liệu liên kết không hợp lệ')
    return {'store_id':store_id,'message':'Đã lưu cửa hàng và vùng chấm công'}

@router.post('',status_code=201)
async def create_store(req:StoreWrite,user=Depends(admin),db:AsyncSession=Depends(get_db)):
    return await save_store(req,None,user,db)

@router.put('/{store_id}')
async def update_store(store_id:int,req:StoreWrite,user=Depends(admin),db:AsyncSession=Depends(get_db)):
    return await save_store(req,store_id,user,db)
