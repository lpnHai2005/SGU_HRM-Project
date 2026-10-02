type Permission = { granted: boolean; canAskAgain: boolean };
type PermissionsApi = {
  getForegroundPermissionsAsync: () => Promise<Permission>;
  requestForegroundPermissionsAsync: () => Promise<Permission>;
};
export async function ensureLocationPermission(api: PermissionsApi): Promise<Permission> {
  const current = await api.getForegroundPermissionsAsync();
  if (current.granted || !current.canAskAgain) return current;
  return api.requestForegroundPermissionsAsync();
}
