export type AddressParts = { street: string; ward: string; province: string }

export const EMPTY_ADDRESS: AddressParts = { street: '', ward: '', province: '' }

// Địa chỉ lưu dạng "số nhà đường, phường/xã, tỉnh/thành phố"; số nhà có thể trống hoặc chứa dấu phẩy
export const parseAddress = (value?: string | null): AddressParts => {
  const parts = (value || '').split(',').map(part => part.trim()).filter(Boolean)
  if (parts.length < 2) return { ...EMPTY_ADDRESS, street: parts.join(', ') }
  return { street: parts.slice(0, -2).join(', '), ward: parts[parts.length - 2], province: parts[parts.length - 1] }
}

export const composeAddress = (address: AddressParts) =>
  [address.street.trim(), address.ward, address.province].filter(Boolean).join(', ')
