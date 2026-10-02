import { useState } from 'react';
import { Modal, Pressable, ScrollView, Text, View } from 'react-native';
import { router, type Href } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button, Card, Label, styles, usePalette } from '@/components/attendance-ui';
import { LoadingBar } from '@/components/loading-bar';
import { useResource } from '@/hooks/use-resource';
import { useSession } from '@/contexts/session';
import { usePreferences } from '@/contexts/preferences';
import { shortcuts, type Profile, type Schedule } from '@/services/staff';
import { displayTime, vietnamPeriod, type Today } from '@/services/attendance';

export default function Home() {
  const p = usePalette(); const insets = useSafeAreaInsets(); const { signOut } = useSession(); const { prefs } = usePreferences();
  const profile = useResource<Profile>('/auth/me'); const today = useResource<Today>('/attendances/today-status');
  const schedules = useResource<Schedule[]>(`/mobile-attendance/my-schedules?period=${vietnamPeriod()}`);
  const [drawer, setDrawer] = useState(false); const [error, setError] = useState('');
  const date = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' });
  const todaysSchedules = schedules.data?.filter(s => s.work_date === date) || [];
  const initials = profile.data?.full_name?.split(' ').slice(-2).map(v => v[0]).join('') || 'TZ';
  const menu: [string, Href][] = [['Thông tin cá nhân', '/(staff)/account'], ['Hoạt động', '/(staff)/activity'], ['Cấu hình truy cập nhanh', '/(staff)/settings?section=shortcuts'], ['Cấu hình', '/(staff)/settings'], ['Nhật ký phiên chấm công', '/(staff)/activity'], ['Đổi mật khẩu', '/(staff)/password']];
  function navigate(href: Href) { setDrawer(false); router.push(href); }
  return <View style={{ flex: 1, backgroundColor: p.bg }}>
    <ScrollView contentContainerStyle={[styles.content, { paddingTop: insets.top + 16 }]}>
      <View style={[styles.row, { marginBottom: 8 }]}>
        <Pressable accessibilityRole="button" accessibilityLabel="Mở menu nhân viên" onPress={() => setDrawer(true)} style={{ width: 60, height: 60, borderRadius: 30, backgroundColor: p.accent, alignItems: 'center', justifyContent: 'center' }}><Text style={{ color: p.card, fontFamily: 'BeVietnamBold', fontSize: 20 }}>{initials}</Text></Pressable>
        <View style={{ flex: 1 }}><Label muted>Xin chào,</Label><Label large>{profile.data?.full_name || 'Nhân viên TechZone'}</Label><Label muted>{profile.data?.store_name || 'TechZone HRM'}</Label></View>
      </View>
      <Label muted>{new Date().toLocaleDateString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</Label>
      <LoadingBar active={profile.loading || today.loading || schedules.loading} label="Đang đồng bộ trang chủ…" />
      {!!(profile.error || today.error || schedules.error || error) && <Card><Text style={{ color: p.danger }}>{profile.error || today.error || schedules.error || error}</Text><Button title="Thử tải lại" secondary onPress={() => { profile.reload(); today.reload(); schedules.reload(); }} /></Card>}
      <Card><Label muted>CA LÀM VIỆC HÔM NAY</Label>
        {today.data?.can_check_out ? <><Label large>Đang làm việc</Label><Label>Vào lúc {displayTime(today.data.check_in_time)}</Label></> : todaysSchedules.length ? todaysSchedules.map(s => <View key={s.schedule_id}><Label>{s.shift_name}</Label><Label muted>{s.start_time.slice(0,5)}–{s.end_time.slice(0,5)} · {s.store_name}</Label></View>) : !schedules.loading && !schedules.error ? <><Label>Hôm nay chưa được phân ca</Label><Label muted>Bạn vẫn có thể chọn ca thực tế và chấm công để đối soát.</Label></> : <Label muted>Đang xác định lịch làm việc…</Label>}
        <Button title={today.data?.can_check_out ? 'Tiếp tục / Check-out' : 'Bắt đầu chấm công'} onPress={() => router.push('/(staff)/attendance')} />
      </Card>
      <View style={[styles.row, { justifyContent: 'space-between' }]}><Label>Lịch biểu</Label><Pressable accessibilityRole="button" onPress={() => router.push('/(staff)/schedules')}><Label muted>Chi tiết →</Label></Pressable></View>
      <Card><Label>Tháng {vietnamPeriod().slice(5)} / {vietnamPeriod().slice(0,4)}</Label><View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
        {Array.from({ length: 7 }, (_, i) => {
          const d = new Date(`${date}T12:00:00+07:00`); d.setUTCDate(d.getUTCDate() + i - 3);
          const key = d.toLocaleDateString('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' }); const selected = key === date;
          return <Pressable key={key} accessibilityRole="button" accessibilityLabel={`Xem lịch ${key}`} onPress={() => router.push('/(staff)/schedules')} style={{ alignItems: 'center', gap: 8, paddingVertical: 8, paddingHorizontal: 5, borderRadius: 20, backgroundColor: selected ? p.accent : p.card }}>
            <Text style={{ color: selected ? p.card : p.muted, fontSize: 11 }}>{d.toLocaleDateString('vi-VN', { weekday: 'short', timeZone: 'Asia/Ho_Chi_Minh' })}</Text><Text style={{ color: selected ? p.card : p.text, fontFamily: 'BeVietnamBold' }}>{key.slice(-2)}</Text>
          </Pressable>;
        })}
      </View></Card>
      <Label>Tiện ích</Label><Card><View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}>
        {shortcuts.filter(item => prefs.shortcuts.includes(item.key)).map(item => <Pressable key={item.key} accessibilityRole="button" onPress={() => router.push(item.href)} style={{ flexBasis: '20%', flexGrow: 1, paddingVertical: 12, paddingHorizontal: 2, gap: 8, alignItems: 'center', borderRadius: 12, backgroundColor: p.bg }}><Text style={{ color: p.accent, fontSize: 27 }}>{item.icon}</Text><Text style={{ color: p.text, fontFamily: 'BeVietnam', fontSize: 12, textAlign: 'center' }}>{item.title}</Text></Pressable>)}
      </View><Button title="Tùy chỉnh tiện ích" secondary onPress={() => router.push('/(staff)/settings?section=shortcuts')} /></Card>
    </ScrollView>
    <Modal visible={drawer} transparent animationType="fade" onRequestClose={() => setDrawer(false)}>
      <View style={{ flex: 1, flexDirection: 'row', backgroundColor: '#0008' }}>
        <ScrollView accessibilityViewIsModal style={{ width: '82%', flexGrow: 0, flexShrink: 0, maxWidth: 360, backgroundColor: p.card }} contentContainerStyle={{ padding: 22, paddingTop: insets.top + 24, gap: 16 }}>
          <Label large>{profile.data?.full_name || 'TechZone'}</Label><Label muted>{profile.data?.employee_code || profile.data?.username}</Label>
          {menu.map(([title, href]) => <Pressable key={title} accessibilityRole="button" onPress={() => navigate(href)} style={{ borderBottomWidth: 1, borderBottomColor: p.line, paddingVertical: 14 }}><Label>{title} ›</Label></Pressable>)}
          <Button title="Đăng xuất" secondary onPress={() => { setDrawer(false); void signOut().catch(e => setError(e.message)); }} /><Label muted>TechZone HRM · Phiên bản 1.0.0</Label><Button title="Đóng menu" secondary onPress={() => setDrawer(false)} />
        </ScrollView><Pressable accessibilityLabel="Đóng menu" accessibilityRole="button" onPress={() => setDrawer(false)} style={{ flex: 1 }} />
      </View>
    </Modal>
  </View>;
}
