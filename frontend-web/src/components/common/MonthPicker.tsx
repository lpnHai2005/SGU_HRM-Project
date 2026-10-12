import { useEffect, useId, useState } from 'react'
import { createPortal } from 'react-dom'
import { Icons } from './Icons'
export function MonthPicker({ value, onChange, label = 'Chọn tháng' }: {value:string;onChange:(value:string)=>void;label?:string}) {
  const [open,setOpen]=useState(false),[year,setYear]=useState(Number(value.slice(0,4)))
  const id=useId()
  useEffect(()=>{if(!open)return;const onEscape=(event:KeyboardEvent)=>{if(event.key==='Escape')setOpen(false)};document.addEventListener('keydown',onEscape);return()=>document.removeEventListener('keydown',onEscape)},[open])
  return <div className="month-picker"><label className="form-label" htmlFor={id}>{label}</label>
    <button id={id} className="form-input" type="button" aria-haspopup="dialog" aria-expanded={open} onClick={()=>{setYear(Number(value.slice(0,4)));setOpen(true)}}>{Icons.calendar} Tháng {Number(value.slice(5))}/{value.slice(0,4)}</button>
    {open&&createPortal(<div className="modal-overlay" onMouseDown={e=>{if(e.target===e.currentTarget)setOpen(false)}}><section className="modal month-picker-dialog" role="dialog" aria-modal="true" aria-label={label} onMouseDown={e=>e.stopPropagation()}>
      <header style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}><button className="btn btn-secondary" aria-label="Năm trước" onClick={()=>setYear(year-1)}>{Icons.chevronLeft}</button><strong>{year}</strong><button className="btn btn-secondary" aria-label="Năm sau" onClick={()=>setYear(year+1)}>{Icons.chevronRight}</button></header>
      <div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:8,margin:'16px 0'}}>{Array.from({length:12},(_,i)=>{const date=`${year}-${String(i+1).padStart(2,'0')}`;return <button autoFocus={date===value} key={date} className={`btn ${date===value?'btn-primary':'btn-secondary'}`} onClick={()=>{onChange(date);setOpen(false)}}>Tháng {i+1}</button>})}</div><button className="btn btn-secondary" onClick={()=>setOpen(false)}>Đóng</button>
    </section></div>,document.body)}
  </div>
}
