import { useRef, useState } from 'react';
import { ScrollView, Text } from 'react-native';
import { Button, Card, Input, Label, styles, usePalette } from '@/components/attendance-ui';
import { LoadingBar } from '@/components/loading-bar';
import { useSession } from '@/contexts/session';
import { ApiError, request } from '@/services/attendance';
export default function Password() {
  const p=usePalette();const {token,signOut}=useSession();const lock=useRef(false);
  const [current,setCurrent]=useState('');const [next,setNext]=useState('');const [confirm,setConfirm]=useState('');const [busy,setBusy]=useState(false);const [message,setMessage]=useState('');const [done,setDone]=useState(false);
  async function submit(){
    if(lock.current||!token)return;
    if(next!==confirm){setMessage('Mật khẩu xác nhận không khớp.');return;}
    lock.current=true;setBusy(true);setMessage('');
    try{const result=await request<{message:string}>('/auth/change-password',token,{current_password:current,new_password:next});setCurrent('');setNext('');setConfirm('');setDone(true);setMessage(result.message);}
    catch(e){setMessage(e instanceof Error?e.message:'Không đổi được mật khẩu.');if(e instanceof ApiError&&e.status===401)void signOut();}
    finally{lock.current=false;setBusy(false);}
  }
  return <ScrollView style={{backgroundColor:p.bg}} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled"><Card><Label>Đổi mật khẩu cá nhân</Label>
    {!done&&<><Input accessibilityLabel="Mật khẩu hiện tại" placeholder="Mật khẩu hiện tại" secureTextEntry value={current} onChangeText={setCurrent}/><Input accessibilityLabel="Mật khẩu mới" placeholder="Mật khẩu mới (ít nhất 8 ký tự)" secureTextEntry value={next} onChangeText={setNext}/><Input accessibilityLabel="Xác nhận mật khẩu mới" placeholder="Nhập lại mật khẩu mới" secureTextEntry value={confirm} onChangeText={setConfirm}/></>}
    <LoadingBar active={busy}/>{!!message&&<Text accessibilityRole="alert" style={{color:p.text}}>{message}</Text>}
    {done?<Button title="Đăng nhập lại" onPress={()=>void signOut()}/>:<Button title="Lưu mật khẩu" onPress={()=>void submit()} disabled={busy||!current||next.length<8||!confirm}/>}
  </Card></ScrollView>;
}
