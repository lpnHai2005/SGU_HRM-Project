import React, { useState, useMemo } from 'react';

export interface DrilldownColumn {
  key: string;
  title: string;
  width?: string;
  align?: 'left' | 'center' | 'right';
  render?: (row: any) => React.ReactNode;
}

export interface ReportDrilldownModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  tag?: string;
  columns: DrilldownColumn[];
  data: any[];
}

export const ReportDrilldownModal: React.FC<ReportDrilldownModalProps> = ({
  isOpen,
  onClose,
  title,
  subtitle,
  tag,
  columns,
  data,
}) => {
  const [searchTerm, setSearchTerm] = useState('');

  // Lọc dữ liệu theo từ khóa tìm kiếm
  const filteredData = useMemo(() => {
    if (!searchTerm.trim()) return data;
    const term = searchTerm.toLowerCase();
    return data.filter((row) => {
      return Object.values(row).some((val) =>
        String(val || '').toLowerCase().includes(term)
      );
    });
  }, [data, searchTerm]);

  if (!isOpen) return null;

  return (
    <div
      className="modal-overlay"
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(15, 23, 42, 0.65)',
        backdropFilter: 'blur(4px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
        padding: '20px',
      }}
      onClick={onClose}
    >
      <div
        className="modal-content"
        style={{
          backgroundColor: 'var(--bg-surface, #ffffff)',
          borderRadius: '12px',
          width: '100%',
          maxWidth: '900px',
          maxHeight: '85vh',
          display: 'flex',
          flexDirection: 'column',
          boxShadow: '0 20px 40px rgba(0, 0, 0, 0.2)',
          border: '1px solid var(--border-default, #e2e8f0)',
          overflow: 'hidden',
          animation: 'fadeIn 0.2s ease-out',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header Modal */}
        <div
          style={{
            padding: '16px 20px',
            borderBottom: '1px solid var(--border-subtle, #f1f5f9)',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'flex-start',
            backgroundColor: 'var(--bg-subtle, #f8fafc)',
          }}
        >
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <h3 style={{ margin: 0, fontSize: '17px', fontWeight: 700, color: 'var(--text-primary, #0f172a)' }}>
                {title}
              </h3>
              {tag && (
                <span className="badge badge-primary" style={{ fontSize: '11px', padding: '2px 8px' }}>
                  {tag}
                </span>
              )}
            </div>
            {subtitle && (
              <p style={{ margin: '4px 0 0 0', fontSize: '12.5px', color: 'var(--text-secondary, #64748b)' }}>
                {subtitle}
              </p>
            )}
          </div>
          <button
            onClick={onClose}
            style={{
              background: 'none',
              border: 'none',
              fontSize: '20px',
              cursor: 'pointer',
              color: 'var(--text-tertiary, #94a3b8)',
              padding: '4px',
              borderRadius: '4px',
              lineHeight: 1,
            }}
            title="Đóng (Esc)"
          >
            ✕
          </button>
        </div>

        {/* Thanh tìm kiếm & thống kê */}
        <div
          style={{
            padding: '12px 20px',
            borderBottom: '1px solid var(--border-subtle, #f1f5f9)',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: '12px',
          }}
        >
          <div style={{ position: 'relative', flex: 1, maxWidth: '320px' }}>
            <input
              type="text"
              className="form-control"
              placeholder="Tìm theo tên, mã NV, chi nhánh..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              style={{
                width: '100%',
                fontSize: '12.5px',
                padding: '6px 12px',
                borderRadius: '6px',
                border: '1px solid var(--border-default, #cbd5e1)',
              }}
            />
          </div>
          <span style={{ fontSize: '12px', color: 'var(--text-secondary, #64748b)' }}>
            Hiển thị <strong>{filteredData.length}</strong> / {data.length} bản ghi chi tiết
          </span>
        </div>

        {/* Bảng dữ liệu chi tiết */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '0 20px' }}>
          {filteredData.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--text-tertiary, #94a3b8)' }}>
              Không tìm thấy bản ghi chi tiết phù hợp
            </div>
          ) : (
            <table className="table data-table" style={{ width: '100%', fontSize: '12.5px', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: '2px solid var(--border-subtle, #e2e8f0)', position: 'sticky', top: 0, backgroundColor: 'var(--bg-surface, #ffffff)', zIndex: 1 }}>
                  <th style={{ width: '40px', textAlign: 'center', padding: '10px 8px' }}>STT</th>
                  {columns.map((col) => (
                    <th
                      key={col.key}
                      style={{
                        width: col.width,
                        textAlign: col.align || 'left',
                        padding: '10px 8px',
                        fontWeight: 600,
                        color: 'var(--text-secondary, #475569)',
                      }}
                    >
                      {col.title}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filteredData.map((row, idx) => (
                  <tr
                    key={row.id || row.request_id || row.attendance_id || row.employee_id || idx}
                    style={{
                      borderBottom: '1px solid var(--border-subtle, #f1f5f9)',
                      transition: 'background-color 0.15s ease',
                    }}
                    onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = 'var(--bg-subtle, #f8fafc)')}
                    onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
                  >
                    <td style={{ textAlign: 'center', padding: '10px 8px', color: 'var(--text-tertiary, #94a3b8)' }}>
                      {idx + 1}
                    </td>
                    {columns.map((col) => (
                      <td
                        key={col.key}
                        style={{
                          textAlign: col.align || 'left',
                          padding: '10px 8px',
                          verticalAlign: 'middle',
                        }}
                      >
                        {col.render ? col.render(row) : row[col.key] || '—'}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* Footer Modal */}
        <div
          style={{
            padding: '12px 20px',
            borderTop: '1px solid var(--border-subtle, #f1f5f9)',
            display: 'flex',
            justifyContent: 'flex-end',
            backgroundColor: 'var(--bg-subtle, #f8fafc)',
          }}
        >
          <button className="btn btn-secondary btn-sm" onClick={onClose} style={{ padding: '6px 16px' }}>
            Đóng
          </button>
        </div>
      </div>
    </div>
  );
};
