import { useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, Text, View } from 'react-native';
import { Button, Card, Input, Label, styles, usePalette } from '@/components/attendance-ui';
import { LoadingBar } from '@/components/loading-bar';
import { useSession } from '@/contexts/session';
export default function Login() {
  const p = usePalette();
  const { signIn } = useSession();
  const [username, setUsername] = useState(''); const [password, setPassword] = useState('');
  const [visible, setVisible] = useState(false); const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  const lock = useRef(false);
  async function submit() {
    if (lock.current) return;
    lock.current = true; setBusy(true); setError('');
    try { await signIn(username.trim(), password); setPassword(''); }
    catch(e) { setError(e instanceof Error ? e.message : 'Không đăng nhập được.'); }
    finally { lock.current = false; setBusy(false); }
  }
  return <KeyboardAvoidingView style={{ flex: 1, backgroundColor: p.bg }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
    <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={[styles.content, { flexGrow: 1, justifyContent: 'center' }]}>
      <View style={{ gap: 8, marginBottom: 18 }}><Label muted>TECHZONE HRM</Label><Label large>Chào mừng trở lại</Label><Label muted>Đăng nhập để bắt đầu ngày làm việc.</Label></View>
      <Card><Label>Tài khoản nhân viên</Label><Input accessibilityLabel="Tên đăng nhập" placeholder="Tên đăng nhập" autoCapitalize="none" autoCorrect={false} value={username} onChangeText={setUsername} />
        <Input accessibilityLabel="Mật khẩu" placeholder="Mật khẩu" secureTextEntry={!visible} value={password} onChangeText={setPassword} onSubmitEditing={() => { if (username.trim() && password) void submit(); }} />
        <Button secondary title={visible ? 'Ẩn mật khẩu' : 'Hiện mật khẩu'} onPress={() => setVisible(v => !v)} />
        <LoadingBar active={busy} label="Đang đăng nhập…" />{!!error && <Text accessibilityRole="alert" style={{ color: p.danger }}>{error}</Text>}
        <Button title="Đăng nhập" onPress={() => void submit()} disabled={busy || !username.trim() || !password} />
      </Card><Label muted>Thông tin nhân sự được bảo vệ theo tài khoản của bạn.</Label>
    </ScrollView>
  </KeyboardAvoidingView>;
}
