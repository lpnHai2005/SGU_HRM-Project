import React from 'react';

export interface CustomTooltipItem {
  name?: string;
  value?: number | string;
  color?: string;
  unit?: string;
}

export interface CustomChartTooltipProps {
  active?: boolean;
  payload?: any[];
  label?: string;
  formatter?: (val: any, name?: string, item?: any) => string;
}

export const CustomChartTooltip: React.FC<CustomChartTooltipProps> = ({
  active,
  payload,
  label,
  formatter,
}) => {
  if (!active || !payload || !payload.length) return null;

  return (
    <div
      style={{
        backgroundColor: 'var(--bg-surface, #ffffff)',
        border: '1px solid var(--border-default, #e2e8f0)',
        borderRadius: '8px',
        padding: '10px 14px',
        boxShadow: '0 8px 24px rgba(0, 0, 0, 0.12)',
        fontSize: '12px',
        minWidth: '160px',
        backdropFilter: 'blur(8px)',
      }}
    >
      {label && (
        <div
          style={{
            fontWeight: 600,
            color: 'var(--text-primary, #0f172a)',
            marginBottom: '8px',
            borderBottom: '1px solid var(--border-subtle, #f1f5f9)',
            paddingBottom: '4px',
          }}
        >
          {label}
        </div>
      )}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
        {payload.map((item, index) => {
          const formattedValue = formatter
            ? formatter(item.value, item.name, item)
            : typeof item.value === 'number'
            ? item.value.toLocaleString('vi-VN')
            : item.value;

          return (
            <div
              key={`item-${index}`}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: '12px',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span
                  style={{
                    width: '8px',
                    height: '8px',
                    borderRadius: '50%',
                    backgroundColor: item.color || item.fill || '#2563eb',
                    display: 'inline-block',
                  }}
                />
                <span style={{ color: 'var(--text-secondary, #64748b)' }}>
                  {item.name}
                </span>
              </div>
              <span
                style={{
                  fontWeight: 600,
                  color: 'var(--text-primary, #0f172a)',
                  fontFamily: 'ui-monospace, monospace',
                }}
              >
                {formattedValue}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
};
