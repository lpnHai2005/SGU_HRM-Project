import logging
import re
import time
"""Admin store/geofence configuration; reads the same geofence used by mobile."""
import json
import ipaddress
from datetime import date
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field, ConfigDict, field_validator
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.exc import IntegrityError
import httpx
from app.api.deps import require_roles
from app.core.database import get_db
from app.core.config import settings

router = APIRouter()
admin = require_roles(['ADMIN', 'DIRECTOR'])
logger = logging.getLogger(__name__)

@router.get('/poi-search')
async def search_store_poi(
    q: str = Query(min_length=3, max_length=150),
    _user=Depends(admin),
    focus_lat: float | None = Query(default=None, ge=-90, le=90),
    focus_lon: float | None = Query(default=None, ge=-180, le=180),
):
    """Search TrackAsia through the backend; never expose credentials to browser."""
    if not settings.TRACKASIA_API_KEY:
        raise HTTPException(503, 'Chưa cấu hình TrackAsia API key trên backend')
    if len(q.strip()) < 3:
        raise HTTPException(422, 'Từ khóa tìm kiếm phải có ít nhất 3 ký tự không phải khoảng trắng')
    if (focus_lat is None) != (focus_lon is None):
        raise HTTPException(422, 'Cần gửi đồng thời focus_lat và focus_lon')
    params = {'text': q.strip(), 'key': settings.TRACKASIA_API_KEY, 'lang': 'vi',
              'new_admin': 'true', 'include_old_admin': 'true', 'size': '7'}
    if focus_lat is not None:
        params['focus.point.lat'] = str(focus_lat)
        params['focus.point.lon'] = str(focus_lon)
    started = time.perf_counter()
    try:
        async with httpx.AsyncClient(timeout=8.0) as client:
            response = await client.get('https://maps.track-asia.com/api/v1/search', params=params)
        duration = int((time.perf_counter() - started) * 1000)
        logger.info('TrackAsia search status=%s duration_ms=%d', response.status_code, duration)
        if response.status_code in (401, 403):
            logger.warning('TrackAsia search credentials rejected status=%s', response.status_code)
            raise HTTPException(502, f'TrackAsia từ chối xác thực API key (HTTP {response.status_code})')
        if response.status_code == 429:
            raise HTTPException(429, 'TrackAsia đã đạt giới hạn yêu cầu, vui lòng thử lại sau')
        response.raise_for_status()
        payload = response.json()
    except HTTPException:
        raise
    except httpx.TimeoutException:
        logger.warning('TrackAsia search timeout duration_ms=%d', int((time.perf_counter() - started) * 1000))
        raise HTTPException(504, 'TrackAsia tìm địa điểm quá thời gian cho phép')
    except httpx.HTTPStatusError as exc:
        logger.warning('TrackAsia search upstream status=%s duration_ms=%d', exc.response.status_code, int((time.perf_counter() - started) * 1000))
        raise HTTPException(502, f'TrackAsia Search trả lỗi từ nhà cung cấp (HTTP {exc.response.status_code})')
    except (httpx.HTTPError, ValueError) as exc:
        logger.warning('TrackAsia search failed error_type=%s duration_ms=%d', type(exc).__name__, int((time.perf_counter() - started) * 1000))
        raise HTTPException(502, 'Không truy vấn được dịch vụ TrackAsia Search')
    if not isinstance(payload, dict) or not isinstance(payload.get('features'), list):
        raise HTTPException(502, 'TrackAsia trả về dữ liệu địa điểm không hợp lệ')
    normalized = []
    for feature in payload['features'][:7]:
        if not isinstance(feature, dict):
            continue
        props = feature.get('properties')
        geom = feature.get('geometry')
        props = props if isinstance(props, dict) else {}
        geom = geom if isinstance(geom, dict) else {}
        coords = geom.get('coordinates')
        if not isinstance(coords, (list, tuple)) or len(coords) < 2:
            continue
        lon, lat = coords[:2]
        if isinstance(lat, bool) or isinstance(lon, bool) or not isinstance(lat, (int, float)) or not isinstance(lon, (int, float)) or not (-90 <= lat <= 90 and -180 <= lon <= 180):
            continue
        name = props.get('name') or props.get('display_name') or ''
        address = props.get('address') or props.get('display_name') or ''
        normalized.append({'name': name if isinstance(name, str) else '',
                           'address': address if isinstance(address, str) else '',
                           'latitude': lat, 'longitude': lon})
    return {'type': 'FeatureCollection', 'features': normalized}

@router.get('/reverse-geocode')
async def reverse_store_location(
    lat: float = Query(ge=-90, le=90),
    lon: float = Query(ge=-180, le=180),
    _user=Depends(admin),
):
    """Resolve an explicitly selected store POI/pin; no employee GPS is sent here."""
    if not settings.TRACKASIA_API_KEY:
        raise HTTPException(503, 'Chưa cấu hình TrackAsia API key trên backend')
    params = {'point.lat': str(lat), 'point.lon': str(lon), 'key': settings.TRACKASIA_API_KEY,
              'lang': 'vi', 'new_admin': 'true', 'include_old_admin': 'true', 'size': '5',
              'boundary.circle.radius': '0.05'}
    started = time.perf_counter()
    try:
        async with httpx.AsyncClient(timeout=8.0) as client:
            response = await client.get('https://maps.track-asia.com/api/v1/reverse', params=params)
        logger.info('TrackAsia reverse status=%s duration_ms=%d', response.status_code, int((time.perf_counter() - started) * 1000))
        if response.status_code in (401, 403):
            logger.warning('TrackAsia reverse credentials rejected status=%s', response.status_code)
            raise HTTPException(502, f'TrackAsia từ chối xác thực API key (HTTP {response.status_code})')
        if response.status_code == 429:
            raise HTTPException(429, 'TrackAsia đã đạt giới hạn yêu cầu, vui lòng thử lại sau')
        response.raise_for_status()
        payload = response.json()
    except HTTPException:
        raise
    except httpx.TimeoutException:
        logger.warning('TrackAsia reverse timeout duration_ms=%d', int((time.perf_counter() - started) * 1000))
        raise HTTPException(504, 'TrackAsia lấy địa chỉ quá thời gian cho phép')
    except httpx.HTTPStatusError as exc:
        logger.warning('TrackAsia reverse upstream status=%s duration_ms=%d', exc.response.status_code, int((time.perf_counter() - started) * 1000))
        raise HTTPException(502, f'TrackAsia Reverse trả lỗi từ nhà cung cấp (HTTP {exc.response.status_code})')
    except (httpx.HTTPError, ValueError) as exc:
        logger.warning('TrackAsia reverse failed error_type=%s duration_ms=%d', type(exc).__name__, int((time.perf_counter() - started) * 1000))
        raise HTTPException(502, 'Không truy vấn được TrackAsia Reverse Geocoding')
    if not isinstance(payload, dict) or not isinstance(payload.get('features'), list):
        raise HTTPException(502, 'TrackAsia trả về dữ liệu địa chỉ không hợp lệ')
    return {'type': 'FeatureCollection', 'features': payload['features'][:5]}

@router.get('/managers')
async def list_store_managers(user=Depends(admin), db:AsyncSession=Depends(get_db)):
    rows=(await db.execute(text('''SELECT e.employee_id,e.store_id,e.full_name,
        COALESCE(string_agg(DISTINCT s.store_name,' • ' ORDER BY s.store_name),'') AS assigned_store_names,
        COALESCE(array_agg(DISTINCT s.store_id) FILTER (WHERE s.store_id IS NOT NULL),'{}') AS assigned_store_ids
        FROM employees e JOIN users u USING(employee_id) JOIN user_roles ur USING(user_id)
        JOIN roles r USING(role_id) LEFT JOIN stores s ON s.manager_employee_id=e.employee_id AND s.is_active IS TRUE
        WHERE r.role_code='STORE_MANAGER' AND e.employment_status='ACTIVE'
        GROUP BY e.employee_id,e.store_id,e.full_name ORDER BY e.full_name'''))).mappings().all()
    return [dict(row) for row in rows]

class StoreWrite(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)
    store_code: str = Field(min_length=1,max_length=20)
    store_name: str = Field(min_length=1,max_length=150)
    address: str = Field(min_length=1,max_length=255)
    district: str = Field(min_length=1,max_length=50)
    city: str = Field(default='TP. Hồ Chí Minh',min_length=1,max_length=50)
    open_date: date
    manager_employee_id: int | None = Field(default=None,gt=0)
    manager_transfer_confirmed: bool = False
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

class StoreStatusChange(BaseModel):
    is_active: bool
    reason: str = Field(min_length=8, max_length=500)
    handoff_confirmed: bool = False
    handoff_summary: str = Field(default='', max_length=1000)

    @field_validator('reason')
    @classmethod
    def nonblank_reason(cls, value: str) -> str:
        value=value.strip()
        if len(value)<8:
            raise ValueError('Lý do phải có ít nhất 8 ký tự không tính khoảng trắng')
        return value

@router.get('/{store_id}/deactivation-check')
async def store_deactivation_check(store_id: int, user=Depends(admin), db: AsyncSession=Depends(get_db)):
    """Read-only preflight; counts operational records without changing them."""
    store = (await db.execute(text('SELECT store_id,store_name,store_code,is_active FROM stores WHERE store_id=:id'), {'id': store_id})).mappings().first()
    if not store:
        raise HTTPException(404, 'Không tìm thấy cửa hàng')
    employees = (await db.execute(text("SELECT COUNT(*) FROM employees WHERE store_id=:id AND employment_status IN ('ACTIVE','PROBATION')"), {'id': store_id})).scalar_one()
    future_shifts = (await db.execute(text('SELECT COUNT(*) FROM work_schedules WHERE store_id=:id AND work_date>=CURRENT_DATE AND cancelled_at IS NULL'), {'id': store_id})).scalar_one()
    open_sessions = (await db.execute(text('SELECT COUNT(*) FROM attendances WHERE store_id=:id AND check_in_time IS NOT NULL AND check_out_time IS NULL'), {'id': store_id})).scalar_one()
    pending_leave = (await db.execute(text("SELECT COUNT(*) FROM leave_requests lr JOIN employees e USING(employee_id) WHERE e.store_id=:id AND lr.status IN ('PENDING','STORE_APPROVED')"), {'id': store_id})).scalar_one()
    pending_overtime = (await db.execute(text('''SELECT COUNT(*) FROM attendances a LEFT JOIN attendance_overtime_approvals ota USING(attendance_id)
        WHERE a.store_id=:id AND a.check_out_time IS NOT NULL AND a.overtime_hours>0 AND ota.attendance_id IS NULL'''), {'id': store_id})).scalar_one()
    return {'store_id': store_id, 'store_name': store['store_name'], 'store_code': store['store_code'],
            'is_active': bool(store['is_active']), 'active_employees': int(employees),
            'future_shifts': int(future_shifts), 'open_attendance_sessions': int(open_sessions),
            'pending_leave_requests': int(pending_leave), 'pending_overtime_reviews': int(pending_overtime),
            'requires_handoff_confirmation': bool(employees or future_shifts),
            'can_deactivate': int(open_sessions) == 0}

class StoreDeleteRequest(BaseModel):
    reason: str = Field(min_length=8, max_length=500)
    confirm_store_code: str = Field(min_length=1, max_length=20)

    @field_validator('reason')
    @classmethod
    def nonblank_reason(cls, value: str) -> str:
        value=value.strip()
        if len(value)<8:
            raise ValueError('Lý do phải có ít nhất 8 ký tự không tính khoảng trắng')
        return value

@router.get('')
async def list_stores(user=Depends(admin),db:AsyncSession=Depends(get_db)):
    return [dict(r) for r in (await db.execute(text('''SELECT s.*,g.latitude,g.longitude,g.radius_meters,
        COALESCE((SELECT array_agg(n.network::text ORDER BY n.network::text)
                  FROM store_web_attendance_networks n WHERE n.store_id=s.store_id),ARRAY[]::text[]) AS wifi_networks,
        e.full_name AS manager_name,e.employee_code AS manager_code FROM stores s LEFT JOIN mobile_store_geofences g USING(store_id)
        LEFT JOIN employees e ON e.employee_id=s.manager_employee_id ORDER BY s.store_id'''))).mappings().all()]

async def save_store(req, store_id, user, db):
    values = req.model_dump()
    values.pop('wifi_networks')
    transfer_confirmed = values.pop('manager_transfer_confirmed', False)
    old = None
    try:
        # Store configuration is low-volume; a transaction advisory lock serializes manager transfers
        # across branches and avoids deadlocks when two branches are swapped concurrently.
        await db.execute(text('SELECT pg_advisory_xact_lock(740263001)'))
        if store_id:
            old = (await db.execute(text('SELECT * FROM stores WHERE store_id=:id FOR UPDATE'), {'id': store_id})).mappings().first()
            if not old:
                raise HTTPException(404, 'Store not found')
        raw_code = req.store_code.strip().upper()
        is_legacy_unchanged = bool(old and raw_code == str(old['store_code']).strip().upper())
        if not is_legacy_unchanged and not re.fullmatch(r'TZ-[A-Z0-9][A-Z0-9-]{0,16}', raw_code):
            raise HTTPException(422, 'Mã cửa hàng phải có tiền tố TZ- và hậu tố chữ/số không để trống')
        values['store_code'] = raw_code if not is_legacy_unchanged else old['store_code']

        manager_id = req.manager_employee_id
        if manager_id:
            manager = (await db.execute(text('''SELECT e.employee_id FROM employees e
                JOIN users u USING(employee_id) JOIN user_roles ur USING(user_id) JOIN roles r USING(role_id)
                WHERE e.employee_id=:id AND r.role_code='STORE_MANAGER' AND e.employment_status='ACTIVE'
                FOR UPDATE OF e'''), {'id': manager_id})).mappings().first()
            if not manager:
                raise HTTPException(422, 'Manager must be an active employee with STORE_MANAGER role')
            other_assignments = (await db.execute(text('''SELECT store_id,store_code,store_name FROM stores
                WHERE manager_employee_id=:manager_id AND is_active IS TRUE
                  AND (:target_id IS NULL OR store_id<>:target_id)
                ORDER BY store_id FOR UPDATE'''), {'manager_id': manager_id, 'target_id': store_id})).mappings().all()
            if other_assignments and req.is_active and not transfer_confirmed:
                raise HTTPException(409, detail={
                    'code': 'STORE_MANAGER_TRANSFER_REQUIRED',
                    'message': 'Cửa hàng trưởng đang nhận phân công chi nhánh khác. Xác nhận chuyển để tiếp tục.',
                    'assigned_stores': [dict(row) for row in other_assignments],
                })
            if other_assignments and req.is_active:
                for assigned in other_assignments:
                    await db.execute(text('UPDATE stores SET manager_employee_id=NULL WHERE store_id=:id'), {'id': assigned['store_id']})
                    await db.execute(text('''INSERT INTO audit_logs(user_id,action,entity_name,entity_id,old_values,new_values)
                        VALUES(:user,'TRANSFER_STORE_MANAGER','stores',:id,CAST(:old AS jsonb),CAST(:new AS jsonb))'''), {
                        'user': user['user_id'], 'id': str(assigned['store_id']),
                        'old': json.dumps({'manager_employee_id': manager_id, 'store_name': assigned['store_name']}, ensure_ascii=False),
                        'new': json.dumps({'manager_employee_id': None, 'transferred_to_store_id': store_id}, ensure_ascii=False),
                    })
        if store_id:
            await db.execute(text('''UPDATE stores SET store_code=:store_code,store_name=:store_name,address=:address,
              district=:district,city=:city,open_date=:open_date,manager_employee_id=:manager_employee_id,is_active=:is_active
              WHERE store_id=:id'''), dict(values, id=store_id))
        else:
            store_id = (await db.execute(text('''INSERT INTO stores(store_code,store_name,address,district,city,open_date,manager_employee_id,is_active)
              VALUES(:store_code,:store_name,:address,:district,:city,:open_date,:manager_employee_id,:is_active) RETURNING store_id'''), values)).scalar_one()
        await db.execute(text('''INSERT INTO mobile_store_geofences(store_id,latitude,longitude,radius_meters,is_active)
            VALUES(:id,:latitude,:longitude,:radius_meters,:is_active) ON CONFLICT(store_id) DO UPDATE
            SET latitude=EXCLUDED.latitude,longitude=EXCLUDED.longitude,radius_meters=EXCLUDED.radius_meters,is_active=EXCLUDED.is_active'''), dict(values, id=store_id))
        await db.execute(text('DELETE FROM store_web_attendance_networks WHERE store_id=:id'), {'id': store_id})
        for network in req.wifi_networks:
            await db.execute(text('INSERT INTO store_web_attendance_networks(store_id,network) VALUES(:id,CAST(:network AS cidr))'), {'id': store_id, 'network': network})
        audit_values = req.model_dump()
        audit_values.pop('manager_transfer_confirmed', None)
        await db.execute(text('''INSERT INTO audit_logs(user_id,action,entity_name,entity_id,old_values,new_values)
          VALUES(:user,'CONFIGURE_STORE','stores',:id,CAST(:old AS jsonb),CAST(:new AS jsonb))'''), {
            'user': user['user_id'], 'id': str(store_id),
            'old': json.dumps(dict(old), default=str, ensure_ascii=False) if old else None,
            'new': json.dumps(audit_values, default=str, ensure_ascii=False),
        })
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise HTTPException(409, 'Mã cửa hàng đã tồn tại hoặc dữ liệu liên kết không hợp lệ')
    except Exception:
        await db.rollback()
        raise
    return {'store_id': store_id, 'message': 'Đã lưu cửa hàng và vùng chấm công'}

@router.post('',status_code=201)
async def create_store(req:StoreWrite,user=Depends(admin),db:AsyncSession=Depends(get_db)):
    return await save_store(req,None,user,db)

@router.put('/{store_id}')
async def update_store(store_id:int,req:StoreWrite,user=Depends(admin),db:AsyncSession=Depends(get_db)):
    return await save_store(req,store_id,user,db)

@router.patch('/{store_id}/status')
async def change_store_status(store_id:int, req:StoreStatusChange, user=Depends(admin), db:AsyncSession=Depends(get_db)):
    try:
        await db.execute(text('SELECT pg_advisory_xact_lock(740263001)'))
        store=(await db.execute(text('SELECT * FROM stores WHERE store_id=:id FOR UPDATE'), {'id':store_id})).mappings().first()
        if not store:
            raise HTTPException(404, 'Không tìm thấy cửa hàng')
        if bool(store['is_active']) == req.is_active:
            await db.rollback()
            return {'store_id':store_id,'is_active':req.is_active,'message':'Trạng thái cửa hàng không thay đổi'}
        if not req.is_active:
            if not req.handoff_confirmed or len(req.handoff_summary.strip()) < 12:
                raise HTTPException(422, detail={'code':'STORE_HANDOFF_CONFIRMATION_REQUIRED','message':'Cần xác nhận đã bàn giao nhân sự/lịch còn hiệu lực và ghi rõ phương án xử lý trước khi ngừng cửa hàng.'})
            open_sessions = int((await db.execute(text('SELECT COUNT(*) FROM attendances WHERE store_id=:id AND check_in_time IS NOT NULL AND check_out_time IS NULL'), {'id':store_id})).scalar_one())
            if open_sessions:
                raise HTTPException(409, detail={'code':'STORE_HAS_OPEN_ATTENDANCE','message':f'Còn {open_sessions} phiên chấm công chưa checkout. Hãy hoàn tất phiên trước khi ngừng cửa hàng.','open_attendance_sessions':open_sessions})
        if req.is_active:
            if not store['manager_employee_id']:
                raise HTTPException(409, detail={'code':'STORE_MANAGER_REQUIRED','message':'Hãy phân công cửa hàng trưởng trước khi kích hoạt lại.'})
            manager=(await db.execute(text('''SELECT e.employee_id FROM employees e JOIN users u USING(employee_id)
                JOIN user_roles ur USING(user_id) JOIN roles r USING(role_id)
                WHERE e.employee_id=:manager AND e.employment_status='ACTIVE' AND r.role_code='STORE_MANAGER'
                FOR UPDATE OF e'''), {'manager':store['manager_employee_id']})).mappings().first()
            if not manager:
                raise HTTPException(409, detail={'code':'STORE_MANAGER_INVALID','message':'Cửa hàng trưởng đã nghỉ việc hoặc không còn vai trò STORE_MANAGER. Hãy cập nhật người phụ trách trước.'})
            other=(await db.execute(text('''SELECT store_id,store_name FROM stores
                WHERE manager_employee_id=:manager AND is_active IS TRUE AND store_id<>:id LIMIT 1'''),
                {'manager':store['manager_employee_id'],'id':store_id})).mappings().first()
            if other:
                raise HTTPException(409, detail={'code':'STORE_MANAGER_ALREADY_ASSIGNED','message':f"Cửa hàng trưởng đang phụ trách {other['store_name']}. Hãy xử lý phân công trước khi kích hoạt lại."})
            geofence=(await db.execute(text('SELECT latitude,longitude,radius_meters FROM mobile_store_geofences WHERE store_id=:id FOR UPDATE'), {'id':store_id})).mappings().first()
            valid_geofence=False
            if geofence and geofence['latitude'] is not None and geofence['longitude'] is not None and geofence['radius_meters'] is not None:
                lat,lon,radius=float(geofence['latitude']),float(geofence['longitude']),int(geofence['radius_meters'])
                valid_geofence=-90<=lat<=90 and -180<=lon<=180 and not (lat==0 and lon==0) and 10<=radius<=5000
            if not valid_geofence:
                raise HTTPException(409, detail={'code':'STORE_GEOFENCE_REQUIRED','message':'Cửa hàng chưa có vùng GPS hợp lệ nên chưa thể kích hoạt.'})
        previous_manager_id = store.get('manager_employee_id')
        await db.execute(text('UPDATE stores SET is_active=:active, manager_employee_id=CASE WHEN :active THEN manager_employee_id ELSE NULL END WHERE store_id=:id'), {'active':req.is_active,'id':store_id})
        await db.execute(text('UPDATE mobile_store_geofences SET is_active=:active WHERE store_id=:id'), {'active':req.is_active,'id':store_id})
        await db.execute(text('''INSERT INTO audit_logs(user_id,action,entity_name,entity_id,old_values,new_values)
            VALUES(:user,:action,'stores',:id,CAST(:old AS jsonb),CAST(:new AS jsonb))'''), {
            'user':user['user_id'],'action':'ACTIVATE_STORE' if req.is_active else 'DEACTIVATE_STORE','id':str(store_id),
            'old':json.dumps({'is_active':bool(store['is_active']), 'manager_employee_id':previous_manager_id},ensure_ascii=False),
            'new':json.dumps({'is_active':req.is_active,'manager_employee_id':previous_manager_id if req.is_active else None,
                              'reason':req.reason.strip(), 'handoff_summary':req.handoff_summary.strip() if not req.is_active else None},ensure_ascii=False),
        })
        await db.commit()
        return {'store_id':store_id,'is_active':req.is_active,'message':'Đã cập nhật trạng thái cửa hàng và vùng GPS'}
    except Exception:
        await db.rollback()
        raise

@router.delete('/{store_id}')
async def delete_store(store_id:int, req:StoreDeleteRequest, user=Depends(admin), db:AsyncSession=Depends(get_db)):
    try:
        await db.execute(text('SELECT pg_advisory_xact_lock(740263001)'))
        store=(await db.execute(text('SELECT * FROM stores WHERE store_id=:id FOR UPDATE'), {'id':store_id})).mappings().first()
        if not store:
            raise HTTPException(404, 'Không tìm thấy cửa hàng')
        if store['is_active']:
            raise HTTPException(409, detail={'code':'STORE_MUST_BE_INACTIVE','message':'Hãy ngừng hoạt động cửa hàng trước khi xóa.'})
        if req.confirm_store_code.strip().upper() != str(store['store_code']).strip().upper():
            raise HTTPException(422, detail={'code':'STORE_CONFIRMATION_MISMATCH','message':'Mã xác nhận không khớp với cửa hàng.'})
        references=(await db.execute(text('''SELECT ns.nspname AS schema_name, rel.relname AS table_name, att.attname AS column_name
            FROM pg_constraint c JOIN pg_class rel ON rel.oid=c.conrelid JOIN pg_namespace ns ON ns.oid=rel.relnamespace
            JOIN pg_attribute att ON att.attrelid=rel.oid AND att.attnum=c.conkey[1]
            JOIN pg_attribute referenced ON referenced.attrelid=c.confrelid AND referenced.attnum=c.confkey[1]
            WHERE c.contype='f' AND c.confrelid='stores'::regclass AND array_length(c.conkey,1)=1
              AND array_length(c.confkey,1)=1 AND referenced.attname='store_id'
            ORDER BY ns.nspname,rel.relname'''))).mappings().all()
        blockers=[]
        disposable={'mobile_store_geofences','store_web_attendance_networks'}
        for ref in references:
            if ref['table_name'] in disposable:
                continue
            schema_name=str(ref['schema_name']).replace('"','""')
            table_name=str(ref['table_name']).replace('"','""')
            column_name=str(ref['column_name']).replace('"','""')
            count=(await db.execute(text(f'SELECT COUNT(*) FROM "{schema_name}"."{table_name}" WHERE "{column_name}"=:id'), {'id':store_id})).scalar_one()
            if count:
                blockers.append({'table':ref['table_name'],'records':int(count)})
        if blockers:
            await db.rollback()
            raise HTTPException(409, detail={'code':'STORE_HAS_LINKED_RECORDS','message':'Không thể xóa vì cửa hàng còn dữ liệu nghiệp vụ liên kết. Hãy giữ cửa hàng ở trạng thái ngừng hoạt động.','references':blockers})
        await db.execute(text('''INSERT INTO audit_logs(user_id,action,entity_name,entity_id,old_values,new_values)
            VALUES(:user,'DELETE_STORE','stores',:id,CAST(:old AS jsonb),CAST(:new AS jsonb))'''), {
            'user':user['user_id'],'id':str(store_id),'old':json.dumps(dict(store),default=str,ensure_ascii=False),
            'new':json.dumps({'deleted':True,'reason':req.reason.strip()},ensure_ascii=False),
        })
        await db.execute(text('DELETE FROM mobile_store_geofences WHERE store_id=:id'), {'id':store_id})
        await db.execute(text('DELETE FROM store_web_attendance_networks WHERE store_id=:id'), {'id':store_id})
        await db.execute(text('DELETE FROM stores WHERE store_id=:id'), {'id':store_id})
        await db.commit()
        return {'store_id':store_id,'message':'Đã xóa cửa hàng sau khi kiểm tra dữ liệu liên kết; thao tác đã ghi audit.'}
    except IntegrityError:
        await db.rollback()
        raise HTTPException(409, detail={'code':'STORE_DELETE_CONSTRAINT','message':'Cửa hàng còn dữ liệu liên kết trong cơ sở dữ liệu nên không thể xóa an toàn.'})
    except Exception:
        await db.rollback()
        raise
