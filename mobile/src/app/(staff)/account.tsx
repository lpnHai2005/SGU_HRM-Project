import { AppIcon, AppText as Text, type AppIconName } from '@/components/app-icon';
import type { ReactNode } from 'react';
import { storeLabel } from '@/services/presentation';
import { ScrollView, View, Pressable } from 'react-native';
import { router, type Href } from 'expo-router';
import { Button, Card, styles, usePalette, Badge } from '@/components/attendance-ui';
import { LoadingBar } from '@/components/loading-bar';
import { useResource } from '@/hooks/use-resource';
import { useSession } from '@/contexts/session';
import type { Profile } from '@/services/staff';

const ROLE_LABELS: Record<string, string> = { ADMIN: 'Quản trị viên', DIRECTOR: 'Giám đốc', HR_MANAGER: 'Quản lý nhân sự', STORE_MANAGER: 'Cửa hàng trưởng', EMPLOYEE: 'Nhân viên' };

export default function Account() {
  const { data, loading, error, reload } = useResource<Profile>('/auth/me');
  const { signOut } = useSession();
  const p = usePalette();

  const initials = data?.full_name?.split(' ').slice(-2).map(v => v[0]).join('') || 'TZ';
  const storeDisplay = storeLabel(data?.store_name);
  const role = data?.roles?.map(r => ROLE_LABELS[r]).find(Boolean);
  const info: [string, string, boolean?][] = [
    ['Mã nhân viên', data?.employee_code || '—', true],
    ['Chức danh', data?.position_name || '—'],
    ['Phòng ban', data?.department_name || '—'],
    ['Chi nhánh', storeDisplay],
    ['Email nội bộ', data?.email || '—'],
    ['Số điện thoại', data?.phone || '—', true],
  ];

  return (
    <ScrollView style={{ backgroundColor: p.bg }} contentContainerStyle={styles.content}>
      <LoadingBar active={loading} label="Đang cập nhật hồ sơ nhân sự…" />
      {!!error && (
        <Card style={{ backgroundColor: p.dangerBg, borderColor: p.danger }}>
          <Text style={{ color: p.dangerText, fontFamily: 'BeVietnam', fontSize: 13 }}>{error}</Text>
          <Button title="Thử lại" secondary onPress={reload} />
        </Card>
      )}

      {/* Identity */}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
        <View style={{ width: 60, height: 60, borderRadius: 30, backgroundColor: p.brand, alignItems: 'center', justifyContent: 'center' }}>
          <Text style={{ color: p.onBrand, fontFamily: 'BeVietnamBold', fontSize: 20 }}>{initials}</Text>
        </View>
        <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
          <Text numberOfLines={1} style={{ fontFamily: 'BeVietnamBold', fontSize: 19, color: p.text, letterSpacing: -0.3 }}>{data?.full_name || 'Nhân viên TechZone'}</Text>
          <Text numberOfLines={1} style={{ fontFamily: 'BeVietnam', fontSize: 12, color: p.muted }}>{data?.position_name || 'Nhân viên'} · {storeDisplay}</Text>
          <View style={{ flexDirection: 'row', gap: 6, marginTop: 4, flexWrap: 'wrap' }}>
            <View style={{ paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4, backgroundColor: p.surfaceLow }}>
              <Text style={{ fontFamily: 'Mono', fontSize: 11, color: p.body }}>{data?.employee_code || '—'}</Text>
            </View>
            {!!role && <Badge label={role} variant="success" size="sm" />}
          </View>
        </View>
      </View>

      {/* HR info */}
      <Section title="Thông tin nhân sự & Công tác">
        <Card style={{ padding: 0, gap: 0 }}>
          {info.map(([title, value, mono], i) => (
            <View key={title} style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 12, paddingHorizontal: 14, paddingVertical: 12, borderBottomWidth: i === info.length - 1 ? 0 : 1, borderBottomColor: p.line }}>
              <Text style={{ fontFamily: 'BeVietnam', fontSize: 13, color: p.muted }}>{title}</Text>
              <Text numberOfLines={1} style={{ flexShrink: 1, textAlign: 'right', fontFamily: mono ? 'Mono' : 'BeVietnamBold', fontSize: 13, color: p.text }}>{value}</Text>
            </View>
          ))}
        </Card>
      </Section>

      {/* Security & app */}
      <Section title="Bảo mật & Cài đặt ứng dụng">
        <Card style={{ padding: 0, gap: 0, overflow: 'hidden' }}>
          <NavRow icon="lock-closed-outline" title="Đổi mật khẩu tài khoản" href="/(staff)/password" />
          <NavRow icon="color-palette-outline" title="Giao diện & Tiện ích truy cập nhanh" href="/(staff)/settings" last />
        </Card>
      </Section>

      {/* Privacy */}
      <View style={{ flexDirection: 'row', gap: 12, padding: 14, borderRadius: 8, backgroundColor: p.surfaceLow, borderWidth: 1, borderColor: p.line }}>
        <AppIcon name="shield-checkmark-outline" size={18} color={p.body} />
        <View style={{ flex: 1, gap: 4 }}>
          <Text style={{ fontFamily: 'BeVietnamBold', fontSize: 13, color: p.text }}>Quyền riêng tư & Bảo mật dữ liệu</Text>
          <Text style={{ fontFamily: 'BeVietnam', fontSize: 12, lineHeight: 18, color: p.body }}>
            Ứng dụng chỉ yêu cầu định vị GPS khi bạn thực hiện chấm công tại Showroom. Ảnh chụp selfie phục vụ mục đích đối soát ca trực, không sử dụng nhận diện khuôn mặt tự động ngoài hệ thống.
          </Text>
          <Text style={{ fontFamily: 'BeVietnam', fontSize: 11, color: p.muted }}>TechZone HRM Mobile · Cổng nhân sự</Text>
        </View>
      </View>

      <Pressable
        accessibilityRole="button"
        onPress={() => void signOut()}
        style={({ pressed }) => ({ height: 46, borderRadius: 8, borderWidth: 1, borderColor: p.dark ? 'rgba(248,113,113,0.35)' : 'rgba(220,38,38,0.3)', backgroundColor: pressed ? p.dangerBg : p.card, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 })}
      >
        <AppIcon name="log-out-outline" size={16} color={p.dangerText} />
        <Text style={{ fontFamily: 'BeVietnamBold', fontSize: 14, color: p.dangerText }}>Đăng xuất khỏi thiết bị</Text>
      </Pressable>
    </ScrollView>
  );

  function Section({ title, children }: { title: string; children: ReactNode }) {
    return (
      <View style={{ gap: 8 }}>
        <Text style={{ fontFamily: 'BeVietnamBold', fontSize: 10, letterSpacing: 0.8, textTransform: 'uppercase', color: p.muted }}>{title}</Text>
        {children}
      </View>
    );
  }

  function NavRow({ icon, title, href, last }: { icon: AppIconName; title: string; href: Href; last?: boolean }) {
    return (
      <Pressable
        accessibilityRole="button"
        onPress={() => router.push(href)}
        style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, minHeight: 52, borderBottomWidth: last ? 0 : 1, borderBottomColor: p.line, backgroundColor: pressed ? p.surfaceLow : 'transparent' })}
      >
        <AppIcon name={icon} size={18} color={p.body} />
        <Text style={{ flex: 1, fontFamily: 'BeVietnam', fontSize: 14, color: p.text }}>{title}</Text>
        <AppIcon name="chevron-forward" size={14} color={p.muted} />
      </Pressable>
    );
  }
}
