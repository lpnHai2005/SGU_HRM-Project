import { useState, useRef, type DragEvent, type ChangeEvent } from 'react'
import { Icons } from '../components/common/Icons'
import { payrollApi } from '../services/api'
import type { PayrollImportPreviewResponse } from '../types'
import { formatCurrency } from '../utils/formatters'
import { toast } from 'sonner'
import './PayrollImportDialog.css'

interface PayrollImportDialogProps {
  period: string
  onClose: () => void
  onSuccess: () => Promise<void> | void
}

export function PayrollImportDialog({ period, onClose, onSuccess }: PayrollImportDialogProps) {
  const [file, setFile] = useState<File | null>(null)
  const [previewData, setPreviewData] = useState<PayrollImportPreviewResponse | null>(null)
  const [loadingPreview, setLoadingPreview] = useState(false)
  const [loadingConfirm, setLoadingConfirm] = useState(false)
  const [downloadingTemplate, setDownloadingTemplate] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [isStaleStamp, setIsStaleStamp] = useState(false)
  const [isDragging, setIsDragging] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const handleDownloadTemplate = async () => {
    try {
      setDownloadingTemplate(true)
      const blob = await payrollApi.downloadImportTemplate(period)
      const url = window.URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `Mau_Cham_Cong_TechZone_${period}.xlsx`
      document.body.appendChild(a)
      a.click()
      a.remove()
      window.URL.revokeObjectURL(url)
      toast.success(`Đã tải file mẫu kỳ ${period} thành công!`)
      if (isStaleStamp) {
        setIsStaleStamp(false)
        setErrorMessage(null)
      }
    } catch (err: any) {
      toast.error(`Không thể tải file mẫu: ${err.message || 'Lỗi server'}`)
    } finally {
      setDownloadingTemplate(false)
    }
  }

  const handleFileProcess = async (selectedFile: File) => {
    setErrorMessage(null)
    setIsStaleStamp(false)

    if (!selectedFile.name.toLowerCase().endsWith('.xlsx')) {
      setErrorMessage('Chỉ chấp nhận file định dạng Excel .xlsx')
      return
    }

    if (selectedFile.size > 10 * 1024 * 1024) {
      setErrorMessage('Dung lượng file vượt quá giới hạn cho phép (tối đa 10 MB)')
      return
    }

    setFile(selectedFile)
    setLoadingPreview(true)
    setPreviewData(null)

    try {
      const data = await payrollApi.previewImport(period, selectedFile)
      setPreviewData(data)
    } catch (err: any) {
      setErrorMessage(err.message || 'Không thể xem trước dữ liệu import.')
    } finally {
      setLoadingPreview(false)
    }
  }

  const handleDragOver = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    setIsDragging(true)
  }

  const handleDragLeave = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    setIsDragging(false)
  }

  const handleDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    setIsDragging(false)
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      void handleFileProcess(e.dataTransfer.files[0])
    }
  }

  const handleFileInputChange = (e: ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      void handleFileProcess(e.target.files[0])
    }
  }

  const handleConfirm = async () => {
    if (!previewData || !file) return

    setLoadingConfirm(true)
    setErrorMessage(null)

    try {
      const res = await payrollApi.confirmImport({
        salary_period: period,
        file_name: previewData.file_name,
        template_stamp: previewData.template_stamp,
        records: previewData.records,
      })
      toast.success(res.message || 'Đã nạp dữ liệu bảng lương thành công!')
      await onSuccess()
      onClose()
    } catch (err: any) {
      const msg = err.message || 'Lỗi nạp dữ liệu'
      setErrorMessage(msg)
      if (err.status === 409 || msg.includes('mốc dữ liệu') || msg.includes('thay đổi sau khi') || msg.includes('stale')) {
        setIsStaleStamp(true)
      }
    } finally {
      setLoadingConfirm(false)
    }
  }

  const isBusy = loadingPreview || loadingConfirm || downloadingTemplate
  const canConfirm = previewData &&
    previewData.counts.invalid === 0 &&
    (previewData.counts.create + previewData.counts.update + previewData.counts.delete > 0) &&
    !isBusy

  return (
    <div className="modal-overlay no-print" onMouseDown={e => { if (e.target === e.currentTarget && !isBusy) onClose() }}>
      <div className="modal payroll-import-dialog" role="dialog" aria-modal="true" aria-labelledby="payroll-import-title">
        <header className="payroll-import-header">
          <div className="payroll-import-header-left">
            <span className="payroll-import-icon">{Icons.upload}</span>
            <div>
              <p>KỲ LƯƠNG {period}</p>
              <h2 id="payroll-import-title">Nhập bảng lương từ Excel</h2>
            </div>
          </div>
          <button type="button" className="btn btn-secondary btn-icon" onClick={onClose} disabled={isBusy} aria-label="Đóng">
            {Icons.close}
          </button>
        </header>

        <div className="payroll-import-body">
          {/* Step 1: Template & Upload */}
          <div className="payroll-import-step1">
            <div className="payroll-import-template-row">
              <div>
                <strong>Bước 1: Tải file mẫu hoặc chuẩn bị file</strong>
                <p style={{ margin: '4px 0 0', fontSize: '12px', color: 'var(--text-secondary)' }}>
                  File mẫu chứa danh sách nhân sự hiện tại của kỳ và công thức bảo vệ dữ liệu.
                </p>
              </div>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={handleDownloadTemplate}
                disabled={isBusy}
              >
                {Icons.download}
                <span>{downloadingTemplate ? 'Đang tải...' : 'Tải file mẫu (.xlsx)'}</span>
              </button>
            </div>

            <div
              className={`payroll-import-dropzone ${isDragging ? 'is-dragging' : ''}`}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept=".xlsx"
                style={{ display: 'none' }}
                onChange={handleFileInputChange}
              />
              <div className="payroll-import-dropzone-content">
                <span style={{ color: '#2563eb' }}>{Icons.upload}</span>
                <span>
                  <strong>Kéo thả file .xlsx vào đây</strong> hoặc bấm để chọn file từ máy
                </span>
                <span style={{ fontSize: '11px', color: 'var(--text-tertiary)' }}>
                  Dung lượng tối đa 10 MB. Hệ thống sẽ đọc dữ liệu từ dòng 4 trở đi.
                </span>
              </div>
            </div>

            {file && (
              <div className="payroll-import-file-selected">
                <div>
                  <strong>File đã chọn:</strong> {file.name} ({(file.size / 1024).toFixed(1)} KB)
                </div>
                {loadingPreview && <span style={{ color: '#2563eb' }}>Đang phân tích và đối soát...</span>}
              </div>
            )}
          </div>

          {/* Stale Stamp Alert */}
          {isStaleStamp && (
            <div className="payroll-import-alert-error" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <strong>Lệch mốc dữ liệu:</strong> Dữ liệu kỳ lương đã thay đổi sau khi bạn tải file mẫu. Vui lòng tải lại file mẫu mới nhất và cập nhật trước khi nạp.
              </div>
              <button
                type="button"
                className="btn btn-primary"
                onClick={handleDownloadTemplate}
                disabled={downloadingTemplate}
                style={{ flexShrink: 0 }}
              >
                {Icons.download}
                <span>Tải file mẫu mới</span>
              </button>
            </div>
          )}

          {/* General Error Alert */}
          {errorMessage && !isStaleStamp && (
            <div className="payroll-import-alert-error">
              <span>{Icons.alertTriangle}</span>
              <span>{errorMessage}</span>
            </div>
          )}

          {/* Step 2: Preview & Diff */}
          {previewData && (
            <>
              {/* Metric Counts */}
              <div className="payroll-import-counts">
                <div className="payroll-import-count-card count-create">
                  <span>Thêm mới</span>
                  <strong>{previewData.counts.create}</strong>
                </div>
                <div className="payroll-import-count-card count-update">
                  <span>Cập nhật</span>
                  <strong>{previewData.counts.update}</strong>
                </div>
                <div className="payroll-import-count-card count-delete">
                  <span>Hủy bỏ</span>
                  <strong>{previewData.counts.delete}</strong>
                </div>
                <div className="payroll-import-count-card count-unchanged">
                  <span>Không đổi</span>
                  <strong>{previewData.counts.unchanged}</strong>
                </div>
                <div className="payroll-import-count-card count-invalid">
                  <span>Lỗi</span>
                  <strong>{previewData.counts.invalid}</strong>
                </div>
                <div className="payroll-import-count-card count-warnings">
                  <span>Cảnh báo</span>
                  <strong>{previewData.counts.warnings}</strong>
                </div>
              </div>

              {/* Warnings List */}
              {previewData.warnings.length > 0 && (
                <div className="payroll-import-alert-warning">
                  <strong>Cảnh báo ({previewData.warnings.length}):</strong>
                  <ul style={{ margin: 0, paddingLeft: '18px' }}>
                    {previewData.warnings.map((w, idx) => (
                      <li key={idx}>
                        Dòng {w.row}{w.employee_code ? ` (${w.employee_code})` : ''} - [{w.field}]: {w.reason}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Errors Table */}
              {previewData.errors.length > 0 && (
                <div>
                  <h4 style={{ margin: '0 0 8px', color: '#dc2626', fontSize: '13px' }}>
                    Danh sách lỗi cần sửa ({previewData.errors.length}):
                  </h4>
                  <div className="payroll-import-table-wrapper" style={{ borderColor: '#fca5a5' }}>
                    <table className="payroll-import-table">
                      <thead>
                        <tr>
                          <th>Dòng</th>
                          <th>Mã NV</th>
                          <th>Trường</th>
                          <th>Lý do</th>
                        </tr>
                      </thead>
                      <tbody>
                        {previewData.errors.map((err, idx) => (
                          <tr key={idx} style={{ background: '#fef2f2' }}>
                            <td style={{ fontWeight: 600 }}>{err.row}</td>
                            <td>{err.employee_code || '—'}</td>
                            <td><code>{err.field}</code></td>
                            <td style={{ color: '#991b1b' }}>{err.reason}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* Changes Table */}
              {previewData.changes.length > 0 && (
                <div>
                  <h4 style={{ margin: '0 0 8px', fontSize: '13px' }}>
                    Chi tiết các dòng có thay đổi ({previewData.changes.length}):
                  </h4>
                  <div className="payroll-import-table-wrapper">
                    <table className="payroll-import-table">
                      <thead>
                        <tr>
                          <th>Hành động</th>
                          <th>Dòng</th>
                          <th>Mã NV</th>
                          <th>Họ và tên</th>
                          <th>Công TT</th>
                          <th>Nghỉ phép</th>
                          <th>Khoản bổ sung (M/N/O/P)</th>
                          <th>Thực lĩnh trước → sau</th>
                          <th>Chênh lệch</th>
                        </tr>
                      </thead>
                      <tbody>
                        {previewData.changes.map((item, idx) => {
                          const befNet = item.before?.net_salary ?? 0
                          const aftNet = item.after?.net_salary ?? 0
                          const diff = item.net_diff ?? (aftNet - befNet)

                          const befWork = item.before?.actual_working_days != null ? item.before.actual_working_days : '—'
                          const aftWork = item.after?.actual_working_days != null ? item.after.actual_working_days : '—'

                          const befLeave = item.before?.paid_leave_days != null ? item.before.paid_leave_days : '—'
                          const aftLeave = item.after?.paid_leave_days != null ? item.after.paid_leave_days : '—'

                          const comm = item.after?.extra_commission ?? 0
                          const bonus = item.after?.extra_bonus ?? 0
                          const allow = item.after?.extra_allowance ?? 0
                          const pen = item.after?.extra_penalty ?? 0
                          const mpParts = []
                          if (comm > 0) mpParts.push(`HH: +${formatCurrency(comm)}`)
                          if (bonus > 0) mpParts.push(`Thưởng: +${formatCurrency(bonus)}`)
                          if (allow > 0) mpParts.push(`PC: +${formatCurrency(allow)}`)
                          if (pen > 0) mpParts.push(`Phạt: -${formatCurrency(pen)}`)

                          return (
                            <tr key={idx}>
                              <td>
                                <span className={`badge-action badge-${item.action}`}>{item.action}</span>
                              </td>
                              <td>{item.row}</td>
                              <td style={{ fontWeight: 600 }}>{item.employee_code}</td>
                              <td>{item.employee_name || '—'}</td>
                              <td>{befWork} → <strong>{aftWork}</strong></td>
                              <td>{befLeave} → <strong>{aftLeave}</strong></td>
                              <td style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>
                                {mpParts.length > 0 ? mpParts.join(', ') : '0'}
                              </td>
                              <td>{formatCurrency(befNet)} → <strong>{formatCurrency(aftNet)}</strong></td>
                              <td style={{ fontWeight: 600, color: diff > 0 ? '#16a34a' : diff < 0 ? '#dc2626' : 'var(--text-secondary)' }}>
                                {diff > 0 ? `+${formatCurrency(diff)}` : formatCurrency(diff)}
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* Fixed Notice */}
              <div className="payroll-import-notice">
                <strong>Lưu ý quan trọng:</strong> Nhân viên được nhập Công thực tế sẽ được cố định công theo file, không tự cập nhật khi chấm công máy thay đổi, cho tới khi <em>Khôi phục chấm công gốc</em> hoặc xóa trắng dòng đó và nạp lại.
              </div>

              {/* Totals Summary */}
              <div className="payroll-import-totals-grid">
                <div className="payroll-import-total-box">
                  <h4>Các NV có thay đổi ({previewData.changes.length})</h4>
                  <div className="payroll-import-total-row">
                    <span>Tổng chênh lệch thực lĩnh:</span>
                    <strong style={{
                      color: (previewData.totals_after.net - previewData.totals_before.net) >= 0 ? '#16a34a' : '#dc2626'
                    }}>
                      {(previewData.totals_after.net - previewData.totals_before.net) >= 0 ? '+' : ''}
                      {formatCurrency(previewData.totals_after.net - previewData.totals_before.net)}
                    </strong>
                  </div>
                  <div className="payroll-import-total-row">
                    <span>Tổng chênh lệch thu nhập (Gross):</span>
                    <strong>{formatCurrency(previewData.totals_after.gross - previewData.totals_before.gross)}</strong>
                  </div>
                </div>

                <div className="payroll-import-total-box">
                  <h4>Toàn kỳ lương {period} (Dự kiến sau nạp)</h4>
                  <div className="payroll-import-total-row">
                    <span>Tổng thu nhập (Gross):</span>
                    <strong>{formatCurrency(previewData.totals_after.gross)}</strong>
                  </div>
                  <div className="payroll-import-total-row">
                    <span>Tổng thực lĩnh (Net):</span>
                    <strong style={{ color: '#2563eb' }}>{formatCurrency(previewData.totals_after.net)}</strong>
                  </div>
                  <div className="payroll-import-total-row">
                    <span>Tổng bảo hiểm:</span>
                    <strong>{formatCurrency(previewData.totals_after.insurance)}</strong>
                  </div>
                </div>
              </div>
            </>
          )}
        </div>

        <footer className="modal-footer">
          <button type="button" className="btn btn-secondary" onClick={onClose} disabled={isBusy}>
            Hủy
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={handleConfirm}
            disabled={!canConfirm}
            title={
              !previewData ? 'Vui lòng chọn file để xem trước' :
              previewData.counts.invalid > 0 ? 'Cần sửa hết các dòng lỗi trước khi nạp' :
              (previewData.counts.create + previewData.counts.update + previewData.counts.delete === 0) ? 'Không có thay đổi nào để nạp' :
              'Xác nhận ghi đè và tính lại bảng lương'
            }
          >
            {loadingConfirm ? 'Đang nạp...' : 'Xác nhận nạp'}
          </button>
        </footer>
      </div>
    </div>
  )
}

