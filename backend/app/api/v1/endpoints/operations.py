"""Scoped workforce read models shared by web and mobile."""
from datetime import date
from fastapi import APIRouter, Depends, Query, HTTPException, Response
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession
from urllib.parse import urlsplit
import base64
import hashlib
import httpx
import logging
import os
import re
from app.api.deps import get_current_user
from app.core.config import settings
from app.core.database import get_db
from app.core.work_schedule import scope

router=APIRouter()
logger=logging.getLogger(__name__)

@router.get('/monthly-attendance')
async def monthly_attendance(period:str=Query(...,pattern=r'^\d{4}-(0[1-9]|1[0-2])$'),
    employee_id:int|None=None,department_id:int|None=None,store_id:int|None=None,status:str|None=None,
    user=Depends(get_current_user),db:AsyncSession=Depends(get_db)):
    """Month-level workforce view; keep each attendance session for drill-down."""
    from calendar import monthrange
    year,month=map(int,period.split('-'))
    start,end=date(year,month,1),date(year,month,monthrange(year,month)[1])
    params={'start':start,'end':end}
    where=scope(user,params,'e')
    for name,value in [('employee_id',employee_id),('department_id',department_id),('store_id',store_id)]:
        if value is not None:
            params[name]=value
            where+=f' AND e.{name}=:{name}'
    people=[dict(r) for r in (await db.execute(text('''SELECT e.employee_id,e.full_name AS employee_name,
        d.department_name,s.store_name FROM employees e LEFT JOIN departments d USING(department_id)
        LEFT JOIN stores s USING(store_id) WHERE (e.employment_status IN ('ACTIVE','PROBATION') OR EXISTS
        (SELECT 1 FROM attendances a WHERE a.employee_id=e.employee_id AND a.work_date BETWEEN :start AND :end))'''+where+
        ' ORDER BY s.store_name,d.department_name,e.full_name,e.employee_id'),params)).mappings().all()]
    ids=[p['employee_id'] for p in people]
    if not ids: return {'period':period,'employees':[]}
    params['ids']=ids
    sessions=[dict(r) for r in (await db.execute(text('''SELECT a.attendance_id,a.employee_id,a.work_date,a.check_in_time,a.check_out_time,
        a.actual_work_hours,a.late_minutes,a.early_minutes,a.overtime_hours,a.status,a.attendance_context,
        COALESCE(a.attendance_context->>'schedule_status','LEGACY_UNKNOWN') AS schedule_status,
        sh.shift_name FROM attendances a LEFT JOIN work_shifts sh USING(shift_id)
        WHERE a.employee_id=ANY(:ids) AND a.work_date BETWEEN :start AND :end ORDER BY a.work_date,a.check_in_time,a.attendance_id'''),params)).mappings().all()]
    planned={r['employee_id']:float(r['hours']) for r in (await db.execute(text('''SELECT ws.employee_id,
        SUM(EXTRACT(EPOCH FROM (sh.end_time-sh.start_time+CASE WHEN sh.end_time<=sh.start_time THEN interval '1 day' ELSE interval '0 day' END))/3600) AS hours
        FROM work_schedules ws JOIN work_shifts sh USING(shift_id) WHERE ws.employee_id=ANY(:ids)
          AND ws.work_date BETWEEN :start AND :end
          AND (ws.cancelled_at IS NULL OR EXISTS (
              SELECT 1 FROM attendances prior WHERE prior.employee_id=ws.employee_id
              AND prior.attendance_context->'planned'->>'schedule_id'=ws.schedule_id::text))
          GROUP BY ws.employee_id'''),params)).mappings().all()}
    leaves=[dict(r) for r in (await db.execute(text('''SELECT request_id,employee_id,start_date,end_date,total_days
        FROM leave_requests WHERE employee_id=ANY(:ids) AND status='HR_APPROVED'
          AND start_date<=:end AND end_date>=:start ORDER BY start_date,request_id'''),params)).mappings().all()]
    result=[]
    for person in people:
        rows=[r for r in sessions if r['employee_id']==person['employee_id']]
        if status and status!='ALL' and not any(r['status']==status for r in rows): continue
        lr=[r for r in leaves if r['employee_id']==person['employee_id']]
        person.update(sessions=rows,scheduled_hours=planned.get(person['employee_id'],0),
            actual_work_hours=sum(float(r['actual_work_hours'] or 0) for r in rows),
            late_minutes=sum(r['late_minutes'] or 0 for r in rows),early_minutes=sum(r['early_minutes'] or 0 for r in rows),
            overtime_hours=sum(float(r['overtime_hours'] or 0) for r in rows),
            working_days=len({r['work_date'] for r in rows if r['check_in_time']}),
            leave_requests=lr,
            leave_days=None if any(r['start_date']<start or r['end_date']>end for r in lr) else sum(float(r['total_days']) for r in lr),
            statuses=sorted({r['status'] for r in rows}))
        result.append(person)
    return {'period':period,'employees':result}

@router.get('/notifications')
async def notifications(user=Depends(get_current_user),db:AsyncSession=Depends(get_db)):
    params={}
    where=scope(user,params,'e')
    manager=bool(set(user.get('roles',[])) & {'ADMIN','HR_MANAGER','STORE_MANAGER','DIRECTOR'})
    condition="lr.status IN ('PENDING','STORE_APPROVED')" if manager else "lr.status IN ('HR_APPROVED','REJECTED','STORE_APPROVED')"
    rows=(await db.execute(text('''SELECT lr.request_id,lr.status,lr.updated_at,e.full_name
        FROM leave_requests lr JOIN employees e USING(employee_id)
        WHERE '''+condition+where+' ORDER BY lr.request_id DESC LIMIT 50'),params)).mappings().all()
    labels={'PENDING':'Chờ duyệt','STORE_APPROVED':'Chờ HR duyệt','HR_APPROVED':'Đã duyệt','REJECTED':'Đã từ chối'}
    result=[{'id':f"leave-{r['request_id']}-{r['status']}",'title':f"{r['full_name']} · Đơn #{r['request_id']}: {labels[r['status']]}",'href':'/leave',
             'category':'Đơn từ & nghỉ phép','tone':'success' if r['status']=='HR_APPROVED' else 'error' if r['status']=='REJECTED' else 'warning',
             'created_at':r['updated_at'].isoformat() if r['updated_at'] else None} for r in rows]
    attendance_params={}
    attendance_scope=scope(user,attendance_params,'e')
    attendance_rows=(await db.execute(text('''SELECT a.attendance_id,a.check_in_time,a.check_out_time,a.late_minutes,e.full_name
        FROM attendances a JOIN employees e ON e.employee_id=a.employee_id
        WHERE a.check_in_time >= now() - interval '7 days' '''+attendance_scope+'''
        ORDER BY a.check_in_time DESC,a.attendance_id DESC LIMIT 30'''),attendance_params)).mappings().all()
    for row in attendance_rows:
        base={'category':'Chấm công','href':'/activity'}
        result.append({**base,'id':f"attendance-in-{row['attendance_id']}",
            'title':f"{row['full_name']} · Đã chấm công vào",
            'tone':'warning' if (row['late_minutes'] or 0)>15 else 'success',
            'created_at':row['check_in_time'].isoformat()})
        if row['check_out_time']:
            result.append({**base,'id':f"attendance-out-{row['attendance_id']}",
                'title':f"{row['full_name']} · Hoàn thành chấm công ra",
                'tone':'success','created_at':row['check_out_time'].isoformat()})
    result.sort(key=lambda item:item['created_at'] or '',reverse=True)
    result=result[:50]
    if result:
        read=(await db.execute(text('SELECT notice_id FROM notification_reads WHERE user_id=:id AND notice_id=ANY(:ids)'),
            {'id':user['user_id'],'ids':[r['id'] for r in result]})).scalars().all()
        for item in result: item['is_read']=item['id'] in read
    return result

@router.post('/notifications/{notice_id}/read')
async def read_notification(notice_id:str,user=Depends(get_current_user),db:AsyncSession=Depends(get_db)):
    if not any(item['id']==notice_id for item in await notifications(user,db)):
        raise HTTPException(404,'Không tìm thấy thông báo trong phạm vi tài khoản')
    await db.execute(text('''INSERT INTO notification_reads(user_id,notice_id) VALUES(:user,:notice)
        ON CONFLICT(user_id,notice_id) DO NOTHING'''),{'user':user['user_id'],'notice':notice_id})
    await db.commit()
    return {'notice_id':notice_id,'is_read':True}

@router.get('/activity')
async def activity(day:date,employee_id:int|None=None,department_id:int|None=None,store_id:int|None=None,
                   personal:bool=False,user=Depends(get_current_user),db:AsyncSession=Depends(get_db)):
    params={'day':day}
    where=scope(user,params,'e')
    if personal:
        params['personal']=user.get('employee_id') or -1
        where+=' AND e.employee_id=:personal'
    for name,value in [('employee_id',employee_id),('department_id',department_id),('store_id',store_id)]:
        if value is not None:
            params[name]=value; where+=f' AND e.{name}=:{name}'
    people=[dict(r) for r in (await db.execute(text('''SELECT e.employee_id,e.full_name AS employee_name,
      e.department_id,d.department_name,e.store_id,s.store_name FROM employees e
      LEFT JOIN departments d USING(department_id) LEFT JOIN stores s USING(store_id)
      WHERE (e.employment_status IN ('ACTIVE','PROBATION') OR EXISTS
        (SELECT 1 FROM attendances a WHERE a.employee_id=e.employee_id AND a.work_date=:day))'''+where+
      ' ORDER BY s.store_name,d.department_name,e.full_name,e.employee_id'),params)).mappings().all()]
    ids=[p['employee_id'] for p in people]
    sessions=[]
    if ids:
        sessions=[dict(r) for r in (await db.execute(text('''SELECT a.attendance_id,a.employee_id,a.work_date,
          a.check_in_time,a.check_out_time,a.actual_work_hours,a.late_minutes,a.early_minutes,a.overtime_hours,
          a.status,a.attendance_context,COALESCE(a.attendance_context->>'schedule_status','LEGACY_UNKNOWN') AS schedule_status,
          sh.shift_name,s.store_name AS attendance_store_name
          FROM attendances a LEFT JOIN work_shifts sh USING(shift_id) LEFT JOIN stores s USING(store_id)
          WHERE a.employee_id=ANY(:ids) AND a.work_date=:day ORDER BY a.check_in_time,a.attendance_id'''),
          {'ids':ids,'day':day})).mappings().all()]
        attendance_ids=[row['attendance_id'] for row in sessions]
        if attendance_ids:
            proofs=[dict(r) for r in (await db.execute(text('''SELECT proof_id,attendance_id,check_type,latitude,longitude,
                verification_status,created_at FROM mobile_attendance_proofs
                WHERE attendance_id=ANY(:ids) AND verification_status='SUCCESS'
                ORDER BY created_at,proof_id'''),{'ids':attendance_ids})).mappings().all()]
            proofs_by_attendance={}
            for proof in proofs: proofs_by_attendance.setdefault(proof['attendance_id'],[]).append(proof)
            for row in sessions: row['proofs']=proofs_by_attendance.get(row['attendance_id'],[])
    by_employee={}
    for row in sessions: by_employee.setdefault(row['employee_id'],[]).append(row)
    summary=dict(total=len(people),checked_in=0,working=0,finished=0,not_checked_in=0,late=0,early=0,overtime=0)
    for person in people:
        rows=by_employee.get(person['employee_id'],[])
        person['sessions']=rows
        checked=any(r['check_in_time'] for r in rows)
        working=any(r['check_in_time'] and not r['check_out_time'] for r in rows)
        for key,flag in [('checked_in',checked),('working',working),('finished',checked and not working),
            ('not_checked_in',not checked),('late',any((r['late_minutes'] or 0)>15 for r in rows)),
            ('early',any((r['early_minutes'] or 0)>0 for r in rows)),('overtime',any((r['overtime_hours'] or 0)>0 for r in rows))]:
            summary[key]+=int(bool(flag))
    return {'day':day,'summary':summary,'employees':people}

@router.get('/activity/proofs/{proof_id}')
async def activity_proof(proof_id:int,size:str=Query('thumb',pattern='^(thumb|full)$'),
                         user=Depends(get_current_user),db:AsyncSession=Depends(get_db)):
    """Proxy a Cloudinary proof only after applying the same employee/store scope as activity."""
    params={}
    where=scope(user,params,'e')
    row=(await db.execute(text('''SELECT p.photo_url FROM mobile_attendance_proofs p
        JOIN employees e ON e.employee_id=p.employee_id
        WHERE p.proof_id=:proof_id AND p.attendance_id IS NOT NULL
          AND p.verification_status='SUCCESS' '''+where),{'proof_id':proof_id,**params})).mappings().first()
    if not row: raise HTTPException(404,'Không tìm thấy minh chứng hoặc bạn không có quyền xem.')
    if not settings.CLOUDINARY_CLOUD_NAME or not settings.CLOUDINARY_API_SECRET: raise HTTPException(503,'Cloudinary chưa được cấu hình.')
    source=urlsplit(row['photo_url'])
    base_path=f'/{settings.CLOUDINARY_CLOUD_NAME}/image/'
    if source.scheme!='https' or source.hostname!='res.cloudinary.com' or not source.path.startswith(base_path):
        raise HTTPException(502,'Nguồn ảnh minh chứng không hợp lệ.')
    if source.path.startswith(base_path+'authenticated/'):
        # New attendance proofs are private Cloudinary assets. Sign this exact
        # eager thumbnail or original path; the signed URL stays server-side.
        resource_path=source.path[len(base_path+'authenticated/'):]
        # Cloudinary may return secure_url with its own s--...-- segment.
        # It is not part of the resource path to be signed again; retaining it
        # makes Cloudinary parse the old signature as a transformation (HTTP 400).
        resource_path=re.sub(r'^s--[A-Za-z0-9_-]{8}--/','',resource_path,count=1)
        signed_path=f'c_limit,w_320,h_320,q_auto:good/{resource_path}' if size=='thumb' else resource_path
        signature=base64.urlsafe_b64encode(hashlib.sha1(
            f'{signed_path}{settings.CLOUDINARY_API_SECRET}'.encode()).digest()).decode()[:8]
        delivery_path=f'{base_path}authenticated/s--{signature}--/{signed_path}'
    elif source.path.startswith(base_path+'upload/'):
        # Previously uploaded public assets remain viewable through this scoped proxy.
        transform='c_limit,w_320,h_320,q_auto:good,f_auto' if size=='thumb' else 'c_limit,w_1280,h_1280,q_auto:good,f_auto'
        delivery_path=source.path.replace('/image/upload/','/image/upload/'+transform+'/',1)
    else:
        raise HTTPException(502,'Loại lưu trữ ảnh minh chứng không được hỗ trợ.')
    cloudinary_url=source._replace(path=delivery_path).geturl()
    try:
        async with httpx.AsyncClient(timeout=20,follow_redirects=False) as client:
            image=await client.get(cloudinary_url)
        if image.status_code!=200:
            provider_status=image.status_code
            provider_detail=image.headers.get('x-cld-error') or image.text[:500]
            if os.getenv('ENVIRONMENT','development').lower() in {'development','dev','local'}:
                safe_detail=re.sub(r'https?://\S+','[URL đã ẩn]',provider_detail)
                safe_detail=re.sub(r's--[^/\s]+--','s--[chữ ký đã ẩn]--',safe_detail)
                safe_detail=re.sub(r'(?i)(api[_ -]?key|api[_ -]?secret|token|signature)\s*[:=]\s*[^\s,;]+',r'\1=[đã ẩn]',safe_detail)[:240]
                logger.warning('Attendance proof delivery failed proof_id=%s size=%s asset_type=%s upstream_status=%s reason=%s',
                    proof_id,size,'authenticated' if source.path.startswith(base_path+'authenticated/') else 'upload',
                    provider_status,safe_detail)
            raise HTTPException(502,detail={
                'code':'PROOF_IMAGE_PROVIDER_ERROR',
                'message':'Không tải được ảnh minh chứng từ nhà cung cấp ảnh.',
                'provider_status':provider_status,
            })
        if len(image.content)>8*1024*1024: raise HTTPException(413,'Ảnh minh chứng vượt quá giới hạn xem.')
        media_type=image.headers.get('content-type','image/jpeg').split(';',1)[0]
        if not media_type.startswith('image/'): raise HTTPException(502,'Cloudinary trả về dữ liệu không phải ảnh.')
        return Response(image.content,media_type=media_type,headers={
            'Cache-Control':'private, max-age=60','X-Content-Type-Options':'nosniff',
        })
    except httpx.HTTPError as exc:
        raise HTTPException(502,'Cloudinary tạm thời không truy cập được.') from exc

@router.get('/filter-options')
async def options(user=Depends(get_current_user),db:AsyncSession=Depends(get_db)):
    params={}; where=scope(user,params,'e')
    rows=[dict(r) for r in (await db.execute(text('''SELECT e.employee_id,e.full_name,e.department_id,d.department_name,
       e.store_id,s.store_name,e.position_id,p.position_name FROM employees e LEFT JOIN departments d USING(department_id)
       LEFT JOIN positions p USING(position_id)
       LEFT JOIN stores s USING(store_id) WHERE TRUE'''+where+
       ' ORDER BY e.full_name'),params)).mappings().all()]
    return {'employees':rows,
       'departments':list({r['department_id']:{'id':r['department_id'],'name':r['department_name']} for r in rows if r['department_id']}.values()),
       'stores':list({r['store_id']:{'id':r['store_id'],'name':r['store_name']} for r in rows if r['store_id']}.values()),
       'positions':list({r['position_id']:{'id':r['position_id'],'name':r['position_name']} for r in rows if r['position_id']}.values())}
