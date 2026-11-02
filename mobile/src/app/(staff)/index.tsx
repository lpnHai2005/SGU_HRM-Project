import { AttendanceAction } from '@/components/attendance-action';
import { AppIcon, AppText as Text, type AppIconName } from '@/components/app-icon';
import { useCallback, useState, useEffect, type ReactNode } from 'react';
import { Modal, Pressable, RefreshControl, ScrollView, View } from 'react-native';
import { router, useFocusEffect, type Href } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button, Card, styles, usePalette, Badge, ProgressBar, MetricBox } from '@/components/attendance-ui';
import { LoadingBar } from '@/components/loading-bar';
import { useResource } from '@/hooks/use-resource';
import { useSession } from '@/contexts/session';
import { usePreferences } from '@/contexts/preferences';
import { shortcuts, statusLabels, type Profile, type Schedule } from '@/services/staff';
import { assignedShift, shiftProgress, storeLabel } from '@/services/presentation';
import { clockTime, vietnamPeriod, type Today } from '@/services/attendance';
import { type EmployeeSummaryData, type ManagerDashboardKpis } from '@/services/dashboard';
import { useNotifications } from '@/contexts/notifications';

const TZ = 'Asia/Ho_Chi_Minh';

export default function Home() {
  const p = usePalette();
  const insets = useSafeAreaInsets();
  const { signOut } = useSession();
  const { prefs } = usePreferences();
  const currentPeriod = vietnamPeriod();
  const profile = useResource<Profile>('/auth/me', 30000);
  const today = useResource<Today>('/attendances/today-status', 30000);
  const schedules = useResource<Schedule[]>(`/mobile-attendance/my-schedules?period=${currentPeriod}`, 30000);

  const userRoles = profile.data?.roles || [];
  const isStoreManager = userRoles.includes('STORE_MANAGER');
  const isManager = isStoreManager || ['HR_MANAGER', 'DIRECTOR', 'ADMIN'].some(r => userRoles.includes(r));
  const canSeeReports = ['HR_MANAGER', 'DIRECTOR'].some(r => userRoles.includes(r));

  const summary = useResource<EmployeeSummaryData>(`/attendances/my-summary?period=${currentPeriod}`, 30000);
  const managerStats = useResource<ManagerDashboardKpis>(canSeeReports ? '/reports/dashboard-kpis' : null, 30000);

  const { notifications, unreadCount, setCenterOpen, dispatchNotification } = useNotifications();

  // Auto-alert manager for pending leave requests requiring approval without re-pushing read/existing alerts
  useEffect(() => {
    if (isManager && managerStats.data?.pending_leaves && managerStats.data.pending_leaves > 0) {
      const count = managerStats.data.pending_leaves;
      const batchKey = `pending-leaves-batch-${count}`;
      const alreadyHandled = notifications.some(
        n => n.data?.batchKey === batchKey || (n.data?.pendingCount === count && n.read)
      );
      if (!alreadyHandled) {
        void dispatchNotification({
          type: 'leave_approval',
          title: 'Đơn nghỉ phép chờ duyệt',
          body: `Có ${count} đơn nghỉ phép đang chờ bạn phê duyệt. Chạm để xem và duyệt nhanh.`,
          actionUrl: '/(staff)/requests',
          data: { batchKey, pendingCount: count },
        });
      }
    }
  }, [isManager, managerStats.data?.pending_leaves, notifications, dispatchNotification]);

  const [drawer, setDrawer] = useState(false);
  const [error, setError] = useState('');
  const [clock, setClock] = useState(Date.now);
  useFocusEffect(useCallback(() => { const tick = setInterval(() => setClock(Date.now()), 30000); return () => clearInterval(tick); }, []));

  const date = new Date().toLocaleDateString('en-CA', { timeZone: TZ });
  const initials = profile.data?.full_name?.split(' ').slice(-2).map(v => v[0]).join('') || 'TZ';

  const operations: [AppIconName, string, Href][] = [
    ['calendar-outline', 'Lịch ca & Phân công', '/(staff)/schedules'],
    ['analytics-outline', 'Nhật ký làm việc & Hoạt động', '/(staff)/activity'],
    ['clipboard-outline', 'Bảng công cá nhân', '/(staff)/summary'],
    ['document-text-outline', 'Quản lý nghỉ phép & Đơn từ', '/(staff)/requests'],
    ['bar-chart-outline', 'Báo cáo tổng hợp & KPI', '/(staff)/dashboard'],
  ];
  const account: [AppIconName, string, Href][] = [
    ['person-outline', 'Thông tin cá nhân', '/(staff)/account'],
    ['settings-outline', 'Cấu hình ứng dụng', '/(staff)/settings'],
    ['lock-closed-outline', 'Đổi mật khẩu', '/(staff)/password'],
  ];

  function navigate(href: Href) {
    setDrawer(false);
    router.push(href);
  }

  const isWorking = !!today.data?.can_check_out;
  const finished = !isWorking && !!today.data?.check_out_time;
  const assigned = assignedShift(today.data, schedules.data || [], date);
  const storeDisplay = storeLabel(profile.data?.store_name);
  const progress = isWorking ? shiftProgress(today.data?.check_in_time, today.data?.attendance_context?.actual.work_hours, clock) : null;
  const statusText = today.data?.check_in_time ? statusLabels[today.data.status] || today.data.status : '—';
  const statusTone = today.data?.status === 'NORMAL' ? p.emeraldText : today.data?.check_in_time ? p.amberText : p.muted;
  const pendingLeaves = isManager ? managerStats.data?.pending_leaves || 0 : 0;
  const enabledShortcuts = shortcuts.filter(item => prefs.shortcuts.includes(item.key));
  const anyError = profile.error || today.error || schedules.error || (canSeeReports && managerStats.error) || error;
  const reloadAll = () => { profile.reload(); today.reload(); schedules.reload(); summary.reload(); managerStats.reload(); };

  return (
    <View style={{ flex: 1, backgroundColor: p.bg }}>
      <ScrollView
        refreshControl={<RefreshControl refreshing={profile.loading || today.loading || schedules.loading || summary.loading || managerStats.loading} onRefresh={reloadAll} />}
        contentContainerStyle={[styles.content, { paddingTop: insets.top + 8, gap: 16 }]}
      >
        {/* Top bar: menu · brand · notifications · avatar */}
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', marginLeft: -10 }}>
            <Pressable accessibilityRole="button" accessibilityLabel="Cài đặt menu" onPress={() => setDrawer(true)} style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}>
              <AppIcon name="menu-outline" size={22} color={p.text} />
            </Pressable>
            <Brand />
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Pressable
              accessibilityLabel="Xem thông báo"
              accessibilityRole="button"
              onPress={() => setCenterOpen(true)}
              style={{ width: 44, height: 44, borderRadius: 8, backgroundColor: p.card, borderWidth: 1, borderColor: p.line, alignItems: 'center', justifyContent: 'center' }}
            >
              <AppIcon name="notifications-outline" size={18} color={p.text} />
              {unreadCount > 0 && (
                <View style={{ position: 'absolute', top: 6, right: 6, minWidth: 16, height: 16, paddingHorizontal: 3, borderRadius: 8, backgroundColor: p.danger, alignItems: 'center', justifyContent: 'center', borderWidth: 1.5, borderColor: p.card }}>
                  <Text style={{ color: '#fff', fontSize: 9, fontFamily: 'BeVietnamBold' }}>{unreadCount > 9 ? '9+' : unreadCount}</Text>
                </View>
              )}
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Hồ sơ cá nhân"
              onPress={() => router.push('/(staff)/account')}
              style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: p.brand, alignItems: 'center', justifyContent: 'center' }}
            >
              <Text style={{ color: p.onBrand, fontFamily: 'BeVietnamBold', fontSize: 14 }}>{initials}</Text>
            </Pressable>
          </View>
        </View>

        {/* Greeting */}
        <View>
          <Text style={{ fontFamily: 'BeVietnam', fontSize: 13, color: p.muted }}>Xin chào,</Text>
          <Text numberOfLines={1} style={{ fontFamily: 'BeVietnamBold', fontSize: 24, lineHeight: 30, color: p.text, letterSpacing: -0.5 }}>
            {profile.data?.full_name || 'Nhân viên TechZone'}
          </Text>
          <Text numberOfLines={1} style={{ fontFamily: 'BeVietnam', fontSize: 12, color: p.muted, marginTop: 2 }}>
            {profile.data?.position_name || 'Nhân viên'} · <Text style={{ fontFamily: 'Mono', fontSize: 12, color: p.muted }}>{profile.data?.employee_code || 'TZ'}</Text> · {storeDisplay}
          </Text>
        </View>

        <LoadingBar active={profile.loading || today.loading || schedules.loading} label="Đang đồng bộ trang chủ…" />

        {!!anyError && (
          <Card style={{ backgroundColor: p.dangerBg, borderColor: p.danger }}>
            <Text style={{ color: p.dangerText, fontFamily: 'BeVietnam', fontSize: 13 }}>{anyError}</Text>
            <Button title="Thử tải lại dữ liệu" secondary onPress={reloadAll} />
          </Card>
        )}

        {/* Today's shift */}
        <Card style={{ gap: 14 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <Eyebrow>
              Hôm nay · {new Date().toLocaleDateString('vi-VN', { weekday: 'long', day: '2-digit', month: '2-digit', timeZone: TZ })}
            </Eyebrow>
            {isWorking ? <Badge label="Đang diễn ra" variant="success" pulse size="sm" />
              : finished ? <Badge label="Đã kết thúc" size="sm" />
              : <Badge label="Chưa vào ca" size="sm" />}
          </View>
          <View style={{ gap: 2 }}>
            <Text style={{ fontFamily: 'BeVietnamBold', fontSize: 18, color: p.text }}>
              {assigned?.shift_name || 'Hôm nay chưa có lịch ca'}
            </Text>
            {!!(assigned?.start_time && assigned.end_time) && (
              <Text style={{ fontFamily: 'Mono', fontSize: 13, color: p.body }}>
                {assigned.start_time.slice(0, 5)} – {assigned.end_time.slice(0, 5)}
              </Text>
            )}
            <Text style={{ fontFamily: 'BeVietnam', fontSize: 12, color: p.muted, marginTop: 4 }}>
              {isWorking ? 'Cửa hàng của lượt đang mở' : 'Cửa hàng trong lịch phân ca'}: {storeLabel(assigned?.store_name || profile.data?.store_name)}
            </Text>
          </View>

          <View style={{ flexDirection: 'row', borderWidth: 1, borderColor: p.line, borderRadius: 6 }}>
            <Cell label="Giờ vào" value={today.data?.check_in_time ? clockTime(today.data.check_in_time) : '--:--'} mono muted={!today.data?.check_in_time} />
            <Cell label="Trạng thái" value={statusText} color={statusTone} divider />
            <Cell label="Giờ ra" value={today.data?.check_out_time ? clockTime(today.data.check_out_time) : '--:--'} mono muted={!today.data?.check_out_time} divider />
          </View>

          {progress && (
            <View style={{ gap: 6 }}>
              <ProgressBar progress={progress.percent} color={p.emerald} />
              <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <Text style={{ fontFamily: 'BeVietnam', fontSize: 11, color: p.muted }}>Đã làm <Text style={{ fontFamily: 'Mono', fontSize: 11, color: p.muted }}>{progress.elapsed.toFixed(1)}h</Text></Text>
                <Text style={{ fontFamily: 'BeVietnam', fontSize: 11, color: p.muted }}>Còn <Text style={{ fontFamily: 'Mono', fontSize: 11, color: p.muted }}>{progress.remaining.toFixed(1)}h</Text> theo ca</Text>
              </View>
            </View>
          )}

          <AttendanceAction checkOut={isWorking} disabled={!assigned || today.loading || schedules.loading || !!today.error || !!schedules.error} onPress={() => router.push('/(staff)/attendance')} />
          <Text style={{ fontFamily: 'BeVietnam', fontSize: 11, color: p.muted }}>
            {assigned ? 'Giờ vào do máy chủ ghi nhận' : 'Chưa có ca được phân công hôm nay. Vui lòng liên hệ cửa hàng trưởng.'}
          </Text>
        </Card>

        {/* Pending approvals callout */}
        {pendingLeaves > 0 && (
          <Pressable
            accessibilityRole="button"
            onPress={() => router.push('/(staff)/requests')}
            style={{ flexDirection: 'row', gap: 10, padding: 14, borderRadius: 8, backgroundColor: p.emeraldBg, borderWidth: 1, borderColor: p.dark ? 'rgba(16,185,129,0.25)' : 'rgba(16,185,129,0.22)' }}
          >
            <Text style={{ color: p.emeraldText, fontSize: 14, lineHeight: 20 }}>✦</Text>
            <Text style={{ flex: 1, fontFamily: 'BeVietnam', fontSize: 13, lineHeight: 20, color: p.text }}>
              Có <Text style={{ fontFamily: 'BeVietnamBold', fontSize: 13, color: p.text }}>{pendingLeaves} đơn nghỉ phép</Text> đang chờ bạn duyệt.{' '}
              <Text style={{ fontFamily: 'BeVietnamBold', fontSize: 13, color: p.emeraldText }}>Duyệt ngay →</Text>
            </Text>
          </Pressable>
        )}

        {/* Month / chain metrics */}
        {isManager ? (
          <View style={{ gap: 8 }}>
            <SectionTitle title={isStoreManager ? storeDisplay : 'Toàn chuỗi TechZone'} action="Dashboard →" onPress={() => router.push('/(staff)/dashboard')} />
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <MetricBox label="Tổng nhân sự" value={managerStats.data?.active_employees ?? '—'} subtext="Biên chế" />
              <MetricBox label="Đang làm hôm nay" value={managerStats.data?.attendance_today?.working ?? '—'} subtext={managerStats.data?.active_employees ? `Có mặt ${Math.round(((managerStats.data.attendance_today.checked_in || 0) / managerStats.data.active_employees) * 100)}%` : undefined} variant="success" />
            </View>
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <MetricBox label="Đi muộn hôm nay" value={managerStats.data?.attendance_today?.late ?? '—'} subtext="Trong ngày" variant={managerStats.data?.attendance_today?.late ? 'warning' : 'neutral'} />
              <MetricBox label="Đơn chờ duyệt" value={managerStats.data?.pending_leaves ?? '—'} subtext="Cần xử lý" onPress={() => router.push('/(staff)/requests')} />
            </View>
          </View>
        ) : (
          <View style={{ gap: 8 }}>
            <SectionTitle title={`Tháng ${currentPeriod.slice(5)}/${currentPeriod.slice(0, 4)}`} action="Chi tiết →" onPress={() => router.push('/(staff)/summary')} />
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <MetricBox label="Tổng ngày công" value={`${summary.data?.working_days.actual_days ?? 0} / ${summary.data?.working_days.standard_days ?? 26}`} subtext="Ngày công thực tế" />
              <MetricBox label="Tổng giờ làm" value={`${summary.data?.working_days.total_hours ?? 0}h`} subtext="Tích lũy tháng" />
            </View>
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <MetricBox label="Đi muộn" value={`${summary.data?.late_arrivals.count ?? 0} lần`} subtext={summary.data?.late_arrivals.minutes ? `Tổng ${summary.data.late_arrivals.minutes} phút` : 'Đúng giờ'} variant={summary.data?.late_arrivals.count ? 'warning' : 'neutral'} />
              <MetricBox label="Đã nghỉ phép" value={`${summary.data?.leave_quota.used_leave ?? 0} ngày`} subtext={`Còn ${summary.data?.leave_quota.remaining_leave ?? 0} ngày phép`} />
            </View>
          </View>
        )}

        {/* Week strip */}
        <Card style={{ gap: 12 }}>
          <SectionTitle title="Lịch biểu tuần này" action="Xem lịch →" onPress={() => router.push('/(staff)/schedules')} />
          <View style={{ flexDirection: 'row', gap: 4 }}>
            {Array.from({ length: 7 }, (_, i) => {
              const d = new Date(`${date}T12:00:00+07:00`);
              d.setUTCDate(d.getUTCDate() + i - 3);
              const key = d.toLocaleDateString('en-CA', { timeZone: TZ });
              const selected = key === date;
              const shift = schedules.data?.find(s => s.work_date === key);
              const fg = selected ? p.onBrand : shift ? p.text : p.muted;
              return (
                <Pressable
                  key={key}
                  accessibilityRole="button"
                  accessibilityLabel={`Xem lịch ${key}`}
                  onPress={() => router.push('/(staff)/schedules')}
                  style={{ flex: 1, alignItems: 'center', paddingVertical: 8, borderRadius: 6, gap: 2, backgroundColor: selected ? p.brand : 'transparent', borderWidth: 1, borderColor: selected ? p.brand : p.line, borderStyle: shift || selected ? 'solid' : 'dashed' }}
                >
                  <Text style={{ fontFamily: 'BeVietnam', fontSize: 10, color: selected ? p.onBrand : p.muted }}>
                    {d.toLocaleDateString('vi-VN', { weekday: 'short', timeZone: TZ }).replace('Th ', 'T')}
                  </Text>
                  <Text style={{ fontFamily: 'MonoBold', fontSize: 13, color: fg }}>{key.slice(-2)}</Text>
                  <Text numberOfLines={1} style={{ fontFamily: 'BeVietnam', fontSize: 9, color: selected ? p.onBrand : p.muted }}>
                    {shift ? shift.shift_name.replace(/^Ca\s+/i, '') : 'Nghỉ'}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </Card>

        {/* Utilities list */}
        <View style={{ gap: 8 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <Eyebrow>Tiện ích & Báo cáo</Eyebrow>
            <Pressable accessibilityRole="button" hitSlop={10} onPress={() => router.push('/(staff)/settings?section=shortcuts')}>
              <Text style={{ fontFamily: 'BeVietnamBold', fontSize: 12, color: p.emeraldText }}>Tùy biến</Text>
            </Pressable>
          </View>
          <Card style={{ padding: 0, gap: 0, overflow: 'hidden' }}>
            {enabledShortcuts.map((item, i) => (
              <Row key={item.key} icon={item.icon} title={item.title} last={i === enabledShortcuts.length - 1} onPress={() => router.push(item.href as Href)} />
            ))}
            {!enabledShortcuts.length && (
              <Text style={{ fontFamily: 'BeVietnam', fontSize: 13, color: p.muted, padding: 14 }}>Chưa chọn lối tắt nào. Bấm “Tùy biến” để thêm.</Text>
            )}
          </Card>
        </View>
      </ScrollView>

      {/* Drawer */}
      <Modal visible={drawer} transparent animationType="fade" onRequestClose={() => setDrawer(false)}>
        <View style={{ flex: 1, flexDirection: 'row', backgroundColor: 'rgba(9,9,11,0.5)' }}>
          <View accessibilityViewIsModal style={{ width: '80%', maxWidth: 320, backgroundColor: p.card, borderRightWidth: 1, borderColor: p.line, paddingTop: insets.top + 8, paddingBottom: insets.bottom + 16, paddingHorizontal: 12 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingLeft: 12 }}>
              <Brand />
              <Pressable accessibilityRole="button" accessibilityLabel="Đóng menu" onPress={() => setDrawer(false)} style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}>
                <AppIcon name="close" size={20} color={p.muted} />
              </Pressable>
            </View>

            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 12, marginBottom: 16, padding: 10, borderWidth: 1, borderColor: p.line, borderRadius: 8 }}>
              <View style={{ width: 34, height: 34, borderRadius: 6, backgroundColor: p.brand, alignItems: 'center', justifyContent: 'center' }}>
                <Text style={{ color: p.onBrand, fontFamily: 'BeVietnamBold', fontSize: 12 }}>{initials}</Text>
              </View>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text numberOfLines={1} style={{ fontFamily: 'BeVietnamBold', fontSize: 13, color: p.text }}>{profile.data?.full_name || 'TechZone'}</Text>
                <Text numberOfLines={1} style={{ fontFamily: 'BeVietnam', fontSize: 11, color: p.muted }}>
                  <Text style={{ fontFamily: 'Mono', fontSize: 11, color: p.muted }}>{profile.data?.employee_code || profile.data?.username}</Text> · {storeDisplay}
                </Text>
              </View>
            </View>

            <ScrollView contentContainerStyle={{ gap: 2 }}>
              <DrawerItem icon="notifications-outline" title="Trung tâm thông báo" badge={unreadCount} onPress={() => { setDrawer(false); setCenterOpen(true); }} />
              <Eyebrow style={{ marginTop: 14, marginBottom: 4, paddingHorizontal: 12 }}>Vận hành</Eyebrow>
              {operations.map(([icon, title, href]) => <DrawerItem key={title} icon={icon} title={title} onPress={() => navigate(href)} />)}
              <Eyebrow style={{ marginTop: 14, marginBottom: 4, paddingHorizontal: 12 }}>Tài khoản</Eyebrow>
              {account.map(([icon, title, href]) => <DrawerItem key={title} icon={icon} title={title} onPress={() => navigate(href)} />)}
            </ScrollView>

            <Pressable
              accessibilityRole="button"
              onPress={() => { setDrawer(false); void signOut().catch(e => setError(e.message)); }}
              style={({ pressed }) => ({ height: 44, borderRadius: 8, borderWidth: 1, borderColor: p.dangerBg, backgroundColor: pressed ? p.dangerBg : 'transparent', alignItems: 'center', justifyContent: 'center' })}
            >
              <Text style={{ fontFamily: 'BeVietnamBold', fontSize: 14, color: p.dangerText }}>Đăng xuất</Text>
            </Pressable>
          </View>
          <Pressable accessibilityLabel="Đóng menu" accessibilityRole="button" onPress={() => setDrawer(false)} style={{ flex: 1 }} />
        </View>
      </Modal>
    </View>
  );
}

function Brand() {
  const p = usePalette();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
      <Text style={{ fontFamily: 'BeVietnamBold', fontSize: 17, color: p.text, letterSpacing: -0.4 }}>techzone</Text>
      <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: p.emerald }} />
    </View>
  );
}

function Eyebrow({ children, style }: { children: ReactNode; style?: object }) {
  const p = usePalette();
  return <Text style={[{ fontFamily: 'BeVietnamBold', fontSize: 10, letterSpacing: 0.8, textTransform: 'uppercase', color: p.muted }, style]}>{children}</Text>;
}

function SectionTitle({ title, action, onPress }: { title: string; action: string; onPress: () => void }) {
  const p = usePalette();
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
      <Text numberOfLines={1} style={{ flex: 1, fontFamily: 'BeVietnamBold', fontSize: 15, color: p.text }}>{title}</Text>
      <Pressable accessibilityRole="button" hitSlop={10} onPress={onPress}>
        <Text style={{ fontFamily: 'BeVietnamBold', fontSize: 12, color: p.emeraldText }}>{action}</Text>
      </Pressable>
    </View>
  );
}

function Cell({ label, value, mono, muted, color, divider }: { label: string; value: string; mono?: boolean; muted?: boolean; color?: string; divider?: boolean }) {
  const p = usePalette();
  return (
    <View style={{ flex: 1, paddingVertical: 10, paddingHorizontal: 12, borderLeftWidth: divider ? 1 : 0, borderLeftColor: p.line }}>
      <Text style={{ fontFamily: 'BeVietnam', fontSize: 11, color: p.muted }}>{label}</Text>
      <Text numberOfLines={1} style={{ fontFamily: mono ? 'MonoBold' : 'BeVietnamBold', fontSize: mono ? 15 : 13, marginTop: 3, color: color || (muted ? p.muted : p.text) }}>{value}</Text>
    </View>
  );
}

function Row({ icon, title, last, onPress }: { icon: AppIconName; title: string; last?: boolean; onPress: () => void }) {
  const p = usePalette();
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, minHeight: 56, borderBottomWidth: last ? 0 : 1, borderBottomColor: p.line, backgroundColor: pressed ? p.surfaceLow : 'transparent' })}
    >
      <View style={{ width: 32, height: 32, borderRadius: 6, backgroundColor: p.surfaceLow, alignItems: 'center', justifyContent: 'center' }}>
        <AppIcon name={icon} size={16} color={p.text} />
      </View>
      <Text style={{ flex: 1, fontFamily: 'BeVietnam', fontSize: 14, color: p.text }}>{title}</Text>
      <AppIcon name="chevron-forward" size={14} color={p.muted} />
    </Pressable>
  );
}

function DrawerItem({ icon, title, badge, onPress }: { icon: AppIconName; title: string; badge?: number; onPress: () => void }) {
  const p = usePalette();
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 12, height: 44, paddingHorizontal: 12, borderRadius: 6, backgroundColor: pressed ? p.surfaceLow : 'transparent' })}
    >
      <AppIcon name={icon} size={18} color={p.muted} />
      <Text numberOfLines={1} style={{ flex: 1, fontFamily: 'BeVietnam', fontSize: 14, color: p.text }}>{title}</Text>
      {!!badge && <Badge label={`${badge}`} variant="danger" size="sm" />}
    </Pressable>
  );
}
