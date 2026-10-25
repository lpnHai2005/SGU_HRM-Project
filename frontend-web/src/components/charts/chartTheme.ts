// ==============================================================================
// CHART THEME & COLOR PALETTE FOR TECHZONE HRM DASHBOARD
// Bảng màu & công cụ định dạng chuẩn cho Recharts (đồng bộ Dark/Light theme)
// ==============================================================================

export const CHART_COLORS = {
  primary: '#2563eb',     // Blue 600
  primaryLight: '#60a5fa',// Blue 400
  navy: '#1e3a8a',        // TechZone Navy
  success: '#10b981',    // Emerald 500
  successLight: '#34d399',
  warning: '#f59e0b',    // Amber 500
  warningLight: '#fbbf24',
  error: '#ef4444',      // Red 500
  purple: '#8b5cf6',     // Violet 500
  indigo: '#6366f1',     // Indigo 500
  teal: '#14b8a6',       // Teal 500
  orange: '#f97316',     // Orange 500
  gray: '#94a3b8',       // Slate 400
};

// Chuỗi màu sắc cho các biểu đồ phân loại (Pie/Bar series)
export const PALETTE_CATEGORIES = [
  '#2563eb', // Blue
  '#10b981', // Green
  '#f59e0b', // Amber
  '#8b5cf6', // Violet
  '#ec4899', // Pink
  '#06b6d4', // Cyan
  '#f97316', // Orange
  '#64748b', // Slate
];

// Định dạng số tiền VNĐ ngắn gọn cho biểu đồ (ví dụ: 120.5 tr, 1.2 tỷ)
export function formatChartCurrency(value: number): string {
  if (value === 0 || !value) return '0 đ';
  if (Math.abs(value) >= 1_000_000_000) {
    return `${(value / 1_000_000_000).toFixed(1)} tỷ`;
  }
  if (Math.abs(value) >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(1)} tr`;
  }
  if (Math.abs(value) >= 1_000) {
    return `${(value / 1_000).toFixed(0)} k`;
  }
  return `${value.toLocaleString('vi-VN')} đ`;
}

// Định dạng tiền tệ đầy đủ
export function formatFullCurrency(value: number): string {
  return `${Math.round(value || 0).toLocaleString('vi-VN')} đ`;
}

// Định dạng số nguyên
export function formatChartNumber(value: number): string {
  return (value || 0).toLocaleString('vi-VN');
}
