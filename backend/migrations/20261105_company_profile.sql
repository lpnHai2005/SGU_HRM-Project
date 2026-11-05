-- Thông tin pháp nhân của công ty: nguồn dữ liệu duy nhất cho hợp đồng, phiếu lương, báo cáo.
-- Chỉ có một dòng (company_id = 1).
CREATE TABLE IF NOT EXISTS company_profile (
    company_id INTEGER PRIMARY KEY DEFAULT 1 CHECK (company_id = 1),
    company_name VARCHAR(255),
    tax_code VARCHAR(20),
    address TEXT,
    phone VARCHAR(30),
    email VARCHAR(255),
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE company_profile ENABLE ROW LEVEL SECURITY;
