export type Profile = { full_name?: string; employee_code?: string; employee_id?: number; email?: string; phone?: string; username: string; department_name?: string; position_name?: string; store_name?: string; store_id?: number; roles?: string[]; permissions?: string[] };
export type Schedule = { schedule_id: number; shift_id: number; work_date: string; shift_name: string; start_time: string; end_time: string; store_name: string };
export const statusLabels: Record<string, string> = { NORMAL: 'Đúng giờ', LATE: 'Đi muộn', EARLY: 'Về sớm', LATE_AND_EARLY: 'Đi muộn và về sớm', OVERTIME: 'Giờ ngoài ca ghi nhận', NOT_CHECKED_IN: 'Chưa chấm công', WORKING: 'Đang làm việc', CHECKED_OUT: 'Đã kết thúc lượt' };
export const shortcuts = [
  { key: 'attendance', title: 'Chấm công', icon: "person-outline", href: '/(staff)/attendance' },
  { key: 'schedules', title: 'Lịch biểu', icon: "calendar-outline", href: '/(staff)/schedules' },
  { key: 'dashboard', title: 'Báo cáo KPI', icon: "bar-chart-outline", href: '/(staff)/dashboard' },
  { key: 'summary', title: 'Bảng công', icon: "bar-chart-outline", href: '/(staff)/summary' },
  { key: 'requests', title: 'Đơn từ', icon: "document-text-outline", href: '/(staff)/requests' },
] as const;

