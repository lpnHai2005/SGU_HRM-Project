import { api } from './api'
type AssignedShift={schedule_id:number;shift_id:number;work_date:string;shift_name:string;start_time:string;end_time:string;store_name:string}
export async function assignedShift():Promise<AssignedShift|null> { return api.get<AssignedShift|null>('/mobile-attendance/assigned-shift') }
