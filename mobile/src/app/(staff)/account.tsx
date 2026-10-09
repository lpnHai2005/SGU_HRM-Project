import { AppText as Text } from '@/components/app-icon';
import { storeLabel } from '@/services/presentation';
import { ScrollView, View, Pressable } from 'react-native';
import { router } from 'expo-router';
import {
  Button,
  Card,
  Label,
  styles,
  usePalette,
  Badge,
} from '@/components/attendance-ui';
import { LoadingBar } from '@/components/loading-bar';
import { useResource } from '@/hooks/use-resource';
import { useSession } from '@/contexts/session';
import type { Profile } from '@/services/staff';

export default function Account() {
  const { data, loading, error, reload } = useResource<Profile>('/auth/me');
  const { signOut } = useSession();
  const p = usePalette();

  const initials = data?.full_name?.split(' ').slice(-2).map(v => v[0]).join('') || 'TZ';
  const storeDisplay = storeLabel(data?.store_name);

  return (
    <ScrollView style={{ backgroundColor: p.bg }} contentContainerStyle={styles.content}>
      <LoadingBar active={loading} label="Đang cập nhật hồ sơ nhân sự…" />

      {!!error && (
        <Card style={{ backgroundColor: p.dangerBg, borderColor: p.danger }}>
          <Text style={{ color: p.dangerText, fontFamily: 'BeVietnam', fontSize: 13 }}>
            ⚠️ {error}
          </Text>
          <Button title="Thử lại" secondary onPress={reload} />
        </Card>
      )}

      {/* Hero Profile Card */}
      <Card style={{ alignItems: 'center', gap: 12, paddingVertical: 24 }}>
        <View
          style={{
            width: 72,
            height: 72,
            borderRadius: 36,
            backgroundColor: p.brand,
            alignItems: 'center',
            justifyContent: 'center',
            shadowColor: p.brand,
            shadowOffset: { width: 0, height: 4 },
            shadowOpacity: 0.3,
            shadowRadius: 8,
            elevation: 4,
          }}
        >
          <Text style={{ color: '#fff', fontFamily: 'BeVietnamBold', fontSize: 26, fontWeight: '700' }}>
            {initials}
          </Text>
        </View>

        <View style={{ alignItems: 'center', gap: 4 }}>
          <Label variant="title">{data?.full_name || 'Nhân viên TechZone'}</Label>
          <Badge label={data?.employee_code || 'TZ-0198'} variant="brand" size="sm" />
          <Text style={{ fontFamily: 'BeVietnam', fontSize: 13, color: p.muted, marginTop: 2 }}>
            {data?.position_name || 'Chuyên viên Bán lẻ'} • {storeDisplay}
          </Text>
        </View>
      </Card>

      {/* Detailed Info Card */}
      <Card style={{ gap: 12 }}>
        <Label variant="subtitle">Thông tin nhân sự & Công tác</Label>
        {[
          ['Mã nhân viên', data?.employee_code || '—'],
          ['Chức danh', data?.position_name || '—'],
          ['Phòng ban', data?.department_name || 'Khối Bán lẻ'],
          ['Chi nhánh', storeDisplay],
          ['Email nội bộ', data?.email || '—'],
          ['Số điện thoại', data?.phone || '—'],
        ].map(([title, value], idx) => (
          <View key={title}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 6 }}>
              <Text style={{ fontFamily: 'BeVietnam', fontSize: 13, color: p.muted }}>{title}</Text>
              <Text style={{ fontFamily: 'BeVietnamBold', fontSize: 13, color: p.text }}>{value}</Text>
            </View>
            {idx < 5 && <View style={{ height: 1, backgroundColor: p.line }} />}
          </View>
        ))}
      </Card>

      {/* Quick Action Shortcuts */}
      <Card low style={{ gap: 8 }}>
        <Label variant="subtitle">Bảo mật & Cài đặt ứng dụng</Label>
        <Pressable
          accessibilityRole="button"
          onPress={() => router.push('/(staff)/password')}
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
            paddingVertical: 10,
          }}
        >
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <Text style={{ fontSize: 18 }}>🔒</Text>
            <Text style={{ fontFamily: 'BeVietnam', fontSize: 14, color: p.text }}>Đổi mật khẩu tài khoản</Text>
          </View>
          <Text style={{ fontSize: 14, color: p.muted }}>›</Text>
        </Pressable>

        <View style={{ height: 1, backgroundColor: p.line }} />

        <Pressable
          accessibilityRole="button"
          onPress={() => router.push('/(staff)/settings')}
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
            paddingVertical: 10,
          }}
        >
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <Text style={{ fontSize: 18 }}>⚙️</Text>
            <Text style={{ fontFamily: 'BeVietnam', fontSize: 14, color: p.text }}>Giao diện & Tiện ích truy cập nhanh</Text>
          </View>
          <Text style={{ fontSize: 14, color: p.muted }}>›</Text>
        </Pressable>
      </Card>

      {/* Privacy Notice */}
      <Card low style={{ gap: 8 }}>
        <Label variant="subtitle">Quyền riêng tư & Bảo mật dữ liệu</Label>
        <Text style={{ fontFamily: 'BeVietnam', fontSize: 12, color: p.muted, lineHeight: 18 }}>
          Ứng dụng chỉ yêu cầu định vị GPS khi bạn thực hiện chấm công tại Showroom. Ảnh chụp selfie phục vụ mục đích đối soát ca trực, không sử dụng nhận diện khuôn mặt tự động ngoài hệ thống.
        </Text>
        <Text style={{ fontFamily: 'BeVietnam', fontSize: 11, color: p.brand }}>
          TECHZONE HRM Mobile · Cổng nhân sự
        </Text>
      </Card>

      {/* Logout Button */}
      <Button
        title="Đăng xuất khỏi thiết bị"
        variant="danger"
        icon="🚪"
        onPress={() => void signOut()}
      />
    </ScrollView>
  );
}
