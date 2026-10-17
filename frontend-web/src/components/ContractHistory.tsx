/**
 * Contract History Component
 * Hiển thị lịch sử hợp đồng của một nhân viên với chuẩn giao diện Vero Design System (hỗ trợ Dark Mode)
 */
import { useState, useEffect } from 'react'
import { contractApi } from '../services/contractService'
import {
  type Contract,
  CONTRACT_STATUS_LABELS,
  getContractStatusClass,
  getContractTypeLabel,
} from '../types/contract'
import { formatDate, formatCurrency } from '../utils/formatters'
import { Icons } from './common/Icons'

export interface ContractHistoryProps {
  employeeId: number
  canSeeSalary?: boolean
}

export function ContractHistory({ employeeId, canSeeSalary = false }: ContractHistoryProps) {
  const [contracts, setContracts] = useState<Contract[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetchHistory()
  }, [employeeId])

  const fetchHistory = async () => {
    setLoading(true)
    try {
      const data = await contractApi.getEmployeeHistory(employeeId)
      setContracts(data || [])
    } catch (err) {
      console.error('Error fetching contract history:', err)
    } finally {
      setLoading(false)
    }
  }

  if (loading) {
    return (
      <div style={{ padding: '24px', textAlign: 'center', color: 'var(--text-secondary)', fontSize: '13px' }}>
        <div style={{ marginBottom: '8px' }}>{Icons.loader}</div>
        Đang tải lịch sử hợp đồng...
      </div>
    )
  }

  if (contracts.length === 0) {
    return (
      <div
        style={{
          padding: '24px 16px',
          textAlign: 'center',
          color: 'var(--text-tertiary)',
          background: 'var(--surface-subtle)',
          borderRadius: 'var(--radius-md)',
          border: '1px dashed var(--border-default)',
          fontSize: '13px',
        }}
      >
        Nhân viên chưa có hợp đồng lao động nào
      </div>
    )
  }

  return (
    <div className="contract-history" style={{ marginTop: '8px' }}>
      <h4 style={{ margin: '0 0 12px', fontSize: '14px', color: 'var(--text-secondary)' }}>
        LỊCH SỬ HỢP ĐỒNG ({contracts.length})
      </h4>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
        {contracts.map((contract) => {
          const isActive = contract.status === 'ACTIVE'
          const statusClass = getContractStatusClass(contract.status)
          return (
            <div
              key={contract.contract_id}
              style={{
                border: isActive
                  ? '1px solid rgba(16, 185, 129, 0.35)'
                  : '1px solid var(--border-default)',
                borderRadius: 'var(--radius-md)',
                padding: '14px 16px',
                background: 'var(--surface-subtle)',
                transition: 'all 0.2s ease',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '12px' }}>
                <div style={{ flex: 1 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px', flexWrap: 'wrap' }}>
                    <span
                      style={{
                        fontWeight: 600,
                        fontSize: '14px',
                        fontFamily: 'var(--font-mono)',
                        color: 'var(--text-primary)',
                      }}
                    >
                      {contract.contract_number}
                    </span>
                    {contract.previous_contract_id && (
                      <span
                        style={{
                          fontSize: '11px',
                          color: 'var(--text-tertiary)',
                          background: 'var(--surface-card)',
                          padding: '2px 8px',
                          borderRadius: 'var(--radius-xs)',
                          border: '1px solid var(--border-subtle)',
                        }}
                      >
                        Gia hạn từ {contract.previous_contract_number || `#${contract.previous_contract_id}`}
                      </span>
                    )}
                  </div>

                  <div style={{ fontSize: '13px', color: 'var(--text-secondary)', marginBottom: '6px' }}>
                    <span style={{ fontWeight: 500, color: 'var(--text-primary)' }}>
                      {getContractTypeLabel(contract.contract_type)}
                    </span>
                    {' · '}
                    <span>{formatDate(contract.start_date)}</span>
                    {' → '}
                    <span>{contract.end_date ? formatDate(contract.end_date) : 'Không xác định (Vô thời hạn)'}</span>
                  </div>

                  <div style={{ fontSize: '12px', color: 'var(--text-secondary)', display: 'flex', gap: '16px', flexWrap: 'wrap' }}>
                    {contract.position_name && (
                      <div>
                        Chức vụ: <strong style={{ color: 'var(--text-primary)' }}>{contract.position_name}</strong>
                      </div>
                    )}
                    {canSeeSalary && contract.basic_salary !== null && contract.basic_salary !== undefined && (
                      <div>
                        Lương: <strong style={{ color: 'var(--text-primary)' }}>{formatCurrency(contract.basic_salary)}</strong>
                      </div>
                    )}
                  </div>

                  {contract.termination_date && (
                    <div
                      style={{
                        fontSize: '12px',
                        color: 'var(--status-error)',
                        marginTop: '8px',
                        padding: '6px 10px',
                        background: 'var(--status-error-bg)',
                        borderRadius: 'var(--radius-xs)',
                        border: '1px solid var(--status-error-border)',
                      }}
                    >
                      <strong>Chấm dứt:</strong> {formatDate(contract.termination_date)}
                      {contract.termination_reason ? ` - ${contract.termination_reason}` : ''}
                    </div>
                  )}
                </div>

                <span className={`badge-status ${statusClass}`}>
                  {CONTRACT_STATUS_LABELS[contract.status] || contract.status}
                </span>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

export default ContractHistory
