import { Component, type ErrorInfo, type ReactNode } from 'react'

interface Props {
  children: ReactNode
  fallback?: ReactNode
}

interface State {
  hasError: boolean
  error: Error | null
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
  }

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error }
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('[ErrorBoundary] Caught render error:', error, errorInfo)
  }

  public render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback
      return (
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          minHeight: '60vh',
          padding: '2rem',
          textAlign: 'center',
          gap: '1rem',
        }}>
          <div style={{
            fontSize: '48px',
            lineHeight: 1,
            color: 'var(--color-danger, #ef4444)',
          }}>
            ⚠️
          </div>
          <h2 style={{ fontSize: '1.25rem', fontWeight: 600, margin: 0 }}>
            Đã xảy ra lỗi khi hiển thị trang
          </h2>
          <p style={{ color: 'var(--text-secondary, #64748b)', maxWidth: '500px', fontSize: '0.875rem', margin: 0 }}>
            {this.state.error?.message || 'Có lỗi không mong muốn đã xảy ra trong quá trình kết xuất giao diện.'}
          </p>
          <div style={{ display: 'flex', gap: '0.75rem', marginTop: '0.5rem' }}>
            <button
              className="btn btn-secondary"
              onClick={() => this.setState({ hasError: false, error: null })}
              type="button"
            >
              Thử lại
            </button>
            <button
              className="btn btn-primary"
              onClick={() => { window.location.href = '/' }}
              type="button"
            >
              Về trang chủ
            </button>
          </div>
        </div>
      )
    }

    return this.props.children
  }
}
