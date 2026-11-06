import { useCallback, useEffect, useState } from 'react'
import { AlertTriangle, RefreshCw, ShieldAlert, ShieldCheck } from 'lucide-react'
import { disciplineApi } from '../../services/api'
import type { DisciplineOverview } from '../../types'

/**
 * Cảnh báo kỷ luật trên dashboard đối soát chấm công:
 * - Biên bản tự động khi ≥ 5 ngày trễ > 15 phút trong tháng.
 * - Cờ BLACK_LIST_WARNING khi có biên bản 3 tháng liên tiếp.
 */
export function DisciplineAlertPanel({ period, user }: { period: string; user: any }) {
  const roles: string[] = user?.roles || []
  const canView = roles.some(role => ['HR_MANAGER', 'DIRECTOR', 'ADMIN'].includes(role))
  const canDecide = roles.includes('HR_MANAGER') || roles.includes('DIRECTOR')
  const [data, setData] = useState<DisciplineOverview | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const load = useCallback(() => {
    if (!canView) return
    disciplineApi.overview(period)
      .then(result => { setData(result); setError('') })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : 'Không tải được dữ liệu kỷ luật.'))
  }, [canView, period])

  useEffect(() => { load() }, [load])

  if (!canView) return null

  const evaluate = async () => {
    setBusy(true)
    try {
      await disciplineApi.evaluate(period)
      load()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Không chạy được đánh giá kỷ luật.')
    } finally {
      setBusy(false)
    }
  }

  const clearFlag = async (employeeId: number, name: string) => {
    const reason = window.prompt(`Lý do gỡ cờ BLACK_LIST_WARNING cho ${name} (tối thiểu 3 ký tự):`)
    if (!reason || reason.trim().length < 3) return
    setBusy(true)
    try {
      await disciplineApi.clearBlacklist(employeeId, reason.trim())
      load()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Không gỡ được cờ cảnh báo.')
    } finally {
      setBusy(false)
    }
  }

  const records = data?.records || []
  const flagged = data?.blacklist_warnings || []
  const isSafe = records.length === 0 && flagged.length === 0

  return (
    <section
      className="card"
      style={{
        margin: '12px 0',
        padding: '12px 16px',
        borderLeft: isSafe
          ? '4px solid var(--status-success, #10b981)'
          : '4px solid var(--status-error, #ef4444)'
      }}
      aria-label="Cảnh báo kỷ luật đi trễ"
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
        <strong style={{ display: 'inline-flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          {isSafe ? (
            <ShieldCheck size={18} color="var(--status-success, #10b981)" />
          ) : (
            <ShieldAlert size={18} color="var(--status-error, #ef4444)" />
          )}
          <span>Kỷ luật đi trễ kỳ {period}:</span>
          <span className={`status-pill ${records.length === 0 ? 'active' : 'error'}`}>
            {records.length} biên bản
          </span>
          <span>·</span>
          <span className={`status-pill ${flagged.length === 0 ? 'active' : 'error'}`}>
            {flagged.length} cờ BLACK_LIST_WARNING
          </span>
        </strong>
        {canDecide && (
          <button type="button" className="btn btn-secondary btn-sm" onClick={evaluate} disabled={busy}
            title="Quét lại: ≥ 5 ngày trễ >15 phút → biên bản; 3 tháng liên tiếp → BLACK_LIST_WARNING">
            <RefreshCw size={14} /> Đánh giá lại
          </button>
        )}
      </div>
      {error && <p role="alert" className="text-danger" style={{ margin: '8px 0 0' }}>{error}</p>}

      {flagged.length > 0 && (
        <div role="alert" style={{ marginTop: 8 }}>
          {flagged.map(item => (
            <div key={item.employee_id} style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', padding: '4px 0' }}>
              <AlertTriangle size={14} color="#dc2626" />
              <span>
                <strong>[{item.employee_code}] {item.full_name}</strong> ({item.store_name || '—'}) — biên bản các kỳ:{' '}
                {(item.report_periods || []).slice(0, 3).join(', ')}. HR cần xem xét kỷ luật / không gia hạn hợp đồng.
              </span>
              {canDecide && (
                <button type="button" className="btn btn-secondary btn-sm" disabled={busy}
                  onClick={() => clearFlag(item.employee_id, item.full_name)}>
                  Gỡ cờ
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {records.length > 0 && (
        <p className="text-muted" style={{ margin: '8px 0 0', fontSize: 13 }}>
          Biên bản: {records.map(r => `${r.full_name} (${r.late_days} ngày${r.status === 'ACKNOWLEDGED' ? ', đã xác nhận' : ''})`).join('; ')}
        </p>
      )}
    </section>
  )
}
