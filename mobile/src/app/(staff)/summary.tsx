import { useCallback, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { Redirect, useFocusEffect } from 'expo-router';
import { useSession } from '@/contexts/session';
import { Button, Card, Input, Label, styles, usePalette } from '@/components/attendance-ui';
import { LoadingBar } from '@/components/loading-bar';
import { ApiError, request, vietnamPeriod } from '@/services/attendance';

type Summary = {
  employee_name: string; working_days: { actual_days: number; standard_days: number; total_hours: number };
  leave_quota: { annual_leave: number; used_leave: number; remaining_leave: number };
  late_arrivals: { count: number; minutes: number }; early_departures: { count: number; minutes: number };
  overtime: { shifts_count: number; hours: number }; extra_work: { hours?: number };
  business_trips: { days?: number }; compensatory_leave: { total?: number };
};
export default function SummaryScreen() {
  const { token, ready, signOut } = useSession();
  const p = usePalette();
  const [period, setPeriod] = useState(vietnamPeriod);
  const [query, setQuery] = useState(() => ({ period: vietnamPeriod() }));
  const [data, setData] = useState<Summary | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useFocusEffect(useCallback(() => {
    if (!token) return;
    let active = true;
    setBusy(true); setError(''); setData(null);
    request<Summary>(`/attendances/my-summary?period=${query.period}`, token).then(value => { if (active) setData(value); }).catch(e => {
      if (active) setError(e instanceof Error ? e.message : 'Không tải được bảng công.');
      if (e instanceof ApiError && e.status === 401) void signOut();
    }).finally(() => { if (active) setBusy(false); });
    return () => { active = false; };
  }, [token, query, signOut]));
  if (ready && !token) return <Redirect href="/" />;
  const metrics = data ? [
    ['Ngày công', `${data.working_days.actual_days} / ${data.working_days.standard_days}`, `${data.working_days.total_hours} giờ thực tế`],
    ['Quỹ phép', `${data.leave_quota.remaining_leave} ngày còn lại`, `${data.leave_quota.used_leave} đã dùng / ${data.leave_quota.annual_leave} ngày năm`],
    ['Đi muộn', `${data.late_arrivals.count} lần`, `${data.late_arrivals.minutes} phút`],
    ['Về sớm', `${data.early_departures.count} lần`, `${data.early_departures.minutes} phút`],
    ['Tăng ca', `${data.overtime.hours} giờ`, `${data.overtime.shifts_count} lượt`],
    ['Làm thêm', `${data.extra_work.hours ?? 0} giờ`, 'Theo dữ liệu máy chủ'],
    ['Công tác', `${data.business_trips.days ?? 0} ngày`, 'Theo dữ liệu máy chủ'],
    ['Nghỉ bù', `${data.compensatory_leave.total ?? 0} ngày`, 'Theo dữ liệu máy chủ'],
  ] : [];
  return <ScrollView style={{ backgroundColor: p.bg }} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
    <Label large>Bảng công cá nhân</Label><Label muted>{data?.employee_name || 'TechZone'} · {query.period}</Label>
    <Input accessibilityLabel="Tháng YYYY-MM" value={period} onChangeText={setPeriod} placeholder="YYYY-MM" maxLength={7} />
    <Button title="Xem bảng công" disabled={busy} onPress={() => { if (/^\d{4}-(0[1-9]|1[0-2])$/.test(period)) setQuery({ period }); else setError('Nhập tháng dạng YYYY-MM.'); }} />
    <LoadingBar active={busy} />{!!error && <Text accessibilityRole="alert" style={{ color: p.danger }}>{error}</Text>}
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}>{metrics.map(([title, value, note]) => <View key={title} style={{ flexBasis: '46%', flexGrow: 1 }}><Card><Label muted>{title}</Label><Label>{value}</Label><Label muted>{note}</Label></Card></View>)}</View>
    <Card><Label>Quy định chấm công</Label><Label muted>Đi muộn khi quá giờ bắt đầu ca 15 phút. Chưa phân ca hoặc khác lịch vẫn ghi nhận để đối soát. Mỗi lượt tối thiểu 60 giây; chờ 60 giây sau check-out trước lượt tiếp.</Label><Label muted>Giờ công, muộn, sớm và OT tính từ bản chụp ca lúc check-in. Trạng thái không thay thế các số liệu này. Quyết toán lương và duyệt OT theo nghiệp vụ của công ty.</Label></Card>
  </ScrollView>;
}
