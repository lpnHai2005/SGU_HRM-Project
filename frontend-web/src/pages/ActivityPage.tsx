import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { api } from '../services/api'
import { DatePicker } from '../components/common/DatePicker'
import './ActivityPage.css'

export const operationToday = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' })
export const attendanceLabels: Record<string,string> = { NORMAL:'Đúng giờ',LATE:'Đi muộn',EARLY:'Về sớm',LATE_AND_EARLY:'Đi muộn & về sớm',OVERTIME:'Làm thêm',ANNUAL_LEAVE:'Nghỉ phép',UNPAID_LEAVE:'Nghỉ không lương',SICK_LEAVE:'Nghỉ ốm',MATERNITY_LEAVE:'Nghỉ thai sản' }
export const scheduleLabels: Record<string,string> = { MATCHED:'Khớp lịch',UNSCHEDULED:'Không có lịch',SHIFT_MISMATCH:'Khác lịch',LEGACY_UNKNOWN:'Chưa có snapshot' }
type Person = {employee_id:number;employee_name:string;department_name:string;store_name:string;sessions:any[]}
export type ActivityData = {summary:Record<string,number>;employees:Person[]}
export function ActivityPage({ user, personal=false }: {user:any;personal?:boolean}) {
 const [search]=useSearchParams()
 const [day,setDay]=useState(operationToday)
 const [filters,setFilters]=useState({employee_id:'',department_id:'',store_id:''})
 const [applied,setApplied]=useState({day,...filters})
 const [group,setGroup]=useState('auto')
 const [kind,setKind]=useState(search.get('kind')||'all')
 const [data,setData]=useState<ActivityData|null>(null)
 const [options,setOptions]=useState<any>({employees:[],departments:[],stores:[]})
 const [error,setError]=useState('')
 const manager=user?.roles?.some((r:string)=>['ADMIN','HR_MANAGER','STORE_MANAGER'].includes(r)) && !personal
 const storeOnly=user?.roles?.includes('STORE_MANAGER')&&!user.roles.some((r:string)=>['ADMIN','HR_MANAGER'].includes(r))
 useEffect(()=>{let active=true;api.get('/operations/filter-options').then(v=>{if(active)setOptions(v)}).catch(e=>{if(active)setError(e.message)});return()=>{active=false}},[])
 useEffect(()=>{let active=true;setData(null);const params=Object.fromEntries(Object.entries({...applied,personal:!manager}).filter(([,v])=>v!==''));api.get<ActivityData>('/operations/activity',params).then(v=>{if(active){setData(v);setError('')}}).catch(e=>{if(active)setError(e.message)});return()=>{active=false}},[applied,manager])
 const grouped=useMemo(()=>{
  const result:Record<string,Person[]>={}
  const mode=group==='auto'?(applied.employee_id?'none':(applied.store_id||storeOnly)?(applied.department_id?'employee':'department'):'store'):group
  for(const person of data?.employees||[]){
   if(kind==='working'&&!person.sessions.some(s=>s.check_in_time&&!s.check_out_time))continue
   if(kind==='late'&&!person.sessions.some(s=>Number(s.late_minutes)>15))continue
   if(!['all','working','late'].includes(kind)&&!person.sessions.some(s=>s.status===kind))continue
   const key=mode==='none'?'Danh sách':mode==='employee'?person.employee_name:mode==='department'?(person.department_name||'Chưa có phòng ban'):
    `${person.store_name||'Chưa có cửa hàng'}${group==='auto'&&!applied.department_id?' / '+(person.department_name||'Chưa có phòng ban'):''}`
   ;(result[key]??=[]).push(person)
  }return result
 },[data,kind,group,applied,storeOnly])
 const summaryLabels:Record<string,string>={total:'Tổng nhân viên',checked_in:'Đã chấm công',working:'Đang làm việc',finished:'Đã kết thúc',not_checked_in:'Chưa chấm công',late:'Đi muộn',early:'Về sớm',overtime:'OT'}
 return <div className="page-container operations-page"><h1>Nhật ký làm việc & Hoạt động</h1>
  <div className="card operations-filters">
   <DatePicker value={day} onChange={setDay} label="Ngày tham chiếu"/>
   {manager&&(['employee_id','department_id','store_id'] as const).map((key,i)=><label key={key}>{['Nhân viên','Phòng ban','Cửa hàng'][i]}<select className="form-select" value={storeOnly&&key==='store_id'?String(user.store_id):filters[key]} disabled={storeOnly&&key==='store_id'} onChange={e=>setFilters({...filters,[key]:e.target.value})}><option value="">Tất cả</option>{(i===0?options.employees:i===1?options.departments:options.stores).map((v:any)=><option key={v.id||v.employee_id} value={v.id||v.employee_id}>{v.name||v.full_name}</option>)}</select></label>)}
   <button className="btn btn-primary" onClick={()=>setApplied({day,...filters})}>Lọc</button>
   <button className="btn btn-secondary" onClick={()=>{const empty={employee_id:'',department_id:'',store_id:''};setDay(operationToday());setFilters(empty);setApplied({day:operationToday(),...empty});setGroup('auto');setKind('all')}}>Đặt lại</button>
  </div>
  {error&&<p role="alert">{error}</p>}
  <div className="stat-grid-4">{Object.entries(summaryLabels).map(([key,label])=><div className="card" style={{padding:16}} key={key}><span>{label}</span><h2>{data?.summary[key]??'—'}</h2></div>)}</div>
  <div className="operations-toolbar"><label>Nhóm theo <select className="form-select" value={group} onChange={e=>setGroup(e.target.value)}>{Object.entries({auto:'Tự động',store:'Cửa hàng',department:'Phòng ban',employee:'Nhân viên',none:'Không nhóm'}).map(([v,l])=><option key={v} value={v}>{l}</option>)}</select></label>
   <label>Trạng thái <select className="form-select" value={kind} onChange={e=>setKind(e.target.value)}>{Object.entries({all:'Tất cả',working:'Đang làm',late:'Đi muộn (số phút)',...attendanceLabels}).map(([v,l])=><option key={v} value={v}>{l}</option>)}</select></label></div>
  {!data&&!error&&<p>Đang tải…</p>}
  {data&&!Object.keys(grouped).length&&<p>Không có dữ liệu phù hợp.</p>}
  {Object.entries(grouped).map(([name,people])=><section className="card" style={{padding:20,marginBottom:16}} key={name}><h3>{name}</h3>{people.map(person=><details key={person.employee_id} open={!!applied.employee_id}><summary style={{padding:12,cursor:'pointer'}}><strong>{person.employee_name}</strong> · {person.department_name} · {person.sessions.length} phiên {person.sessions.length?'':'— Chưa chấm công'}</summary><div className="table-container"><table className="data-table"><thead><tr>{['Ca / Cửa hàng','Vào','Ra','Giờ làm','Trễ (phút)','Sớm (phút)','OT (giờ)','Trạng thái','Đối chiếu lịch'].map(t=><th key={t}>{t}</th>)}</tr></thead><tbody>{person.sessions.map(s=><tr key={s.attendance_id}><td>{s.shift_name}<br/>{s.attendance_store_name}</td><td>{s.check_in_time?new Date(s.check_in_time).toLocaleTimeString('vi-VN',{timeZone:'Asia/Ho_Chi_Minh'}):'—'}</td><td>{s.check_out_time?new Date(s.check_out_time).toLocaleTimeString('vi-VN',{timeZone:'Asia/Ho_Chi_Minh'}):'—'}</td><td>{s.actual_work_hours}</td><td>{s.late_minutes}</td><td>{s.early_minutes}</td><td>{s.overtime_hours}</td><td>{attendanceLabels[s.status]||s.status}</td><td>{scheduleLabels[s.schedule_status]||s.schedule_status}</td></tr>)}</tbody></table></div></details>)}</section>)}
 </div>
}
