export type Profile = { full_name?: string; employee_code?: string; employee_id?: number; email?: string; phone?: string; username: string; department_name?: string; position_name?: string; store_name?: string; store_id?: number; roles?: string[]; permissions?: string[] };
export type Schedule = { schedule_id: number; shift_id: number; work_date: string; shift_name: string; start_time: string; end_time: string; store_name: string };
export const statusLabels: Record<string, string> = { NORMAL: 'Đúng giờ', LATE: 'Đi muộn', EARLY: 'Về sớm', LATE_AND_EARLY: 'Đi muộn và về sớm', OVERTIME: 'Làm thêm', NOT_CHECKED_IN: 'Chưa chấm công', WORKING: 'Đang làm việc', CHECKED_OUT: 'Đã kết thúc lượt' };
export const shortcuts = [
  { key: 'attendance', title: 'Chấm công', icon: '◉', href: '/(staff)/attendance' },
  { key: 'schedules', title: 'Lịch biểu', icon: '▦', href: '/(staff)/schedules' },
  { key: 'summary', title: 'Bảng công', icon: '▥', href: '/(staff)/summary' },
  { key: 'requests', title: 'Đơn từ', icon: '▤', href: '/(staff)/requests' },
] as const;
