import { AppText as Text } from '@/components/app-icon';
import { useRef, useState } from 'react';
import { ScrollView, View } from 'react-native';
import {
  Button,
  Card,
  Input,
  Label,
  styles,
  usePalette,
} from '@/components/attendance-ui';
import { LoadingBar } from '@/components/loading-bar';
import { useSession } from '@/contexts/session';
import { ApiError, request } from '@/services/attendance';

export default function Password() {
  const p = usePalette();
  const { token, signOut } = useSession();
  const lock = useRef(false);
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [done, setDone] = useState(false);

  async function submit() {
    if (lock.current || !token) return;
    if (next !== confirm) {
      setMessage('Mật khẩu xác nhận không khớp với mật khẩu mới.');
      return;
    }
    if (next.length < 8) {
      setMessage('Mật khẩu mới phải có tối thiểu 8 ký tự.');
      return;
    }
    lock.current = true;
    setBusy(true);
    setMessage('');
    try {
      const result = await request<{ message: string }>(
        '/auth/change-password',
        token,
        { current_password: current, new_password: next }
      );
      setCurrent('');
      setNext('');
      setConfirm('');
      setDone(true);
      setMessage(result.message || 'Đổi mật khẩu thành công. Vui lòng đăng nhập lại.');
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Không đổi được mật khẩu.');
      if (e instanceof ApiError && e.status === 401) void signOut();
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }

  return (
    <ScrollView
      style={{ backgroundColor: p.bg }}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
    >
      <View style={{ gap: 4 }}>
        <Label variant="title">Đổi mật khẩu bảo mật</Label>
        <Text style={{ fontFamily: 'BeVietnam', fontSize: 13, color: p.muted }}>
          Thiết lập mật khẩu an toàn theo tiêu chuẩn bảo mật TechZone
        </Text>
      </View>

      <Card style={{ gap: 14 }}>
        {!done && (
          <>
            <View style={{ gap: 6 }}>
              <Label variant="caption">Mật khẩu hiện tại</Label>
              <Input
                accessibilityLabel="Mật khẩu hiện tại"
                placeholder="Nhập mật khẩu đang sử dụng"
                secureTextEntry
                value={current}
                onChangeText={setCurrent}
                leftIcon="🔒"
              />
            </View>

            <View style={{ gap: 6 }}>
              <Label variant="caption">Mật khẩu mới</Label>
              <Input
                accessibilityLabel="Mật khẩu mới"
                placeholder="Ít nhất 8 ký tự"
                secureTextEntry
                value={next}
                onChangeText={setNext}
                leftIcon="🔑"
              />
            </View>

            <View style={{ gap: 6 }}>
              <Label variant="caption">Xác nhận mật khẩu mới</Label>
              <Input
                accessibilityLabel="Xác nhận mật khẩu mới"
                placeholder="Nhập lại mật khẩu mới"
                secureTextEntry
                value={confirm}
                onChangeText={setConfirm}
                leftIcon="✅"
              />
            </View>

            {/* Password Criteria checklist */}
            <Card low style={{ gap: 6, padding: 12 }}>
              <Text style={{ fontFamily: 'BeVietnamBold', fontSize: 12, color: p.text }}>
                Tiêu chuẩn mật khẩu an toàn:
              </Text>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <Text style={{ fontSize: 12, color: next.length >= 8 ? p.emeraldText : p.muted }}>
                  {next.length >= 8 ? '✓' : '○'}
                </Text>
                <Text style={{ fontFamily: 'BeVietnam', fontSize: 12, color: next.length >= 8 ? p.emeraldText : p.muted }}>
                  Độ dài tối thiểu 8 ký tự
                </Text>
              </View>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <Text style={{ fontSize: 12, color: next && confirm && next === confirm ? p.emeraldText : p.muted }}>
                  {next && confirm && next === confirm ? '✓' : '○'}
                </Text>
                <Text style={{ fontFamily: 'BeVietnam', fontSize: 12, color: next && confirm && next === confirm ? p.emeraldText : p.muted }}>
                  Khớp giữa 2 lần nhập
                </Text>
              </View>
            </Card>
          </>
        )}

        <LoadingBar active={busy} label="Đang cập nhật mật khẩu…" />

        {!!message && (
          <View
            style={{
              backgroundColor: done ? p.emeraldBg : p.dangerBg,
              borderColor: done ? p.emerald : p.danger,
              borderWidth: 1,
              borderRadius: 10,
              padding: 12,
            }}
          >
            <Text
              accessibilityRole="alert"
              style={{
                color: done ? p.emeraldText : p.dangerText,
                fontFamily: 'BeVietnamBold',
                fontSize: 13,
              }}
            >
              {done ? '✓ ' : '⚠️ '}
              {message}
            </Text>
          </View>
        )}

        {done ? (
          <Button
            title="Đăng nhập lại"
            variant="brand"
            icon="➜"
            onPress={() => void signOut()}
          />
        ) : (
          <Button
            title="Lưu mật khẩu mới"
            variant="brand"
            icon="💾"
            onPress={() => void submit()}
            disabled={busy || !current || next.length < 8 || !confirm}
          />
        )}
      </Card>
    </ScrollView>
  );
}
