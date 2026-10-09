import { AttendanceAction } from '@/components/attendance-action';
import { AppText as Text } from '@/components/app-icon';
import { useCallback, useState } from 'react';
import { Modal, Pressable, RefreshControl, ScrollView, View } from 'react-native';
import { router, useFocusEffect, type Href } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  Button,
  Card,
  Label,
  styles,
  usePalette,
  Badge,
  ProgressBar,
} from '@/components/attendance-ui';
import { LoadingBar } from '@/components/loading-bar';
import { useResource } from '@/hooks/use-resource';
import { useSession } from '@/contexts/session';
import { usePreferences } from '@/contexts/preferences';
import { shortcuts, type Profile, type Schedule } from '@/services/staff';
import { assignedShift, shiftProgress, storeLabel } from '@/services/presentation';
import { displayTime, vietnamPeriod, type Today } from '@/services/attendance';

export default function Home() {
  const p = usePalette();
  const insets = useSafeAreaInsets();
  const { signOut } = useSession();
  const { prefs } = usePreferences();
  const profile = useResource<Profile>('/auth/me', 30000);
  const today = useResource<Today>('/attendances/today-status', 30000);
  const schedules = useResource<Schedule[]>(`/mobile-attendance/my-schedules?period=${vietnamPeriod()}`, 30000);
  const [drawer, setDrawer] = useState(false);
  const [error, setError] = useState('');
  const [clock, setClock] = useState(Date.now);
  useFocusEffect(useCallback(() => { const tick = setInterval(() => setClock(Date.now()), 30000); return () => clearInterval(tick); }, []));

  const date = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' });
  const initials = profile.data?.full_name?.split(' ').slice(-2).map(v => v[0]).join('') || 'TZ';

  const menu: [string, string, Href][] = [
    ['👤', 'Thông tin cá nhân', '/(staff)/account'],
    ['📊', 'Nhật ký làm việc & Hoạt động', '/(staff)/activity'],
    ['📅', 'Lịch ca & Phân công', '/(staff)/schedules'],
    ['📋', 'Bảng công cá nhân', '/(staff)/summary'],
    ['📝', 'Quản lý nghỉ phép & Đơn từ', '/(staff)/requests'],
    ['⚙️', 'Cấu hình ứng dụng', '/(staff)/settings'],
    ['🔒', 'Đổi mật khẩu', '/(staff)/password'],
  ];

  function navigate(href: Href) {
    setDrawer(false);
    router.push(href);
  }

  // Calculate approximate progress if in shift
  const isWorking = !!today.data?.can_check_out;
  const assigned = assignedShift(today.data, schedules.data || [], date);
  const storeDisplay = storeLabel(profile.data?.store_name);
  const progress = isWorking ? shiftProgress(today.data?.check_in_time, today.data?.attendance_context?.actual.work_hours, clock) : null;

  return (
    <View style={{ flex: 1, backgroundColor: p.bg }}>
      <ScrollView refreshControl={<RefreshControl refreshing={profile.loading || today.loading || schedules.loading} onRefresh={() => { profile.reload(); today.reload(); schedules.reload(); }} />} contentContainerStyle={[styles.content, { paddingTop: insets.top + 16 }]}>
        {/* User Greeting & Profile Quick Header */}
        <Card low style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, flex: 1 }}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Mở menu nhân viên"
              onPress={() => setDrawer(true)}
              style={{
                width: 52,
                height: 52,
                borderRadius: 26,
                backgroundColor: p.brand,
                alignItems: 'center',
                justifyContent: 'center',
                position: 'relative',
                shadowColor: p.brand,
                shadowOffset: { width: 0, height: 2 },
                shadowOpacity: 0.3,
                shadowRadius: 4,
                elevation: 3,
              }}
            >
              <Text style={{ color: '#fff', fontFamily: 'BeVietnamBold', fontSize: 18, fontWeight: '700' }}>
                {initials}
              </Text>
              <View
                style={{
                  position: 'absolute',
                  bottom: 0,
                  right: 0,
                  width: 14,
                  height: 14,
                  borderRadius: 7,
                  backgroundColor: p.emerald,
                  borderWidth: 2,
                  borderColor: p.card,
                }}
              />
            </Pressable>

            <View style={{ flex: 1, gap: 2 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <Text style={{ fontFamily: 'BeVietnam', fontSize: 13, color: p.muted }}>Xin chào,</Text>
                <Badge label={profile.data?.employee_code || 'NV-TZ'} variant="neutral" size="sm" />
              </View>
              <Text
                numberOfLines={1}
                style={{
                  fontFamily: 'BeVietnamBold',
                  fontSize: 17,
                  fontWeight: '700',
                  color: p.text,
                }}
              >
                {profile.data?.full_name || 'Nhân viên TechZone'}
              </Text>
              <Text
                numberOfLines={1}
                style={{ fontFamily: 'BeVietnam', fontSize: 12, color: p.muted }}
              >
                {profile.data?.position_name || 'Nhân viên'} • {storeDisplay}
              </Text>
            </View>
          </View>

          <Pressable
            accessibilityLabel="Cài đặt menu"
            accessibilityRole="button"
            onPress={() => setDrawer(true)}
            style={{
              width: 40,
              height: 40,
              borderRadius: 12,
              backgroundColor: p.card,
              borderWidth: 1,
              borderColor: p.line,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Text style={{ fontSize: 18, color: p.text }}>☰</Text>
          </Pressable>
        </Card>

        {/* Date line */}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 4 }}>
          <Text style={{ fontSize: 13, color: p.muted }}>🗓</Text>
          <Text style={{ fontFamily: 'BeVietnam', fontSize: 13, color: p.muted }}>
            {new Date().toLocaleDateString('vi-VN', {
              timeZone: 'Asia/Ho_Chi_Minh',
              weekday: 'long',
              day: 'numeric',
              month: 'long',
              year: 'numeric',
            })}
          </Text>
        </View>

        <LoadingBar
          active={profile.loading || today.loading || schedules.loading}
          label="Đang đồng bộ trang chủ…"
        />

        {!!(profile.error || today.error || schedules.error || error) && (
          <Card style={{ backgroundColor: p.dangerBg, borderColor: p.danger }}>
            <Text style={{ color: p.dangerText, fontFamily: 'BeVietnam', fontSize: 13 }}>
              {profile.error || today.error || schedules.error || error}
            </Text>
            <Button
              title="Thử tải lại dữ liệu"
              secondary
              onPress={() => {
                profile.reload();
                today.reload();
                schedules.reload();
              }}
            />
          </Card>
        )}

        {/* Active Shift Card (Hero Operational Container) */}
        <Card style={{ gap: 14 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <View style={{ gap: 4, flex: 1 }}>
              {isWorking ? (
                <Badge label="ĐANG DIỄN RA" variant="success" pulse size="sm" />
              ) : (
                <Badge label="CHƯA VÀO CA" variant="neutral" size="sm" />
              )}
              <Text
                style={{
                  fontFamily: 'BeVietnamBold',
                  fontSize: 18,
                  fontWeight: '700',
                  color: p.text,
                  marginTop: 4,
                }}
              >
                {assigned?.shift_name || 'Hôm nay chưa có lịch ca'}
              </Text>
              <Text style={{ fontFamily: 'BeVietnam', fontSize: 13, color: p.muted }}>
                🏪 {storeDisplay}
              </Text>
              {!!assigned?.store_name && assigned.store_name !== profile.data?.store_name && <Label muted>{isWorking ? 'Cửa hàng của lượt đang mở' : 'Cửa hàng trong lịch phân ca'}: {storeLabel(assigned.store_name)}</Label>}
            </View>

            <View
              style={{
                width: 44,
                height: 44,
                borderRadius: 12,
                backgroundColor: p.surfaceLow,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Text style={{ fontSize: 22 }}>⏱️</Text>
            </View>
          </View>

          {/* Shift Details & Progress */}
          <View
            style={{
              backgroundColor: p.surfaceLow,
              padding: 12,
              borderRadius: 12,
              gap: 8,
              borderWidth: 1,
              borderColor: p.line,
            }}
          >
            {isWorking ? (
              <>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                  <Text style={{ fontFamily: 'BeVietnam', fontSize: 13, color: p.emeraldText, fontWeight: '600' }}>
                    ✓ Đã vào ca: {displayTime(today.data?.check_in_time || null)}
                  </Text>
                  <Text style={{ fontFamily: 'BeVietnamBold', fontSize: 12, color: p.muted }}>
                    Đã ghi nhận
                  </Text>
                </View>
                {progress && <ProgressBar progress={progress.percent} color={p.emerald} />}
                <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                  <Text style={{ fontFamily: 'BeVietnam', fontSize: 11, color: p.muted }}>
                    {progress ? `Đã làm ${progress.elapsed.toFixed(1)} giờ` : 'Giờ vào do máy chủ ghi nhận'}
                  </Text>
                  <Text style={{ fontFamily: 'BeVietnam', fontSize: 11, color: p.muted }}>
                    {progress ? `Còn ${progress.remaining.toFixed(1)} giờ theo ca` : 'Xem chi tiết trong nhật ký'}
                  </Text>
                </View>
              </>
            ) : assigned?.start_time && assigned.end_time ? (
              <View style={{ gap: 4 }}>
                <Text style={{ fontFamily: 'BeVietnam', fontSize: 13, color: p.text }}>
                  Khung giờ: {assigned.start_time.slice(0, 5)} – {assigned.end_time.slice(0, 5)}
                </Text>
                <Text style={{ fontFamily: 'BeVietnam', fontSize: 12, color: p.muted }}>
                  Chuẩn bị kiểm tra GPS và chụp ảnh trước khi vào ca.
                </Text>
              </View>
            ) : (
              <Text style={{ fontFamily: 'BeVietnam', fontSize: 12, color: p.muted }}>
                Chưa có ca được phân công hôm nay. Vui lòng liên hệ cửa hàng trưởng.
              </Text>
            )}
          </View>

          {/* Action Button */}
          <AttendanceAction checkOut={isWorking} disabled={!assigned || today.loading || schedules.loading || !!today.error || !!schedules.error} onPress={() => router.push('/(staff)/attendance')} />
        </Card>

        {/* Weekly Schedule Strip */}
        <Card style={{ gap: 12 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <Label variant="subtitle">Lịch biểu tuần này</Label>
              <Badge label={`T${vietnamPeriod().slice(5)}/${vietnamPeriod().slice(0, 4)}`} size="sm" />
            </View>
            <Pressable
              accessibilityRole="button"
              onPress={() => router.push('/(staff)/schedules')}
              style={{ flexDirection: 'row', alignItems: 'center', gap: 2 }}
            >
              <Text style={{ fontFamily: 'BeVietnam', fontSize: 12, color: p.brand }}>Chi tiết →</Text>
            </Pressable>
          </View>

          {/* 7 Days Quick Scroller */}
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            {Array.from({ length: 7 }, (_, i) => {
              const d = new Date(`${date}T12:00:00+07:00`);
              d.setUTCDate(d.getUTCDate() + i - 3);
              const key = d.toLocaleDateString('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' });
              const selected = key === date;
              const hasShift = schedules.data?.some(s => s.work_date === key);

              return (
                <Pressable
                  key={key}
                  accessibilityRole="button"
                  accessibilityLabel={`Xem lịch ${key}`}
                  onPress={() => router.push('/(staff)/schedules')}
                  style={{
                    flex: 1,
                    maxWidth: 44,
                    alignItems: 'center',
                    paddingVertical: 10,
                    borderRadius: 14,
                    backgroundColor: selected ? p.brand : p.surfaceLow,
                    borderWidth: 1,
                    borderColor: selected ? p.brand : p.line,
                    gap: 6,
                  }}
                >
                  <Text
                    style={{
                      fontFamily: 'BeVietnam',
                      fontSize: 11,
                      color: selected ? '#ffffff' : p.muted,
                      fontWeight: selected ? '600' : '400',
                    }}
                  >
                    {d.toLocaleDateString('vi-VN', { weekday: 'short', timeZone: 'Asia/Ho_Chi_Minh' })}
                  </Text>
                  <Text
                    style={{
                      fontFamily: 'BeVietnamBold',
                      fontSize: 14,
                      color: selected ? '#ffffff' : p.text,
                      fontWeight: '700',
                    }}
                  >
                    {key.slice(-2)}
                  </Text>
                  <View
                    style={{
                      width: 5,
                      height: 5,
                      borderRadius: 3,
                      backgroundColor: selected
                        ? '#ffffff'
                        : hasShift
                        ? p.emerald
                        : p.line,
                    }}
                  />
                </Pressable>
              );
            })}
          </View>

          <View style={{ flexDirection: 'row', justifyContent: 'space-around', paddingTop: 2 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
              <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: p.emerald }} />
              <Text style={{ fontFamily: 'BeVietnam', fontSize: 11, color: p.muted }}>Có ca trực</Text>
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
              <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: p.brand }} />
              <Text style={{ fontFamily: 'BeVietnam', fontSize: 11, color: p.muted }}>Hôm nay</Text>
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
              <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: p.line }} />
              <Text style={{ fontFamily: 'BeVietnam', fontSize: 11, color: p.muted }}>Chưa có lịch</Text>
            </View>
          </View>
        </Card>

        {/* Quick Utilities & Actions Grid (4 Core Tiles) */}
        <Card style={{ gap: 12 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <View>
              <Label variant="subtitle">Tiện ích nhanh</Label>
              <Text style={{ fontFamily: 'BeVietnam', fontSize: 11, color: p.muted }}>
                Nghiệp vụ thường ngày trong ca
              </Text>
            </View>
            <Pressable
              accessibilityRole="button"
              onPress={() => router.push('/(staff)/settings?section=shortcuts')}
              style={{
                backgroundColor: p.surfaceLow,
                paddingHorizontal: 10,
                paddingVertical: 5,
                borderRadius: 8,
              }}
            >
              <Text style={{ fontFamily: 'BeVietnam', fontSize: 11, color: p.text }}>Tùy biến</Text>
            </Pressable>
          </View>

          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}>
            {shortcuts.filter(item => prefs.shortcuts.includes(item.key)).map(item => <Card key={item.key} onPress={() => router.push(item.href)} low style={{ flexBasis: '46%', flexGrow: 1 }}>
              <Text style={{ fontSize: 26, color: p.brand }}>{item.icon}</Text><Label variant="bold">{item.title}</Label><Label muted variant="caption">Mở chức năng →</Label>
            </Card>)}
          </View>
        </Card>

        {/* Security Mini Banner */}
        <Card low style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 12 }}>
          <Text style={{ fontSize: 20 }}>🛡️</Text>
          <View style={{ flex: 1 }}>
            <Text style={{ fontFamily: 'BeVietnamBold', fontSize: 12, color: p.text, fontWeight: '600' }}>
              Quyền riêng tư
            </Text>
            <Text style={{ fontFamily: 'BeVietnam', fontSize: 11, color: p.muted }}>
              Chỉ lấy vị trí khi chấm công. Ảnh dùng làm minh chứng, không nhận diện khuôn mặt.
            </Text>
          </View>
        </Card>
      </ScrollView>

      {/* Drawer Modal */}
      <Modal visible={drawer} transparent animationType="fade" onRequestClose={() => setDrawer(false)}>
        <View style={{ flex: 1, flexDirection: 'row', backgroundColor: '#0008' }}>
          <ScrollView
            accessibilityViewIsModal
            style={{
              width: '82%',
              maxWidth: 340,
              backgroundColor: p.card,
              borderRightWidth: 1,
              borderColor: p.line,
            }}
            contentContainerStyle={{
              padding: 20,
              paddingTop: insets.top + 20,
              gap: 16,
            }}
          >
            <View style={{ gap: 4, paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: p.line }}>
              <Label large>{profile.data?.full_name || 'TechZone'}</Label>
              <Text style={{ fontFamily: 'BeVietnam', fontSize: 12, color: p.muted }}>
                Mã NV: {profile.data?.employee_code || profile.data?.username}
              </Text>
              <Text style={{ fontFamily: 'BeVietnam', fontSize: 12, color: p.brand }}>
                {storeDisplay}
              </Text>
            </View>

            <View style={{ gap: 4 }}>
              {menu.map(([icon, title, href]) => (
                <Pressable
                  key={title}
                  accessibilityRole="button"
                  onPress={() => navigate(href)}
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 12,
                    paddingVertical: 12,
                    paddingHorizontal: 8,
                    borderRadius: 10,
                  }}
                >
                  <Text style={{ fontSize: 18 }}>{icon}</Text>
                  <Text style={{ fontFamily: 'BeVietnam', fontSize: 14, color: p.text, flex: 1 }}>
                    {title}
                  </Text>
                  <Text style={{ color: p.muted, fontSize: 14 }}>›</Text>
                </Pressable>
              ))}
            </View>

            <View style={{ gap: 10, paddingTop: 12, borderTopWidth: 1, borderTopColor: p.line }}>
              <Button
                title="Đăng xuất"
                variant="danger"
                onPress={() => {
                  setDrawer(false);
                  void signOut().catch(e => setError(e.message));
                }}
              />
              <Button title="Đóng menu" secondary onPress={() => setDrawer(false)} />
              <Text style={{ fontFamily: 'BeVietnam', fontSize: 11, color: p.muted, textAlign: 'center' }}>
                TECHZONE HRM Mobile
              </Text>
            </View>
          </ScrollView>

          <Pressable
            accessibilityLabel="Đóng menu"
            accessibilityRole="button"
            onPress={() => setDrawer(false)}
            style={{ flex: 1 }}
          />
        </View>
      </Modal>
    </View>
  );
}
