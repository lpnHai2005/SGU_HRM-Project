"""Mobile GPS/photo addon. Core attendance rules remain the authority."""
import hashlib
import json
import math
import time
from datetime import datetime, timezone
from uuid import UUID, uuid4

import httpx
import jwt
from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, Query
from fastapi.encoders import jsonable_encoder
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.api.v1.endpoints import attendances
from app.core.config import settings
from app.core.database import get_db
from app.schemas.schemas import CheckInRequest, CheckOutRequest

router = APIRouter()


@router.get('/my-schedules')
async def my_schedules(period: str = Query(..., pattern=r'^\d{4}-(0[1-9]|1[0-2])$'), user=Depends(get_current_user), db: AsyncSession=Depends(get_db)):
    employee = await attendances.authorize_employee(db, user, user.get('employee_id'))
    rows = await db.execute(text('''SELECT ws.schedule_id,ws.work_date,ws.shift_id,sh.shift_name,sh.start_time,sh.end_time,s.store_name
        FROM work_schedules ws JOIN work_shifts sh USING(shift_id) LEFT JOIN stores s USING(store_id)
        WHERE ws.employee_id=:emp AND to_char(ws.work_date,'YYYY-MM')=:period ORDER BY ws.work_date,ws.schedule_id'''),
        {'emp':employee['employee_id'],'period':period})
    return [dict(row) for row in rows.mappings().all()]


@router.get('/requests/{request_id}')
async def request_result(request_id: UUID, user=Depends(get_current_user), db: AsyncSession=Depends(get_db)):
    employee = await attendances.authorize_employee(db, user, user.get('employee_id'), lock=True)
    row = (await db.execute(text('SELECT verification_status,result FROM mobile_attendance_proofs WHERE employee_id=:emp AND request_id=:id'),
        {'emp':employee['employee_id'],'id':request_id})).mappings().first()
    if not row:
        return {'state':'NOT_FOUND'}
    return {'state':row['verification_status'],'result':row['result']}


def distance_meters(lat1, lon1, lat2, lon2):
    p1, p2 = math.radians(lat1), math.radians(lat2)
    a = math.sin((p2-p1)/2)**2 + math.cos(p1)*math.cos(p2)*math.sin(math.radians(lon2-lon1)/2)**2
    return 6371000 * 2 * math.asin(math.sqrt(min(1, max(0, a))))


class MobileRequest(BaseModel):
    request_id: UUID
    photo_token: str = Field(min_length=1, max_length=4096)
    latitude: float = Field(ge=-90, le=90, allow_inf_nan=False)
    longitude: float = Field(ge=-180, le=180, allow_inf_nan=False)
    accuracy_meters: float = Field(gt=0, le=100, allow_inf_nan=False)
    captured_at: datetime
    shift_id: int = Field(1, gt=0)


def verify_photo(token, employee_id):
    try:
        payload = jwt.decode(token, settings.JWT_SECRET_KEY, algorithms=[settings.ALGORITHM], audience='mobile-photo')
        if payload.get('sub') != str(employee_id):
            raise ValueError()
        UUID(payload['nonce'])
        return payload
    except (jwt.PyJWTError, ValueError, KeyError):
        raise HTTPException(422, 'Ảnh hết hạn hoặc không thuộc tài khoản. Vui lòng chụp lại.')


async def target_store(db, user):
    employee = await attendances.authorize_employee(db, user, user.get('employee_id'))
    active = (await db.execute(text('SELECT store_id FROM attendances WHERE employee_id=:id AND check_in_time IS NOT NULL AND check_out_time IS NULL LIMIT 1'), {'id':user['employee_id']})).mappings().first()
    return active['store_id'] if active else employee['store_id']


@router.get('/geofence')
async def geofence(user=Depends(get_current_user), db: AsyncSession=Depends(get_db)):
    store_id = await target_store(db, user)
    row = (await db.execute(text('SELECT g.*, s.store_name FROM mobile_store_geofences g JOIN stores s USING(store_id) WHERE g.store_id=:id AND g.is_active'), {'id':store_id})).mappings().first()
    if not row:
        raise HTTPException(409, 'Cửa hàng chưa cấu hình vùng chấm công. Liên hệ quản lý.')
    return dict(row)


@router.post('/photo')
async def upload_photo(file: UploadFile=File(...), user=Depends(get_current_user)):
    if not user.get('employee_id'):
        raise HTTPException(400, 'Tài khoản chưa liên kết nhân viên.')
    if not all([settings.CLOUDINARY_CLOUD_NAME, settings.CLOUDINARY_API_KEY, settings.CLOUDINARY_API_SECRET]):
        raise HTTPException(503, 'Dịch vụ ảnh chưa được cấu hình.')
    data = await file.read(5*1024*1024+1)
    if len(data) > 5*1024*1024 or not data.startswith(b'\xff\xd8\xff'):
        raise HTTPException(422, 'Ảnh phải là JPEG, tối đa 5 MB.')
    timestamp, nonce = int(time.time()), str(uuid4())
    public_id = f'techzone-attendance/{user["employee_id"]}/{nonce}'
    signature = hashlib.sha1(f'public_id={public_id}&timestamp={timestamp}{settings.CLOUDINARY_API_SECRET}'.encode()).hexdigest()
    try:
        async with httpx.AsyncClient(timeout=30) as client:
            response = await client.post(f'https://api.cloudinary.com/v1_1/{settings.CLOUDINARY_CLOUD_NAME}/image/upload',
                data={'api_key':settings.CLOUDINARY_API_KEY, 'timestamp':str(timestamp), 'public_id':public_id, 'signature':signature},
                files={'file':('selfie.jpg', data, 'image/jpeg')})
        response.raise_for_status()
        url = response.json()['secure_url']
    except (httpx.HTTPError, KeyError, ValueError):
        raise HTTPException(502, 'Không tải được ảnh. Vui lòng thử lại.')
    token = jwt.encode({'sub':str(user['employee_id']), 'aud':'mobile-photo', 'exp':timestamp+600, 'nonce':nonce, 'url':url}, settings.JWT_SECRET_KEY, algorithm=settings.ALGORITHM)
    return {'photo_token':token, 'photo_url':url, 'expires_in':600}


class AtomicSession:
    """Core endpoints may commit; defer that commit until proof is also written."""
    def __init__(self, db): self.db = db
    async def execute(self, *args, **kwargs): return await self.db.execute(*args, **kwargs)
    async def commit(self): pass


async def perform(kind, req, user, db):
    employee = await attendances.authorize_employee(db, user, user.get('employee_id'), lock=True)
    previous = (await db.execute(text('SELECT check_type, result, verification_status FROM mobile_attendance_proofs WHERE employee_id=:emp AND request_id=:request'),
                               {'emp':employee['employee_id'], 'request':req.request_id})).mappings().first()
    if previous:
        if previous['check_type'] != kind:
            raise HTTPException(409, 'Mã yêu cầu đã dùng cho thao tác khác.')
        if previous['verification_status'] != 'SUCCESS':
            raise HTTPException(422, 'Yêu cầu trước bị từ chối GPS; lấy vị trí và ảnh mới.')
        return json.loads(previous['result']) if isinstance(previous['result'], str) else previous['result']
    photo = verify_photo(req.photo_token, employee['employee_id'])
    used = (await db.execute(text('SELECT proof_id FROM mobile_attendance_proofs WHERE photo_nonce=:nonce'), {'nonce':UUID(photo['nonce'])})).first()
    if used:
        raise HTTPException(409, 'Ảnh đã được dùng. Vui lòng chụp ảnh mới.')
    if req.captured_at.tzinfo is None or not -15 <= (datetime.now(timezone.utc)-req.captured_at).total_seconds() <= 120:
        raise HTTPException(422, 'Vị trí quá cũ hoặc giờ điện thoại sai. Lấy lại vị trí.')
    fence = await geofence(user, db)
    distance = distance_meters(req.latitude, req.longitude, fence['latitude'], fence['longitude'])
    valid = distance <= fence['radius_meters'] and req.accuracy_meters <= min(100, fence['radius_meters'])
    result = None
    if valid:
        if kind == 'CHECK_IN':
            result = await attendances.check_in(CheckInRequest(shift_id=req.shift_id), user, AtomicSession(db))
        else:
            result = await attendances.check_out(CheckOutRequest(), user, AtomicSession(db))
    await db.execute(text('''INSERT INTO mobile_attendance_proofs
        (request_id,employee_id,store_id,attendance_id,check_type,latitude,longitude,accuracy_meters,
         distance_meters,radius_meters,photo_url,photo_nonce,verification_status,result)
        VALUES (:request,:emp,:store,:att,:kind,:lat,:lon,:accuracy,:distance,:radius,:url,:nonce,:status,CAST(:result AS jsonb))'''),
        dict(request=req.request_id, emp=employee['employee_id'], store=fence['store_id'],
             att=result['attendance_id'] if result else None, kind=kind, lat=req.latitude, lon=req.longitude,
             accuracy=req.accuracy_meters, distance=distance, radius=fence['radius_meters'], url=photo['url'],
             nonce=UUID(photo['nonce']), status='SUCCESS' if valid else 'REJECTED_GPS_OUT_OF_RANGE',
             result=json.dumps(jsonable_encoder(result))))
    await db.commit()
    if not valid:
        raise HTTPException(422, f'GPS không đạt yêu cầu: cách cửa hàng {distance:.0f} m, bán kính {fence["radius_meters"]} m.')
    return result


@router.post('/check-in', status_code=201)
async def check_in(req: MobileRequest, user=Depends(get_current_user), db: AsyncSession=Depends(get_db)):
    return await perform('CHECK_IN', req, user, db)


@router.post('/check-out')
async def check_out(req: MobileRequest, user=Depends(get_current_user), db: AsyncSession=Depends(get_db)):
    return await perform('CHECK_OUT', req, user, db)
