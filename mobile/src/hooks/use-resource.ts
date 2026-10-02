import { useCallback, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { useSession } from '@/contexts/session';
import { ApiError, request } from '@/services/attendance';
export function useResource<T>(path: string | null) {
  const { token, signOut } = useSession();
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [version, setVersion] = useState(0);
  useFocusEffect(useCallback(() => {
    if (!token || !path) return;
    let active = true;
    setLoading(true); setError(''); setData(null);
    const revision = version; // Every explicit refresh gets its own effect lifetime.
    request<T>(path, token).then(value => { if (active && revision === version) setData(value); }).catch(e => {
      if (active) setError(e instanceof Error ? e.message : 'Không tải được dữ liệu.');
      if (e instanceof ApiError && e.status === 401) void signOut();
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [path, token, signOut, version]));
  return { data, loading, error, reload: () => setVersion(v => v + 1) };
}
