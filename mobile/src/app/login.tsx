import { AppText as Text } from '@/components/app-icon';
import { useRef, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  View,
  Pressable,
} from 'react-native';
import { Button, Card, Input, Label, usePalette, Badge } from '@/components/attendance-ui';
import { LoadingBar } from '@/components/loading-bar';
import { useSession } from '@/contexts/session';

export default function Login() {
  const p = usePalette();
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
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: p.bg }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{
          flexGrow: 1,
          justifyContent: 'center',
          padding: 20,
          paddingVertical: 40,
          maxWidth: 480,
          width: '100%',
          alignSelf: 'center',
          gap: 20,
        }}
      >
        {/* Brand & Identity Header */}
        <View style={{ alignItems: 'center', gap: 8 }}>
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: 10,
              backgroundColor: p.surfaceLow,
              paddingHorizontal: 16,
              paddingVertical: 8,
              borderRadius: 9999,
              borderWidth: 1,
              borderColor: p.line,
            }}
          >
            <View
              style={{
                width: 28,
                height: 28,
                borderRadius: 8,
                backgroundColor: p.brand,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Text style={{ color: '#fff', fontSize: 16, fontWeight: '700' }}>⚡</Text>
            </View>
            <Text
              style={{
                fontFamily: 'BeVietnamBold',
                fontSize: 16,
                fontWeight: '700',
                color: p.text,
                letterSpacing: 1,
              }}
            >
              TECHZONE
            </Text>
            <Badge label="HRM" variant="neutral" size="sm" />
          </View>

          <Label variant="title" style={{ marginTop: 6 }}>
            Chào mừng trở lại!
          </Label>
          <Label muted style={{ textAlign: 'center' }}>
            Hệ thống quản trị nhân sự & chấm công nội bộ
          </Label>
        </View>

        {/* Main Login Card */}
        <Card style={{ gap: 14 }}>
          {/* Store Operational Badge */}
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'space-between',
              backgroundColor: p.surfaceLow,
              paddingHorizontal: 12,
              paddingVertical: 8,
              borderRadius: 10,
            }}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <View
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: 4,
                  backgroundColor: p.emerald,
                }}
              />
              <Text
                style={{
                  fontFamily: 'BeVietnam',
                  fontSize: 12,
                  color: p.text,
                  fontWeight: '500',
                }}
              >
                TECHZONE Store
              </Text>
            </View>
            <Text style={{ fontSize: 12, color: p.muted }}>Cổng nhân sự</Text>
          </View>

          {/* Employee ID / Email */}
          <View style={{ gap: 6 }}>
            <Label variant="caption">Tên đăng nhập / Mã nhân viên</Label>
            <Input
              accessibilityLabel="Tên đăng nhập"
              placeholder="Nhập tài khoản được cấp"
              autoCapitalize="none"
              autoCorrect={false}
              value={username}
              onChangeText={setUsername}
              leftIcon="👤"
            />
          </View>

          {/* Password */}
          <View style={{ gap: 6 }}>
            <Label variant="caption">Mật khẩu bảo mật</Label>
            <Input
              accessibilityLabel="Mật khẩu"
              placeholder="Nhập mật khẩu của bạn"
              secureTextEntry={!visible}
              value={password}
              onChangeText={setPassword}
              onSubmitEditing={() => {
                if (username.trim() && password) void submit();
              }}
              leftIcon="🔒"
            />
          </View>

          {/* Options Row */}
          <View
            style={{
              flexDirection: 'row',
              justifyContent: 'space-between',
              alignItems: 'center',
            }}
          >
            <Text style={{ fontFamily: 'BeVietnam', fontSize: 12, color: p.muted }}>{Platform.OS === 'web' ? 'Phiên đăng nhập trên trình duyệt' : 'Phiên được lưu an toàn trên thiết bị'}</Text>

            <Pressable
              accessibilityRole="button"
              onPress={() => setVisible(v => !v)}
              style={{ paddingVertical: 4 }}
            >
              <Text style={{ fontFamily: 'BeVietnam', fontSize: 12, color: p.brand }}>
                {visible ? 'Ẩn mật khẩu' : 'Hiện mật khẩu'}
              </Text>
            </Pressable>
          </View>

          <LoadingBar active={busy} label="Đang xác thực thông tin…" />

          {!!error && (
            <View
              style={{
                backgroundColor: p.dangerBg,
                padding: 10,
                borderRadius: 10,
                borderWidth: 1,
                borderColor: p.danger,
              }}
            >
              <Text
                accessibilityRole="alert"
                style={{
                  color: p.dangerText,
                  fontFamily: 'BeVietnam',
                  fontSize: 13,
                }}
              >
                {error}
              </Text>
            </View>
          )}

          <Button
            title="Đăng nhập"
            variant="brand"
            icon="➜"
            onPress={() => void submit()}
            disabled={busy || !username.trim() || !password}
          />
        </Card>

        {/* Security Badge */}
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 8,
            paddingVertical: 8,
          }}
        >
          <Text style={{ fontSize: 14, color: p.emerald }}>🛡️</Text>
          <Text style={{ fontFamily: 'BeVietnam', fontSize: 12, color: p.muted }}>
            Tài khoản và quyền truy cập được xác thực bởi máy chủ
          </Text>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
