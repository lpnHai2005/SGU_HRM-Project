import { useState, useEffect, useCallback } from 'react'
import { Icons } from '../components/common/Icons'
import { EmptyState } from '../components/common/EmptyState'
import { getInitials, getRoleFromUser } from '../utils/formatters'
import type { Employee } from '../types'

export interface EmployeeListPageProps {
  user: any
}

export function EmployeeListPage({ user }: EmployeeListPageProps) {
  const [employees, setEmployees] = useState<Employee[]>([])
  const [searchTerm, setSearchTerm] = useState('')
  const [filterStatus, setFilterStatus] = useState('all')
  const [isLoading, setIsLoading] = useState(true)

  const fetchEmployees = useCallback(async () => {
    setIsLoading(true)
    try {
      const { employeeApi } = await import('../services/api')
      const data = await employeeApi.getAll()
      setEmployees(data || [])
    } catch (err) {
      console.error('Error fetching employees from database:', err)
      setEmployees([])
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchEmployees()
  }, [fetchEmployees])

  const filteredEmployees = employees.filter(emp => {
    const matchesSearch =
      !searchTerm ||
      emp.full_name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      emp.employee_code?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      emp.phone?.includes(searchTerm)
    const matchesStatus =
      filterStatus === 'all' ||
      emp.employment_status?.toLowerCase() === filterStatus.toLowerCase()
    return matchesSearch && matchesStatus
  })

  const role = getRoleFromUser(user)

  return (
    <div className="page-container">
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h1 className="page-title">Hồ sơ Nhân sự</h1>
        </div>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          <button className="btn btn-secondary btn-sm" onClick={() => alert('Chế độ xem bảng đang kích hoạt')}>
            Bảng biểu
          </button>
          {(role === 'ADMIN' || role === 'HR_MANAGER') && (
            <button className="btn btn-primary btn-sm" onClick={() => alert('Mở biểu mẫu thêm nhân viên mới')}>
              {Icons.plus} Thêm nhân viên
            </button>
          )}
        </div>
      </div>

      <div className="card">
        <div className="card-header">
          <div style={{ display: 'flex', gap: '12px', alignItems: 'center', flex: 1, flexWrap: 'wrap' }}>
            <div className="search-box" style={{ flex: 1, minWidth: '220px' }}>
              <span className="search-icon">{Icons.search}</span>
              <input
                type="text"
                className="form-input"
                placeholder="Tìm kiếm họ tên, mã NV, số điện thoại..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
            </div>
            <select
              className="form-select"
              value={filterStatus}
              onChange={(e) => setFilterStatus(e.target.value)}
              style={{ width: 'auto', minWidth: '160px' }}
            >
              <option value="all">Tất cả trạng thái</option>
              <option value="ACTIVE">Đang làm việc</option>
              <option value="ON_LEAVE">Đang nghỉ phép</option>
              <option value="RESIGNED">Đã nghỉ việc</option>
            </select>
          </div>
        </div>

        {isLoading ? (
          <div className="card-body" style={{ textAlign: 'center', padding: '40px' }}>
            Đang tải dữ liệu nhân sự từ database...
          </div>
        ) : (
          <>
            <div className="table-container">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>NHÂN SỰ</th>
                    <th>MÃ NV</th>
                    <th>CHỨC VỤ</th>
                    <th>PHÒNG BAN / CHI NHÁNH</th>
                    <th>SỐ ĐIỆN THOẠI</th>
                    <th>TRẠNG THÁI</th>
                    <th>HIỆU SUẤT</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {filteredEmployees.length === 0 ? (
                    <tr>
                      <td colSpan={8} style={{ padding: '36px 16px', textAlign: 'center' }}>
                        <EmptyState
                          icon={Icons.users}
                          title="Không tìm thấy nhân sự nào"
                          description="Không có bản ghi nhân sự nào khớp với điều kiện tìm kiếm hoặc trong cơ sở dữ liệu."
                        />
                      </td>
                    </tr>
                  ) : (
                    filteredEmployees.map((emp, index) => {
                      const statusClass =
                        emp.employment_status === 'ACTIVE'
                          ? 'running'
                          : emp.employment_status === 'ON_LEAVE'
                          ? 'paused'
                          : 'rejected'
                      const statusText =
                        emp.employment_status === 'ACTIVE'
                          ? 'Đang làm việc'
                          : emp.employment_status === 'ON_LEAVE'
                          ? 'Nghỉ phép'
                          : emp.employment_status === 'RESIGNED'
                          ? 'Đã nghỉ việc'
                          : emp.employment_status || 'N/A'
                      const score = 85 + ((index * 3) % 14)

                      return (
                        <tr key={emp.employee_id}>
                          <td>
                            <div className="table-user-cell">
                              <div className="table-user-avatar">
                                {getInitials(emp.full_name)}
                              </div>
                              <div className="table-user-details">
                                <span className="table-user-name">
                                  {emp.full_name || `${emp.first_name} ${emp.last_name}`}
                                </span>
                                <span className="table-user-sub">
                                  {emp.company_email || emp.personal_email || '--'}
                                </span>
                              </div>
                            </div>
                          </td>
                          <td>
                            <span className="table-cell-mono">
                              {emp.employee_code || `NV-00${emp.employee_id}`}
                            </span>
                          </td>
                          <td>
                            <span style={{ fontSize: '12.5px', color: 'var(--text-secondary)' }}>
                              {emp.position_name || 'Nhân viên'}
                            </span>
                          </td>
                          <td>
                            <span style={{ fontSize: '12px' }}>
                              {emp.store_name || emp.department_name || 'Văn phòng chính'}
                            </span>
                          </td>
                          <td>
                            <span className="table-cell-mono">{emp.phone || '--'}</span>
                          </td>
                          <td>
                            <span className={`badge-status ${statusClass}`}>
                              {statusText}
                            </span>
                          </td>
                          <td>
                            <div className="table-score-wrapper">
                              <div className="table-score-line">
                                <div className="table-score-fill" style={{ width: `${score}%` }}></div>
                              </div>
                              <span className="table-score-val">{score}</span>
                            </div>
                          </td>
                          <td>
                            <button
                              className="btn btn-secondary btn-sm btn-icon"
                              title="Tùy chọn nhân sự"
                              onClick={() => alert(`Hồ sơ: ${emp.full_name} (${emp.employee_code})`)}
                            >
                              {Icons.moreVertical}
                            </button>
                          </td>
                        </tr>
                      )
                    })
                  )}
                </tbody>
              </table>
            </div>
            <div className="table-pagination">
              <span>Hiển thị {filteredEmployees.length} trên {employees.length} nhân sự</span>
              <div className="table-pagination-nav">
                <span className="table-pagination-link" onClick={() => alert('Trang 1')}>Trước</span>
                <span className="table-pagination-link" onClick={() => alert('Trang cuối')}>Tiếp</span>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
