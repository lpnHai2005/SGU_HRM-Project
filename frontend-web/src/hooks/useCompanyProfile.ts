import { useEffect, useState } from 'react'
import { reportApi } from '../services/api'

export interface CompanyProfile {
  name?: string | null
  tax_code?: string | null
  address?: string | null
  phone?: string | null
  email?: string | null
}

// Thông tin pháp nhân in trên biểu mẫu; chưa nhập thì các mục này để trống
export function useCompanyProfile(): CompanyProfile {
  const [company, setCompany] = useState<CompanyProfile>({})

  useEffect(() => {
    reportApi.getCompanyProfile().then(setCompany).catch(console.error)
  }, [])

  return company
}
