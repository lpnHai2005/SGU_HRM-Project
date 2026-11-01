import { AppIcon, AppText as Text } from '@/components/app-icon';
import { useRef, useState } from 'react';
import { ScrollView, View } from 'react-native';
import {
  Button,
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

  const strength = [next.length >= 8, /[0-9A-Z]/.test(next), /[^A-Za-z0-9]/.test(next), next.length >= 12].filter(Boolean).length;

  return (
    <ScrollView
      style={{ backgroundColor: p.bg }}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
      automaticallyAdjustKeyboardInsets
    >
      <View style={{ gap: 4 }}>
        <Text style={{ fontFamily: 'BeVietnam', fontSize: 13, color: p.muted }}>
          Thiết lập mật khẩu an toàn theo tiêu chuẩn bảo mật TechZone
        </Text>
      </View>

      <View style={{ gap: 16 }}>
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
                leftIcon="lock-closed-outline"
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
                leftIcon="key-outline"
              />
              {!!next && (
                <View style={{ gap: 6, marginTop: 2 }}>
                  <View style={{ flexDirection: 'row', gap: 4 }}>
                    {[0, 1, 2, 3].map(i => (
                      <View key={i} style={{ flex: 1, height: 3, borderRadius: 2, backgroundColor: i < strength ? (strength >= 3 ? p.emerald : p.amber) : p.surfaceHigh }} />
                    ))}
                  </View>
                  <Text style={{ fontFamily: 'BeVietnam', fontSize: 12, color: next.length >= 8 ? p.emeraldText : p.amberText }}>
                    {next.length >= 8 ? 'Đạt yêu cầu tối thiểu 8 ký tự' : `Cần thêm ${8 - next.length} ký tự`}
                  </Text>
                </View>
              )}
            </View>

            <View style={{ gap: 6 }}>
              <Label variant="caption">Xác nhận mật khẩu mới</Label>
              <Input
                accessibilityLabel="Xác nhận mật khẩu mới"
                placeholder="Nhập lại mật khẩu mới"
                secureTextEntry
                value={confirm}
                onChangeText={setConfirm}
                leftIcon="checkmark-circle-outline"
              />
              {!!confirm && (
                <Text style={{ fontFamily: 'BeVietnam', fontSize: 12, color: next === confirm ? p.emeraldText : p.dangerText }}>
                  {next === confirm ? 'Mật khẩu xác nhận đã khớp' : 'Mật khẩu xác nhận không khớp với mật khẩu mới.'}
                </Text>
              )}
            </View>

          </>
        )}

        <LoadingBar active={busy} label="Đang cập nhật mật khẩu…" />

        {!!message && (
          <View
            style={{
              backgroundColor: done ? p.emeraldBg : p.dangerBg,
              borderColor: done ? p.emerald : p.danger,
              borderWidth: 1,
              borderRadius: 6,
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
              <AppIcon name={done ? 'checkmark-outline' : 'warning-outline'} size={16} color={done ? p.emeraldText : p.dangerText} />
              {message}
            </Text>
          </View>
        )}

        {done ? (
          <Button
            title="Đăng nhập lại"
            variant="brand"
            icon="arrow-forward"
            onPress={() => void signOut()}
          />
        ) : (
          <Button
            title="Lưu mật khẩu mới"
            variant="brand"
            icon="save-outline"
            onPress={() => void submit()}
            disabled={busy || !current || next.length < 8 || !confirm}
          />
        )}
      </View>
    </ScrollView>
  );
}
