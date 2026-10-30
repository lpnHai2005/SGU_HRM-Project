import { useEffect, useState } from 'react'
import { api } from '../services/api'
import { MonthPicker } from '../components/common/MonthPicker'
import { attendanceLabels, scheduleLabels, operationToday } from './ActivityPage'
import { Icons } from '../components/common/Icons'
import { formatDate, formatTime } from '../utils/formatters'
import { MonthlyVerifiedOvertimePanel } from './MonthlyVerifiedOvertimePanel'
import './MonthlyAttendancePage.css'

export function MonthlyAttendancePage({user}:{user:any}) {
  const [period,setPeriod]=useState(()=>operationToday().slice(0,7))
  const [filters,setFilters]=useState({employee_id:'',department_id:'',store_id:'',status:''})
  const [options,setOptions]=useState<any>({employees:[],departments:[],stores:[]})
  const [rows,setRows]=useState<any[]>([]),[error,setError]=useState(''),[loading,setLoading]=useState(true)
  const branch=user.roles.includes('STORE_MANAGER')&&!user.roles.some((r:string)=>['ADMIN','HR_MANAGER','DIRECTOR'].includes(r))
  useEffect(()=>{api.get('/operations/filter-options').then(setOptions).catch(e=>setError(e.message))},[])
  useEffect(()=>{let active=true;setLoading(true)
    api.get<any>('/operations/monthly-attendance',Object.fromEntries(Object.entries({period,...filters}).filter(([,v])=>v!=='')))
      .then(data=>{if(active){setRows(data.employees);setError('')}})
      .catch(e=>{if(active)setError(e.message)})
      .finally(()=>{if(active)setLoading(false)})
    return()=>{active=false}
  },[period,filters])
  const exportCsv=()=>{
    const headings=['Nhân viên','Cửa hàng','Phòng ban','Giờ phân ca','Giờ thực tế','Phút trễ','Phút về sớm','Giờ ngoài ca ghi nhận','Ngày công','Ngày phép']
    const values=rows.map(p=>[p.employee_name,p.store_name,p.department_name,p.scheduled_hours,p.actual_work_hours,p.late_minutes,p.early_minutes,p.overtime_hours,p.working_days,p.leave_days??'Đơn giao tháng'])
    const cell=(v:any)=>'"'+String(v??'').replace(/^[=+@-]/,"'$&").replaceAll('"','""')+'"'
    const url=URL.createObjectURL(new Blob(['\ufeff'+[headings,...values].map(r=>r.map(cell).join(',')).join('\r\n')],{type:'text/csv;charset=utf-8'}))
    const a=document.createElement('a');a.href=url;a.download=`Bang-cong-${period}.csv`;a.click();URL.revokeObjectURL(url)
  }
  return <div className="page-container"><h1>Quản lý công</h1><p>Tổng hợp tháng từ backend. Giờ ngoài ca ghi nhận cần có quyết định HR riêng mới được đưa vào tính lương.</p>
    <section className="card activity-filters">
      <MonthPicker value={period} onChange={setPeriod}/>
      {(['employee_id','department_id','store_id'] as const).map((key,i)=><label key={key}><span className="form-label">{['Nhân viên','Phòng ban','Cửa hàng'][i]}</span><select className="form-select" disabled={key==='store_id'&&branch} value={key==='store_id'&&branch?user.store_id:filters[key]} onChange={e=>setFilters({...filters,[key]:e.target.value})}><option value="">Tất cả</option>{(options[['employees','departments','stores'][i]]||[]).map((o:any)=><option key={o.id||o.employee_id} value={o.id||o.employee_id}>{o.name||o.full_name}</option>)}</select></label>)}
      <label><span className="form-label">Trạng thái phiên</span><select className="form-select" value={filters.status} onChange={e=>setFilters({...filters,status:e.target.value})}><option value="">Tất cả</option>{Object.entries(attendanceLabels).map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></label>
      <button className="btn btn-secondary" onClick={exportCsv} disabled={loading||!!error}>{Icons.download} Xuất CSV</button>
    </section>
    {error&&<p role="alert">{error}</p>}{loading?<p>Đang tải bảng công…</p>:<section className="card table-container"><table className="data-table"><thead><tr>{['Nhân viên / Phiên','Giờ phân ca','Giờ thực tế','Trễ (phút)','Sớm (phút)','OT thực tế','Ngày công','Phép','Trạng thái phiên'].map(h=><th key={h}>{h}</th>)}</tr></thead><tbody>{rows.map(p=><tr key={p.employee_id}><td><details><summary><strong>{p.employee_name}</strong><div>{p.store_name} · {p.department_name}</div></summary>{p.sessions.map((s:any)=><article key={s.attendance_id} style={{padding:'12px 0',minWidth:250}}><strong>{formatDate(s.work_date)} · {s.attendance_context?.actual?.shift_name||s.shift_name}</strong><div>{formatTime(s.check_in_time)} → {s.check_out_time?formatTime(s.check_out_time):'Chưa ra'}</div><div>{s.actual_work_hours} giờ · Trễ {s.late_minutes} phút · Sớm {s.early_minutes} phút · Ngoài ca ghi nhận {s.overtime_hours} giờ</div><div>{attendanceLabels[s.status]||s.status} · {scheduleLabels[s.schedule_status]||'Chưa đối chiếu'}</div></article>)}</details></td><td>{p.scheduled_hours.toFixed(2)}</td><td>{p.actual_work_hours.toFixed(2)}</td><td>{p.late_minutes}</td><td>{p.early_minutes}</td><td>{p.overtime_hours.toFixed(2)}</td><td>{p.working_days}</td><td>{p.leave_days??'Có đơn giao tháng – đối chiếu đơn'}</td><td>{p.statuses.map((s:string)=>attendanceLabels[s]||s).join(', ')||'Chưa chấm công'}</td></tr>)}</tbody></table>{!rows.length&&<p style={{padding:20}}>Không có dữ liệu phù hợp.</p>}</section>}
    <div style={{ marginTop: 24 }}>
      <MonthlyVerifiedOvertimePanel
        period={period}
        storeId={filters.store_id}
        employeeId={filters.employee_id}
        user={user}
        attendanceSessions={rows.flatMap((p: any) =>
          (p.sessions || []).map((s: any) => ({
            ...s,
            employee_name: p.employee_name,
            employee_code: p.employee_code,
            store_name: p.store_name,
            department_name: p.department_name,
          }))
        )}
      />
    </div>
  </div>
}
