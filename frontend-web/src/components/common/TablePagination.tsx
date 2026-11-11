import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { Icons } from './Icons'
import './TablePagination.css'

interface TablePaginationProps {
  page: number
  pageSize: number
  total: number
  onPageChange: (page: number) => void
  onPageSizeChange: (pageSize: number) => void
}

export function TablePagination({ page, pageSize, total, onPageChange, onPageSizeChange }: TablePaginationProps) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  const [jumpPage, setJumpPage] = useState(String(page))

  useEffect(() => {
    setJumpPage(String(page))
  }, [page])

  const goTo = (target: number) => {
    const next = Math.min(Math.max(1, target), totalPages)
    if (next !== page) {
      onPageChange(next)
      try { window.scrollTo({ top: 0, behavior: 'smooth' }) } catch {}
    }
  }

  const handleJumpSubmit = (e?: FormEvent) => {
    if (e) e.preventDefault()
    const parsed = parseInt(jumpPage, 10)
    if (isNaN(parsed)) {
      setJumpPage(String(page))
      return
    }
    const valid = Math.min(Math.max(1, parsed), totalPages)
    setJumpPage(String(valid))
    goTo(valid)
  }

  return (
    <div className="audit-pagination-bar">
      <div className="audit-pagination-info">
        <span>
          {total > 0 ? (
            <>
              Hiển thị <strong>{(page - 1) * pageSize + 1}</strong> – <strong>{Math.min(page * pageSize, total)}</strong> trong <strong>{total.toLocaleString('vi-VN')}</strong> bản ghi
            </>
          ) : (
            <span>Không có bản ghi nào</span>
          )}
        </span>
        <label className="audit-page-size-selector">
          <span>Dòng/trang:</span>
          <select
            className="audit-page-size-select"
            value={pageSize}
            onChange={e => onPageSizeChange(Number(e.target.value))}
          >
            <option value={10}>10</option>
            <option value={20}>20</option>
            <option value={50}>50</option>
            <option value={100}>100</option>
          </select>
        </label>
      </div>

      <div className="audit-pagination-controls">
        <button className="pagination-btn" onClick={() => goTo(1)} disabled={page <= 1} type="button" title="Trang đầu" aria-label="Trang đầu">
          {Icons.chevronsLeft}
        </button>
        <button className="pagination-btn" onClick={() => goTo(page - 1)} disabled={page <= 1} type="button" title="Trang trước" aria-label="Trang trước">
          {Icons.chevronLeft}
        </button>

        <form className="pagination-jump-box" onSubmit={handleJumpSubmit}>
          <span>Trang</span>
          <div className="pagination-input-wrap">
            <input
              type="number"
              min={1}
              max={totalPages}
              value={jumpPage}
              onChange={e => setJumpPage(e.target.value)}
              onBlur={() => handleJumpSubmit()}
              className="pagination-input"
              aria-label="Nhập trang cần tới"
              title="Nhập số trang và nhấn Enter hoặc icon kính lúp để chuyển trang"
            />
            <button type="submit" className="pagination-search-btn" title="Đi tới trang" aria-label="Đi tới trang">
              {Icons.search}
            </button>
          </div>
          <span>/ {totalPages}</span>
        </form>

        <button className="pagination-btn" onClick={() => goTo(page + 1)} disabled={page >= totalPages} type="button" title="Trang sau" aria-label="Trang sau">
          {Icons.chevronRight}
        </button>
        <button className="pagination-btn" onClick={() => goTo(totalPages)} disabled={page >= totalPages} type="button" title="Trang cuối" aria-label="Trang cuối">
          {Icons.chevronsRight}
        </button>
      </div>
    </div>
  )
}

/** Phân trang danh sách đã có sẵn ở trình duyệt. Đổi resetKey (bộ lọc) thì về trang 1. */
export function useClientPagination<T>(items: T[], resetKey: string, defaultPageSize = 20) {
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(defaultPageSize)

  useEffect(() => {
    setPage(1)
  }, [resetKey])

  // Danh sách có thể ngắn đi sau khi duyệt hoặc hủy đơn: không để kẹt ở trang rỗng.
  const currentPage = Math.min(page, Math.max(1, Math.ceil(items.length / pageSize)))
  const pageItems = useMemo(
    () => items.slice((currentPage - 1) * pageSize, currentPage * pageSize),
    [items, currentPage, pageSize],
  )

  return {
    pageItems,
    paginationProps: {
      page: currentPage,
      pageSize,
      total: items.length,
      onPageChange: setPage,
      onPageSizeChange: (size: number) => {
        setPageSize(size)
        setPage(1)
      },
    },
  }
}
