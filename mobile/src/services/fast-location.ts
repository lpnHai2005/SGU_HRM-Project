import type { LocationObject } from 'expo-location';

// The fast path has a 500 ms budget; it never relaxes freshness/accuracy checks.
export async function fastLocation(
  cached: () => Promise<LocationObject | null>,
  current: () => Promise<LocationObject>,
  accept: (position: LocationObject) => boolean,
): Promise<LocationObject> {
  let cacheTimer: ReturnType<typeof setTimeout> | undefined;
  const known = await Promise.race([
    Promise.resolve().then(cached).catch(() => null),
    new Promise<null>(resolve => { cacheTimer = setTimeout(() => resolve(null), 500); }),
  ]).finally(() => clearTimeout(cacheTimer));
  if (known && Date.now() - known.timestamp >= 0 && Date.now() - known.timestamp <= 1500 && accept(known)) return known;
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    current(),
    new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('GPS chưa có vị trí đủ chính xác. Ra nơi thoáng và thử lại.')), 20000); }),
  ]).finally(() => clearTimeout(timer));
}
