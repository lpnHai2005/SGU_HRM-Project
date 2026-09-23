# TechZone HRM - Frontend

Hệ thống Quản lý Nhân sự (HRM) cho chuỗi cửa hàng TechZone.

## Công nghệ

- **Framework**: React 18 + TypeScript
- **Build Tool**: Vite
- **Styling**: CSS với CSS Variables
- **State Management**: React Context API
- **HTTP Client**: Fetch API (native)

## Cấu trúc thư mục

```
src/
├── api/              # API service layer (deprecated, use services/)
├── assets/           # Static assets (images, fonts)
├── components/       # Reusable UI components
├── contexts/         # React Context providers (Auth, App state)
├── pages/            # Page components
├── services/         # API service layer
│   └── api.ts        # Main API client & endpoints
├── types/            # TypeScript type definitions
│   └── index.ts      # Backend schema types
├── App.tsx           # Main application component
└── main.tsx          # Application entry point
```

## Cài đặt

```bash
# Cài đặt dependencies
npm install

# Chạy development server
npm run dev

# Build cho production
npm run build

# Preview production build
npm run preview
```

## Cấu hình Environment

Tạo file `.env` trong thư mục gốc:

```env
VITE_API_URL=http://localhost:8000/api/v1
```

## API Integration

Frontend được kết nối với Backend FastAPI qua các endpoints:

| Module | Endpoint | Mô tả |
|--------|----------|--------|
| Auth | `/auth/login` | Đăng nhập |
| | `/auth/me` | Lấy thông tin user hiện tại |
| | `/auth/logout` | Đăng xuất |
| | `/auth/test-accounts` | Danh sách tài khoản demo |
| Employees | `/employees` | Danh sách nhân viên |
| | `/employees/{id}` | Chi tiết nhân viên |
| | `/employees/metadata/lookups` | Danh mục tham chiếu |
| Attendances | `/attendances/check-in` | Check-in |
| | `/attendances/check-out` | Check-out |
| | `/attendances/my-history` | Lịch sử chấm công |
| Leaves | `/leaves` | Danh sách đơn nghỉ phép |
| | `/leaves/balances/me` | Số dư phép |
| | `/leaves/{id}/approve-store` | Duyệt cấp 1 |
| | `/leaves/{id}/approve-hr` | Duyệt cấp 2 |
| Payrolls | `/payrolls` | Danh sách phiếu lương |
| | `/payrolls/{id}` | Chi tiết phiếu lương |
| | `/payrolls/calculate` | Tính lương |
| Roles | `/roles` | Danh sách vai trò |
| | `/roles/matrix` | Ma trận phân quyền |
| Audit | `/audit-logs` | Nhật ký hoạt động |
| Health | `/health` | Kiểm tra kết nối |

## Tài khoản Demo

| Username | Password | Vai trò |
|----------|----------|---------|
| admin | 123456 | Quản trị viên |
| hr_manager | 123456 | Trưởng phòng Nhân sự |
| store_mgr_q1 | 123456 | Cửa hàng trưởng Q1 |
| staff_dung | 123456 | Nhân viên |
| tech_em | 123456 | Kỹ thuật viên |

## Vai trò & Quyền hạn

| Vai trò | Mô tả |
|---------|--------|
| ADMIN | Toàn quyền quản trị |
| HR_MANAGER | Quản lý nhân sự, duyệt nghỉ phép cấp 2, tính lương |
| STORE_MANAGER | Quản lý chi nhánh, duyệt nghỉ phép cấp 1 |
| EMPLOYEE | Nhân viên thông thường |

## Development Notes

### Authentication Flow
1. User đăng nhập → Server trả về JWT token
2. Token được lưu vào localStorage
3. Mọi API request đều gửi token qua Authorization header
4. Khi token hết hạn (401), tự động redirect về trang login

### API Service Layer (`src/services/api.ts`)
- Sử dụng Fetch API thay vì Axios
- Tự động attach JWT token vào headers
- Xử lý refresh token (待 implement)
- Error handling tập trung

### Type Safety
- Tất cả types được định nghĩa trong `src/types/index.ts`
- Types khớp với Backend Pydantic schemas
