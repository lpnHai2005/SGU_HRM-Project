import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../services/api'
import { Icons } from '../components/common/Icons'
import { ROLE_LABELS } from '../constants/navigation'
import { getInitials, getRoleFromUser } from '../utils/formatters'
import { PersonalSchedulesPage } from './PersonalSchedulesPage'
import { assignedShift } from '../services/assignedShift'
import type { TodayAttendanceStatus } from '../types'
import { formatTime } from '../utils/formatters'
export function AccountPage({user}:{user:any}) {
  const [profile,setProfile]=useState<any>(null),[error,setError]=useState('')
  const [today,setToday]=useState<TodayAttendanceStatus|null>(null),[shift,setShift]=useState<Awaited<ReturnType<typeof assignedShift>>>(null)
  useEffect(()=>{let live=true;api.get('/auth/me').then(p=>{if(live)setProfile(p)}).catch(e=>{if(live)setError(e.message)});return()=>{live=false}},[])
  useEffect(()=>{let live=true;Promise.all([api.get<TodayAttendanceStatus>('/attendances/today-status'),assignedShift()]).then(([status,assigned])=>{if(live){setToday(status);setShift(assigned)}}).catch(e=>{if(live)setError(e.message)});return()=>{live=false}},[])
  const p=profile||user
  return <div className="page-container"><h1>Tài khoản</h1>{error&&<p role="alert">{error}</p>}<section className="card" style={{padding:24,marginBottom:24}}><div style={{display:'flex',gap:16,alignItems:'center',marginBottom:24}}><div className="user-avatar">{getInitials(p.full_name||p.username)}</div><div><h2>{p.full_name||p.username}</h2><span>{ROLE_LABELS[getRoleFromUser(p)]}</span></div></div><dl className="account-fields">{[['Mã nhân viên',p.employee_code],['Chức vụ',p.position_name],['Phòng ban',p.department_name],['Cửa hàng',p.store_name],['Email',p.email||p.company_email],['Điện thoại',p.phone]].map(([label,value])=><div key={label}><dt>{label}</dt><dd>{value||'Chưa cập nhật'}</dd></div>)}</dl>{p.employee_id && <Link className="btn btn-secondary" to="/my-payroll">{Icons.wallet} Phiếu lương của tôi</Link>}</section><section className="card" style={{padding:24,marginBottom:24}}><h2>Ca và giờ công hôm nay</h2><dl className="account-fields">{[['Ca phân công',shift?.shift_name],['Cửa hàng',shift?.store_name],['Khung giờ',shift?`${shift.start_time.slice(0,5)} – ${shift.end_time.slice(0,5)}`:null],['Trạng thái',today?.can_check_out?'Đã vào ca':today?.has_checked_out?'Đã ra ca':'Chưa vào ca'],['Check-in',today?.check_in_time?formatTime(today.check_in_time):null],['Check-out',today?.check_out_time?formatTime(today.check_out_time):null],['Giờ làm',today?.actual_work_hours===undefined?null:`${today.actual_work_hours} giờ`]].map(([label,value])=><div key={label}><dt>{label}</dt><dd>{value||'Chưa có'}</dd></div>)}</dl>{p.employee_id && <Link className="btn btn-secondary" to="/my-attendance">Xem bảng công cá nhân</Link>}</section>{p.employee_id && <PersonalSchedulesPage/>}</div>
}
