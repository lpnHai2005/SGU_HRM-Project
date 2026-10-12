import { useState } from 'react';
import { Modal, Pressable, ScrollView, View } from 'react-native';
import { AppIcon } from './app-icon';
import { Button, Label, usePalette } from './attendance-ui';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { ReactNode } from 'react';

export function FilterPanel({children}:{children:ReactNode}) {
 const p=usePalette(); const [open,setOpen]=useState(false);
 return <View style={{gap:12}}><Pressable accessibilityRole="button" accessibilityLabel="Bộ lọc nâng cao" accessibilityState={{expanded:open}} onPress={()=>setOpen(!open)} style={{flexDirection:'row',alignItems:'center',gap:10,paddingVertical:8}}><AppIcon name="options-outline" color={p.brand} size={20}/><Label style={{flex:1}}>Bộ lọc nâng cao</Label><AppIcon name={open?'chevron-up':'chevron-down'} color={p.muted} size={18}/></Pressable>{open&&<View style={{gap:12}}>{children}</View>}</View>;
}

export const operationToday = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' });
export const isoDate = (d: Date) => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
export function Choice({label,value,options,onChange,disabled=false}:{label:string;value:string;options:{value:string;label:string}[];onChange:(v:string)=>void;disabled?:boolean}) {
 const p=usePalette(); const insets=useSafeAreaInsets(); const [open,setOpen]=useState(false);
 return <View style={{gap:4}}><Label muted>{label}</Label><Pressable accessibilityRole="button" disabled={disabled} onPress={()=>setOpen(true)} style={{padding:12,borderWidth:1,borderColor:p.line,minHeight:48,borderRadius:12,flexDirection:'row',justifyContent:'space-between',alignItems:'center'}}><Label style={{flex:1,minWidth:0,marginRight:12}}>{options.find(o=>o.value===value)?.label||'Tất cả'}</Label><AppIcon name={disabled?'lock-closed-outline':'chevron-down'} size={18} color={p.muted}/></Pressable><Modal visible={open} transparent animationType="slide" onRequestClose={()=>setOpen(false)}><View style={{flex:1,justifyContent:'flex-end',backgroundColor:'#0008'}}><View style={{backgroundColor:p.card,padding:20,paddingBottom:Math.max(20,insets.bottom+12),borderTopLeftRadius:24,borderTopRightRadius:24,maxHeight:'75%',gap:12}}><Label variant="title">{label}</Label><ScrollView>{options.map(o=><Pressable key={o.value} accessibilityRole="button" onPress={()=>{onChange(o.value);setOpen(false)}} style={{padding:16,backgroundColor:o.value===value?p.brandLight:p.card,borderRadius:12}}><Label>{o.label}</Label></Pressable>)}</ScrollView><Button title="Đóng" secondary onPress={()=>setOpen(false)}/></View></View></Modal></View>;
}
export function DayPicker({value,onChange}:{value:string;onChange:(v:string)=>void}) {
 const p=usePalette();const [open,setOpen]=useState(false);const [month,setMonth]=useState(value.slice(0,7));
 const first=new Date(`${month}-01T12:00:00`);const offset=(first.getDay()+6)%7;
 const move=(step:number)=>setMonth(isoDate(new Date(first.getFullYear(),first.getMonth()+step,1)).slice(0,7));
 return <View style={{gap:4}}><Label muted>Ngày tham chiếu</Label><Button title={value.split('-').reverse().join('/')} secondary onPress={()=>{setMonth(value.slice(0,7));setOpen(true)}}/><Modal visible={open} transparent animationType="fade" onRequestClose={()=>setOpen(false)}><View style={{flex:1,justifyContent:'center',padding:20,backgroundColor:'#0008'}}><View style={{backgroundColor:p.card,padding:16,borderRadius:20,gap:12}}><View style={{flexDirection:'row',justifyContent:'space-between',alignItems:'center'}}><Button title="Trước" secondary onPress={()=>move(-1)}/><Label>{month.split('-').reverse().join('/')}</Label><Button title="Sau" secondary onPress={()=>move(1)}/></View><View style={{flexDirection:'row'}}>{['T2','T3','T4','T5','T6','T7','CN'].map(d=><View key={d} style={{width:'14.28%',alignItems:'center'}}><Label muted>{d}</Label></View>)}</View><View style={{flexDirection:'row',flexWrap:'wrap'}}>{Array.from({length:42},(_,i)=>{const d=new Date(first.getFullYear(),first.getMonth(),i-offset+1);const iso=isoDate(d);return <Pressable key={iso} accessibilityRole="button" accessibilityLabel={iso.split('-').reverse().join('/')} onPress={()=>{onChange(iso);setOpen(false)}} style={{width:'14.28%',height:42,alignItems:'center',justifyContent:'center',borderRadius:10,backgroundColor:iso===value?p.brandLight:'transparent',opacity:d.getMonth()===first.getMonth()?1:0.4}}><Label>{d.getDate()}</Label></Pressable>})}</View><Button title="Đóng" secondary onPress={()=>setOpen(false)}/></View></View></Modal></View>;
}
export type OperationFilters={employee_id:string;department_id:string;store_id:string;position_id:string};
export const emptyFilters:OperationFilters={employee_id:'',department_id:'',store_id:'',position_id:''};
export const queryString=(values:Record<string,string|boolean>)=>Object.entries(values).filter(([,v])=>v!=='').map(([k,v])=>`${k}=${encodeURIComponent(String(v))}`).join('&');
export function WorkforceFilters({value,onChange,options,storeOnly=false,storeId,showPosition=false}:{value:OperationFilters;onChange:(v:OperationFilters)=>void;options:any;storeOnly?:boolean;storeId?:number;showPosition?:boolean}) {
 return <>{(['employee_id','department_id','store_id'] as const).map((key,i)=><Choice key={key} label={['Nhân viên','Phòng ban','Cửa hàng'][i]} value={storeOnly&&key==='store_id'?String(storeId):value[key]} disabled={storeOnly&&key==='store_id'} onChange={v=>onChange({...value,[key]:v})} options={[{value:'',label:'Tất cả'},...((i===0?options?.employees:i===1?options?.departments:options?.stores)||[]).map((o:any)=>({value:String(o.id||o.employee_id),label:o.name||o.full_name}))]}/>)}{showPosition&&<Choice label="Chức vụ" value={value.position_id} onChange={position_id=>onChange({...value,position_id})} options={[{value:'',label:'Tất cả'},...(options?.positions||[]).map((o:any)=>({value:String(o.id),label:o.name}))]}/>}</>;
}
