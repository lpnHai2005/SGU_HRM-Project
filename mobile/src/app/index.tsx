import { Redirect } from 'expo-router';
import { useSession } from '@/contexts/session';
export default function Index() {
  return <Redirect href={useSession().token ? '/(staff)' : '/login'} />;
}
