# TechZone HRM - Hệ Thống Quản Lý Nhân Sự Chuỗi Cửa Hàng Bán Lẻ

Dự án Hệ thống thông tin Quản lý Nhân sự (HRM) dành cho chuỗi bán lẻ thiết bị công nghệ **TechZone Retail**.

- **Môn học**: Hệ thống thông tin doanh nghiệp & Công nghệ phần mềm
- **Khoa**: Công nghệ Thông tin - Trường Đại học Sài Gòn (SGU)
- **Công nghệ**:
  - **Backend**: Python FastAPI, SQLAlchemy 2.0 (Async), Supabase PostgreSQL, JWT Authentication, RBAC.
  - **Frontend**: React 19, TypeScript, Vite, React Router v7, Vanilla CSS Enterprise Theme (Hỗ trợ Dark/Light Theme & Responsive Mobile).

---

## 🚀 Cách Chạy Dự Án Nhanh Nhất (Chỉ 1 lệnh)

Tại thư mục gốc dự án:
```powershell
python run.py
```
*(Script sẽ tự động chạy song song cả Backend FastAPI lẫn Frontend React Vite trong cùng 1 terminal, và tự động dọn dẹp tắt hết khi bạn nhấn `Ctrl + C`).*

---

## 🛠️ Cách Chạy Từng Phần Riêng Biệt (Thủ công)

### 1. Cấu Hình & Chạy Backend (FastAPI)

#### Bước 1: Mở terminal tại thư mục `backend`
```bash
cd backend
```

#### Bước 2: Tạo và kích hoạt môi trường ảo (Virtual Environment)
- **Trên Windows (cmd/PowerShell)**:
  ```powershell
  python -m venv venv
  .\venv\Scripts\activate
  ```
- **Trên macOS / Linux**:
  ```bash
  python3 -m venv venv
  source venv/bin/activate
  ```

#### Bước 3: Cài đặt các thư viện phụ thuộc
```bash
pip install -r requirements.txt
```

#### Bước 4: Cấu hình biến môi trường
Tạo file `.env` bằng cách sao chép từ `.env.example`:
```bash
cp .env.example .env     # Trên Linux/macOS
copy .env.example .env   # Trên Windows CMD
```
Mở file `backend/.env` và điền cấu hình chuỗi kết nối database (Supabase / PostgreSQL):
```env
PROJECT_NAME="TechZone HRM API"
API_V1_STR="/api/v1"
DATABASE_URL="postgresql+asyncpg://<username>:<password>@<host>:<port>/<dbname>"
SYNC_DATABASE_URL="postgresql+psycopg2://<username>:<password>@<host>:<port>/<dbname>"
JWT_SECRET_KEY="your_secret_key_here"
ALGORITHM="HS256"
ACCESS_TOKEN_EXPIRE_MINUTES=480
CORS_ORIGINS=["http://localhost:5173", "http://127.0.0.1:5173", "http://localhost:3000"]
```

#### Bước 5: Chạy máy chủ Backend
```bash
python run.py
```
Máy chủ API sẽ chạy tại:
- **API URL**: http://localhost:8000
- **Swagger UI (Interactive API Docs)**: http://localhost:8000/docs
- **ReDoc**: http://localhost:8000/redoc

---

### 2. Cấu Hình & Chạy Frontend (React + Vite)

#### Bước 1: Mở một terminal mới tại thư mục `frontend-web`
```bash
cd frontend-web
```

#### Bước 2: Cài đặt dependencies
```bash
npm install
```

#### Bước 3: Cấu hình biến môi trường Frontend
Tạo file `.env` từ `.env.example`:
```bash
copy .env.example .env   # Trên Windows
cp .env.example .env     # Trên macOS/Linux
```
Nội dung file `frontend-web/.env`:
```env
VITE_API_URL=http://localhost:8000/api/v1
VITE_APP_NAME=TechZone HRM
VITE_APP_VERSION=1.0.0
```

#### Bước 4: Chạy Frontend ở chế độ phát triển
```bash
npm run dev
```
Ứng dụng sẽ khả dụng tại: **http://localhost:3000** (hoặc port do Vite cấp).

---

## 🔑 Tài Khoản Đăng Nhập Mẫu (Seed Accounts)

Hệ thống hỗ trợ phân quyền theo 4 vai trò chính (RBAC):

| Tài khoản (Username) | Mật khẩu | Vai trò (Role) | Chức năng chính |
| :--- | :--- | :--- | :--- |
| `admin` | `admin123` | **ADMIN** (Quản trị viên) | Toàn quyền quản trị nhân sự, chấm công, bảng lương, báo cáo, audit log, cài đặt hệ thống |
| `hr_manager` | `hr123` | **HR_MANAGER** (Trưởng phòng NS) | Quản lý nhân viên, hồ sơ, phê duyệt nghỉ phép, tính lương |
| `store_manager` | `sm123` | **STORE_MANAGER** (Quản lý cửa hàng) | Giám sát nhân viên chi nhánh, chấm công, duyệt phép cấp cơ sở |
| `nv_banhang` | `nv123` | **EMPLOYEE** (Nhân viên) | Chấm công trực tuyến, xem lịch sử công, gửi đơn xin phép, tra cứu phiếu lương |

---

## 📁 Cấu Trúc Thư Mục Dự Án

```
SGU_HRM-Project/
├── backend/
│   ├── app/
│   │   ├── api/v1/endpoints/  # Tuyến API: auth, employees, attendances, leaves, payrolls, reports, audit_logs...
│   │   ├── core/              # Config, Async Database Engine, Security JWT
│   │   ├── models/            # SQLAlchemy ORM Entities
│   │   ├── schemas/           # Pydantic Schemas validation
│   │   └── main.py            # FastAPI Application entrypoint
│   ├── .env.example
│   ├── requirements.txt       # Python dependencies
│   └── run.py                 # Khởi chạy server Uvicorn
│
├── frontend-web/
│   ├── src/
│   │   ├── components/
│   │   │   ├── common/        # Icons, StatCard, EmptyState...
│   │   │   └── layout/        # Sidebar, Topbar, BottomNav (Mobile)
│   │   ├── constants/         # Menu điều hướng, role labels
│   │   ├── contexts/          # AuthContext (JWT state, storage)
│   │   ├── pages/             # Các trang: Dashboard, Employees, Attendance, Leave, Payroll, Reports, Audit...
│   │   ├── services/          # API client (Axios/Fetch wrapper)
│   │   ├── utils/             # Format tiền tệ VNĐ, ngày tháng, helper
│   │   ├── App.tsx            # React Router Routes & Layout
│   │   ├── App.css            # Enterprise CSS Theme & Responsive tokens
│   │   └── main.tsx           # React root & BrowserRouter
│   ├── .env.example
│   ├── package.json
│   └── vite.config.ts
└── README.md
```

---

## 🛠️ Lệnh Kiểm Tra Code & Build

- **Build Frontend**:
  ```bash
  cd frontend-web
  npm run build
  ```
- **Kiểm tra Lint Frontend**:
  ```bash
  cd frontend-web
  npm run lint
  ```
- **Kiểm tra Backend Test**:
  ```bash
  cd backend
  python test_auth_rbac.py
  ```
