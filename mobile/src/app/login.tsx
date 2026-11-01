import { AppIcon, AppText as Text } from '@/components/app-icon';
import { useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, View, Pressable } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button, Input, Label, usePalette } from '@/components/attendance-ui';
import { LoadingBar } from '@/components/loading-bar';
import { useSession } from '@/contexts/session';

export default function Login() {
  const p = usePalette();
  const insets = useSafeAreaInsets();
  const { signIn } = useSession();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const lock = useRef(false);

  async function submit() {
    if (lock.current) return;
    if (!username.trim() || !password) {
      setError('Vui lòng nhập đầy đủ tên đăng nhập và mật khẩu.');
      return;
    }
    lock.current = true;
    setBusy(true);
    setError('');
    try {
      await signIn(username.trim(), password);
      setPassword('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Không đăng nhập được.');
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: p.bg }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ flexGrow: 1, paddingHorizontal: 24, paddingTop: insets.top + 40, paddingBottom: insets.bottom + 28, maxWidth: 480, width: '100%', alignSelf: 'center' }}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <Text style={{ fontFamily: 'BeVietnamBold', fontSize: 20, color: p.text, letterSpacing: -0.4 }}>techzone</Text>
          <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: p.emerald }} />
        </View>

        <View style={{ marginTop: 48, gap: 8 }}>
          <Text style={{ fontFamily: 'BeVietnamBold', fontSize: 10, letterSpacing: 0.8, textTransform: 'uppercase', color: p.muted }}>Cổng nhân sự · HRM</Text>
          <Text style={{ fontFamily: 'BeVietnamBold', fontSize: 28, lineHeight: 34, color: p.text, letterSpacing: -0.8 }}>Đăng nhập</Text>
          <Text style={{ fontFamily: 'BeVietnam', fontSize: 14, lineHeight: 21, color: p.body }}>
            Dùng tài khoản được phòng nhân sự cấp để chấm công, xem lịch ca và nộp đơn.
          </Text>
        </View>

        <View style={{ marginTop: 32, gap: 16 }}>
          <View style={{ gap: 6 }}>
            <Label variant="bold" style={{ fontSize: 13 }}>Tên đăng nhập / Mã nhân viên</Label>
            <Input
              accessibilityLabel="Tên đăng nhập"
              placeholder="Nhập tài khoản được cấp"
              autoCapitalize="none"
              autoCorrect={false}
              value={username}
              onChangeText={setUsername}
              leftIcon="person-outline"
            />
          </View>

          <View style={{ gap: 6 }}>
            <Label variant="bold" style={{ fontSize: 13 }}>Mật khẩu bảo mật</Label>
            <View>
              <Input
                accessibilityLabel="Mật khẩu"
                placeholder="Nhập mật khẩu của bạn"
                secureTextEntry={!visible}
                value={password}
                onChangeText={setPassword}
                onSubmitEditing={() => { if (username.trim() && password) void submit(); }}
                leftIcon="lock-closed-outline"
                style={{ paddingRight: 40 }}
              />
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={visible ? 'Ẩn mật khẩu' : 'Hiện mật khẩu'}
                onPress={() => setVisible(v => !v)}
                style={{ position: 'absolute', right: 1, top: 1, bottom: 1, width: 44, alignItems: 'center', justifyContent: 'center' }}
              >
                <AppIcon name={visible ? 'eye-off-outline' : 'eye-outline'} size={18} color={p.muted} />
              </Pressable>
            </View>
          </View>

          <LoadingBar active={busy} label="Đang xác thực thông tin…" />

          {!!error && (
            <View style={{ backgroundColor: p.dangerBg, padding: 12, borderRadius: 6, borderWidth: 1, borderColor: p.dangerBg }}>
              <Text accessibilityRole="alert" style={{ color: p.dangerText, fontFamily: 'BeVietnam', fontSize: 13, lineHeight: 19 }}>{error}</Text>
            </View>
          )}

          <Button title="Đăng nhập" variant="brand" onPress={() => void submit()} disabled={busy || !username.trim() || !password} />
        </View>

        <View style={{ flex: 1, minHeight: 32 }} />
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
          <AppIcon name="lock-closed-outline" size={13} color={p.muted} />
          <Text style={{ fontFamily: 'BeVietnam', fontSize: 12, color: p.muted }}>
            {Platform.OS === 'web' ? 'Phiên đăng nhập trên trình duyệt' : 'Phiên được lưu an toàn trên thiết bị'}
          </Text>
        </View>
        <Text style={{ fontFamily: 'Mono', fontSize: 11, color: p.muted, textAlign: 'center', marginTop: 6 }}>TechZone HRM</Text>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
