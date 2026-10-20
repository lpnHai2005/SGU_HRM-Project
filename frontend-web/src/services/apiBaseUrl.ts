const isLoopbackHost = (hostname: string): boolean => {
  const normalized = hostname.toLowerCase().replace(/^\[|\]$/g, '')
  return normalized === 'localhost' || normalized === '127.0.0.1' || normalized === '::1'
}

export function resolveApiBaseUrl(
  configuredBaseUrl: string | undefined,
  pageHostname: string,
  isDevelopment: boolean,
): string {
  const configured = configuredBaseUrl?.trim()
  if (!configured) return '/api/v1'

  try {
    const targetHostname = new URL(configured, 'http://localhost').hostname
    // A phone's localhost is the phone itself. In local development, route
    // loopback API URLs through Vite when the page is opened from another host.
    if (isDevelopment && isLoopbackHost(targetHostname)
      && targetHostname.toLowerCase() !== pageHostname.toLowerCase()) {
      return '/api/v1'
    }
  } catch {
    // Preserve the configured value so existing URL validation still reports bad config.
  }

  return configured
}
