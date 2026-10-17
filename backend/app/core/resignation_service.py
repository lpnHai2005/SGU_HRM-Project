"""
Resignation Service - Business Logic Layer
Quản lý vòng đời đơn thôi việc và tích hợp với chấm dứt hợp đồng lao động
"""
from datetime import date, datetime
from typing import Optional, List, Dict, Any
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text
from fastapi import HTTPException


class ResignationStatus:
    PENDING = "PENDING"
    APPROVED = "APPROVED"
    REJECTED = "REJECTED"
    CANCELLED = "CANCELLED"


class ResignationService:
    """Service class for resignation business logic"""

    @staticmethod
    async def get_employee_active_contracts(db: AsyncSession, employee_id: int) -> List[Dict[str, Any]]:
        """Lấy danh sách các hợp đồng đang ACTIVE của nhân viên"""
        query = text("""
            SELECT 
                c.contract_id, c.contract_number, c.contract_type,
                c.start_date, c.end_date, c.basic_salary, c.status,
                p.position_name, d.department_name
            FROM contracts c
            LEFT JOIN positions p ON c.position_id = p.position_id
            LEFT JOIN departments d ON c.department_id = d.department_id
            WHERE c.employee_id = :employee_id AND c.status = 'ACTIVE'
            ORDER BY c.start_date DESC
        """)
        res = await db.execute(query, {"employee_id": employee_id})
        return [dict(r) for r in res.mappings().fetchall()]

    @staticmethod
    async def validate_create(
        db: AsyncSession,
        employee_id: int,
        contract_id: int,
        submitted_date: date,
        requested_last_working_date: date
    ) -> Dict[str, Any]:
        """
        Validate nghiệp vụ trước khi tạo đơn thôi việc:
        1. Nhân viên tồn tại và chưa thôi việc/chấm dứt
        2. Hợp đồng tồn tại, thuộc về nhân viên này và đang ACTIVE
        3. Không có đơn thôi việc nào đang ở trạng thái PENDING
        4. Ngày nghỉ dự kiến >= Ngày nộp đơn
        """
        # 1. Kiểm tra nhân viên
        emp_query = text("""
            SELECT employee_id, employee_code, full_name, employment_status, store_id, department_id, position_id
            FROM employees
            WHERE employee_id = :employee_id
        """)
        emp_res = await db.execute(emp_query, {"employee_id": employee_id})
        emp = emp_res.mappings().first()
        if not emp:
            raise HTTPException(status_code=404, detail="Không tìm thấy nhân viên trong hệ thống")

        if emp["employment_status"] in ["RESIGNED", "TERMINATED"]:
            raise HTTPException(
                status_code=400,
                detail=f"Nhân viên {emp['full_name']} ({emp['employee_code']}) đã thôi việc/chấm dứt ({emp['employment_status']}), không thể tạo đơn thôi việc"
            )

        # 2. Kiểm tra hợp đồng
        contract_query = text("""
            SELECT contract_id, contract_number, employee_id, status, start_date, end_date
            FROM contracts
            WHERE contract_id = :contract_id
        """)
        c_res = await db.execute(contract_query, {"contract_id": contract_id})
        contract = c_res.mappings().first()
        if not contract:
            raise HTTPException(status_code=404, detail="Không tìm thấy hợp đồng lao động")

        if contract["employee_id"] != employee_id:
            raise HTTPException(
                status_code=400,
                detail=f"Hợp đồng {contract['contract_number']} không thuộc về nhân viên {emp['full_name']}"
            )

        if contract["status"] != "ACTIVE":
            raise HTTPException(
                status_code=400,
                detail=f"Chỉ có thể tạo đơn thôi việc cho hợp đồng đang ACTIVE. Hợp đồng {contract['contract_number']} đang ở trạng thái {contract['status']}"
            )

        # 3. Kiểm tra đơn PENDING
        pending_query = text("""
            SELECT resignation_id, submitted_date 
            FROM resignation_requests 
            WHERE employee_id = :employee_id AND status = 'PENDING'
        """)
        p_res = await db.execute(pending_query, {"employee_id": employee_id})
        pending = p_res.mappings().first()
        if pending:
            raise HTTPException(
                status_code=400,
                detail=f"Nhân viên {emp['full_name']} đang có đơn thôi việc chờ duyệt (Mã đơn: #{pending['resignation_id']})"
            )

        # 4. Kiểm tra ngày
        if requested_last_working_date < submitted_date:
            raise HTTPException(
                status_code=400,
                detail="Ngày dự kiến nghỉ việc không được trước ngày nộp đơn"
            )

        return {"employee": dict(emp), "contract": dict(contract)}

    @staticmethod
    async def get_resignation_or_404(db: AsyncSession, resignation_id: int) -> Dict[str, Any]:
        """Lấy chi tiết đơn thôi việc hoặc báo 404"""
        query = text("""
            SELECT 
                r.resignation_id, r.employee_id, r.contract_id,
                r.submitted_date, r.requested_last_working_date,
                r.reason, r.attachment_url, r.notes, r.status,
                r.rejection_reason, r.approved_last_working_date,
                r.created_by, r.approved_by, r.approved_at,
                r.created_at, r.updated_at,
                e.employee_code, e.full_name as employee_name,
                e.department_id, d.department_name,
                e.position_id, p.position_name,
                e.store_id, s.store_name,
                c.contract_number, c.contract_type,
                c.start_date as contract_start_date, c.end_date as contract_end_date,
                u_creator.username as created_by_name,
                u_approver.username as approved_by_name,
                EXISTS (
                    SELECT 1 FROM user_roles ur2
                    JOIN roles r2 ON ur2.role_id = r2.role_id
                    JOIN users u2 ON ur2.user_id = u2.user_id
                    WHERE u2.employee_id = r.employee_id AND r2.role_code IN ('HR_MANAGER', 'ADMIN')
                ) as is_hr_or_admin_request
            FROM resignation_requests r
            JOIN employees e ON r.employee_id = e.employee_id
            JOIN contracts c ON r.contract_id = c.contract_id
            LEFT JOIN departments d ON e.department_id = d.department_id
            LEFT JOIN positions p ON e.position_id = p.position_id
            LEFT JOIN stores s ON e.store_id = s.store_id
            LEFT JOIN users u_creator ON r.created_by = u_creator.user_id
            LEFT JOIN users u_approver ON r.approved_by = u_approver.user_id
            WHERE r.resignation_id = :resignation_id
        """)
        res = await db.execute(query, {"resignation_id": resignation_id})
        item = res.mappings().first()
        if not item:
            raise HTTPException(status_code=404, detail="Không tìm thấy đơn thôi việc")
        return dict(item)

    @staticmethod
    async def get_stats(db: AsyncSession) -> Dict[str, int]:
        """Lấy thống kê số lượng đơn thôi việc theo các trạng thái"""
        query = text("""
            SELECT 
                COUNT(*) as total,
                COUNT(*) FILTER (WHERE status = 'PENDING') as pending,
                COUNT(*) FILTER (WHERE status = 'APPROVED') as approved,
                COUNT(*) FILTER (WHERE status = 'REJECTED') as rejected,
                COUNT(*) FILTER (WHERE status = 'CANCELLED') as cancelled
            FROM resignation_requests
        """)
        res = await db.execute(query)
        row = res.mappings().first()
        return {
            "total": row["total"] or 0,
            "pending": row["pending"] or 0,
            "approved": row["approved"] or 0,
            "rejected": row["rejected"] or 0,
            "cancelled": row["cancelled"] or 0,
        }

    @staticmethod
    async def get_approved_resignation(
        db: AsyncSession,
        employee_id: int,
        contract_id: Optional[int] = None,
        resignation_id: Optional[int] = None
    ) -> Optional[Dict[str, Any]]:
        """
        Tìm đơn thôi việc đã APPROVED hợp lệ của nhân viên/hợp đồng
        """
        if resignation_id:
            query = text("""
                SELECT resignation_id, employee_id, contract_id, status, approved_last_working_date, reason
                FROM resignation_requests
                WHERE resignation_id = :resignation_id AND status = 'APPROVED'
            """)
            res = await db.execute(query, {"resignation_id": resignation_id})
            return res.mappings().first()
        
        # Tìm theo employee_id và contract_id
        params = {"employee_id": employee_id}
        cond = "employee_id = :employee_id AND status = 'APPROVED'"
        if contract_id:
            cond += " AND contract_id = :contract_id"
            params["contract_id"] = contract_id
            
        query = text(f"""
            SELECT resignation_id, employee_id, contract_id, status, approved_last_working_date, reason
            FROM resignation_requests
            WHERE {cond}
            ORDER BY approved_at DESC
            LIMIT 1
        """)
        res = await db.execute(query, params)
        row = res.mappings().first()
        return dict(row) if row else None
