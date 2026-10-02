import { ScrollView, Text } from 'react-native';
import { router } from 'expo-router';
import { Button, Card, Label, styles, usePalette } from '@/components/attendance-ui';
import { LoadingBar } from '@/components/loading-bar';
import { useResource } from '@/hooks/use-resource';
import { useSession } from '@/contexts/session';
import type { Profile } from '@/services/staff';
export default function Account() {
  const { data, loading, error, reload } = useResource<Profile>('/auth/me'); const { signOut } = useSession(); const p = usePalette();
  return <ScrollView style={{ backgroundColor: p.bg }} contentContainerStyle={styles.content}><LoadingBar active={loading} />
    {!!error && <Card><Text style={{ color: p.danger }}>{error}</Text><Button title="Thử lại" onPress={reload} /></Card>}
    {data && <Card><Label large>{data.full_name || data.username}</Label>{[['Mã nhân viên',data.employee_code],['Chức danh',data.position_name],['Phòng ban',data.department_name],['Cửa hàng',data.store_name],['Email',data.email],['Điện thoại',data.phone]].map(([title,value]) => <Label key={title}>{title}: {value || 'Chưa cập nhật'}</Label>)}</Card>}
    <Button title="Đổi mật khẩu" secondary onPress={() => router.push('/(staff)/password')} /><Button title="Giao diện & tiện ích" secondary onPress={() => router.push('/(staff)/settings')} />
    <Card><Label>Quyền riêng tư</Label><Label muted>Chỉ lấy vị trí khi chấm công. Ảnh chụp mới được gửi qua máy chủ để lưu minh chứng; không tự nhận diện khuôn mặt. Không theo dõi vị trí nền.</Label><Label muted>Phiên bản 1.0.0</Label></Card><Button title="Đăng xuất" onPress={() => void signOut()} />
  </ScrollView>;
}
