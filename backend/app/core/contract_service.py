"""
Contract Service - Business Logic Layer
Xử lý các nghiệp vụ liên quan đến hợp đồng lao động
"""
from datetime import date, datetime
from typing import Optional
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text
from fastapi import HTTPException


class ContractStatus:
    DRAFT = "DRAFT"
    ACTIVE = "ACTIVE"
    EXPIRED = "EXPIRED"
    TERMINATED = "TERMINATED"
    CANCELLED = "CANCELLED"


class ContractType:
    PROBATION = "PROBATION"
    FIXED_TERM = "FIXED_TERM"
    INDEFINITE = "INDEFINITE"


# Valid state transitions
VALID_TRANSITIONS = {
    ContractStatus.DRAFT: [ContractStatus.ACTIVE, ContractStatus.CANCELLED],
    ContractStatus.ACTIVE: [ContractStatus.EXPIRED, ContractStatus.TERMINATED],
    ContractStatus.EXPIRED: [],  # No transitions from EXPIRED
    ContractStatus.TERMINATED: [],  # No transitions from TERMINATED
    ContractStatus.CANCELLED: [],  # No transitions from CANCELLED
}


class ContractService:
    """Service class for contract business logic"""

    @staticmethod
    async def generate_contract_number(db: AsyncSession, year: int) -> str:
        """
        Generate unique contract number: HD-YYYY-NNNN
        Uses robust regex extraction to avoid alphabetical sort issues.
        """
        query = text("""
            SELECT COALESCE(MAX(NULLIF(SUBSTRING(contract_number FROM 'HD-[0-9]{4}-([0-9]+)'), '')::integer), 0) as max_seq
            FROM contracts
            WHERE contract_number LIKE :pattern
        """)
        pattern = f"HD-{year}-%"
        result = await db.execute(query, {"pattern": pattern})
        max_seq = result.mappings().first()["max_seq"]
        next_seq = (max_seq or 0) + 1
        return f"HD-{year}-{next_seq:04d}"

    @staticmethod
    async def validate_overlap(
        db: AsyncSession,
        employee_id: int,
        start_date: date,
        end_date: Optional[date],
        exclude_contract_id: Optional[int] = None
    ) -> bool:
        """
        Check if contract overlaps with existing ACTIVE contracts for the same employee.
        Concurrency protection: acquires a row lock on the employee row within the current transaction.
        
        Overlap theorem:
        - Interval [new_start, new_end] overlaps with [existing_start, existing_end] iff:
          new_start <= existing_end AND (new_end is NULL OR new_end >= existing_start)
        - If new_end is NULL (INDEFINITE): overlaps with any existing where existing_end is NULL OR new_start <= existing_end
        - If existing_end is NULL (INDEFINITE): overlaps with any new where new_end is NULL OR new_end >= existing_start
        """
        # Concurrency protection: lock employee row
        await db.execute(
            text("SELECT employee_id FROM employees WHERE employee_id = :employee_id FOR UPDATE"),
            {"employee_id": employee_id}
        )

        # Standardize date types
        if isinstance(start_date, str):
            start_date = datetime.strptime(start_date, "%Y-%m-%d").date()
        if isinstance(end_date, str) and end_date:
            end_date = datetime.strptime(end_date, "%Y-%m-%d").date()
        elif not end_date:
            end_date = None

        query_str = """
            SELECT contract_id, start_date, end_date, contract_number, contract_type
            FROM contracts
            WHERE employee_id = :employee_id
            AND status = 'ACTIVE'
        """
        params = {"employee_id": employee_id}
        if exclude_contract_id:
            query_str += " AND contract_id != :exclude_id"
            params["exclude_id"] = exclude_contract_id

        result = await db.execute(text(query_str), params)
        contracts = result.mappings().all()

        for contract in contracts:
            existing_start = contract["start_date"]
            existing_end = contract["end_date"]
            if isinstance(existing_start, str):
                existing_start = datetime.strptime(existing_start, "%Y-%m-%d").date()
            if isinstance(existing_end, str) and existing_end:
                existing_end = datetime.strptime(existing_end, "%Y-%m-%d").date()
            elif not existing_end:
                existing_end = None

            # Case 1: New contract has no end date (INDEFINITE)
            if end_date is None:
                if existing_end is None:
                    raise HTTPException(
                        status_code=409,
                        detail=f"Nhân viên đã có hợp đồng không xác định thời hạn ({contract['contract_number']}) đang hiệu lực"
                    )
                if start_date <= existing_end:
                    raise HTTPException(
                        status_code=409,
                        detail=f"Nhân viên đã có hợp đồng ({contract['contract_number']}) đang hiệu lực từ {existing_start} đến {existing_end}"
                    )
            # Case 2: Existing contract has no end date (INDEFINITE)
            elif existing_end is None:
                if end_date >= existing_start:
                    raise HTTPException(
                        status_code=409,
                        detail=f"Nhân viên đã có hợp đồng không xác định thời hạn ({contract['contract_number']}) đang hiệu lực từ {existing_start}"
                    )
            # Case 3: Both have end dates
            else:
                if start_date <= existing_end and end_date >= existing_start:
                    raise HTTPException(
                        status_code=409,
                        detail=f"Nhân viên đã có hợp đồng ({contract['contract_number']}) đang hiệu lực từ {existing_start} đến {existing_end}"
                    )

        return True

    @staticmethod
    async def validate_date_range(
        contract_type: str,
        start_date: date,
        end_date: Optional[date]
    ) -> None:
        """
        Validate contract dates based on contract type.
        """
        # PROBATION and FIXED_TERM require end_date
        if contract_type in [ContractType.PROBATION, ContractType.FIXED_TERM] or contract_type.startswith("FIXED_"):
            if end_date is None:
                raise HTTPException(
                    status_code=400,
                    detail=f"Hợp đồng loại {contract_type} phải có ngày kết thúc"
                )

            if end_date <= start_date:
                raise HTTPException(
                    status_code=400,
                    detail="Ngày kết thúc phải lớn hơn ngày bắt đầu"
                )

        # INDEFINITE allows NULL end_date
        elif contract_type == ContractType.INDEFINITE:
            # end_date can be None for indefinite contracts
            pass

    @staticmethod
    async def validate_salary(basic_salary: float) -> None:
        """
        Validate basic salary is non-negative.
        """
        if basic_salary < 0:
            raise HTTPException(
                status_code=400,
                detail="Lương cơ bản không được âm"
            )

    @staticmethod
    async def validate_employee_exists(
        db: AsyncSession,
        employee_id: int
    ) -> bool:
        """
        Check if employee exists and is active.
        """
        query = text("""
            SELECT employee_id, employee_code, full_name, employment_status
            FROM employees
            WHERE employee_id = :employee_id
        """)
        result = await db.execute(query, {"employee_id": employee_id})
        employee = result.mappings().first()

        if not employee:
            raise HTTPException(
                status_code=404,
                detail="Không tìm thấy nhân viên"
            )

        return True

    @staticmethod
    def check_state_transition(
        current_status: str,
        target_status: str
    ) -> bool:
        """
        Validate if state transition is allowed.
        """
        allowed = VALID_TRANSITIONS.get(current_status, [])

        if target_status not in allowed:
            raise HTTPException(
                status_code=409,
                detail=f"Không thể chuyển từ trạng thái {current_status} sang {target_status}"
            )

        return True

    @staticmethod
    async def check_contract_exists(
        db: AsyncSession,
        contract_id: int
    ):
        """Get contract by ID or raise 404"""
        query = text("""
            SELECT c.*, e.full_name as employee_name, e.employee_code
            FROM contracts c
            JOIN employees e ON c.employee_id = e.employee_id
            WHERE c.contract_id = :contract_id
        """)
        result = await db.execute(query, {"contract_id": contract_id})
        contract = result.mappings().first()

        if not contract:
            raise HTTPException(
                status_code=404,
                detail="Không tìm thấy hợp đồng"
            )

        return contract

    @staticmethod
    async def can_user_access_contract(
        db: AsyncSession,
        current_user: dict,
        contract_id: int
    ) -> bool:
        """
        Check if user can access the contract based on RBAC.
        Returns True if allowed, raises HTTPException if not.

        - ADMIN/HR_MANAGER: Full access
        - STORE_MANAGER: Only contracts in their store
        - EMPLOYEE: Only own contracts
        """
        roles = current_user.get("roles", [])

        # ADMIN and HR_MANAGER have full access
        if "ADMIN" in roles or "HR_MANAGER" in roles:
            return True

        # Get contract and employee info
        query = text("""
            SELECT c.contract_id, c.employee_id, e.store_id, e.employee_id as emp_id
            FROM contracts c
            JOIN employees e ON c.employee_id = e.employee_id
            WHERE c.contract_id = :contract_id
        """)
        result = await db.execute(query, {"contract_id": contract_id})
        contract = result.mappings().first()

        if not contract:
            raise HTTPException(
                status_code=404,
                detail="Không tìm thấy hợp đồng"
            )

        # STORE_MANAGER: check if employee in their store
        if "STORE_MANAGER" in roles:
            user_store_id = current_user.get("store_id")
            if not user_store_id:
                raise HTTPException(
                    status_code=403,
                    detail="Tài khoản chưa được gán cửa hàng"
                )
            if contract["store_id"] != user_store_id:
                raise HTTPException(
                    status_code=403,
                    detail="Bạn không có quyền xem hợp đồng này"
                )
            return True

        # EMPLOYEE: check if it's their own contract
        user_employee_id = current_user.get("employee_id")
        if not user_employee_id:
            raise HTTPException(
                status_code=403,
                detail="Tài khoản chưa được liên kết với nhân viên"
            )
        if contract["employee_id"] != user_employee_id:
            raise HTTPException(
                status_code=403,
                detail="Bạn không có quyền xem hợp đồng này"
            )

        return True

    @staticmethod
    async def get_contract_with_sensitive_data(
        db: AsyncSession,
        current_user: dict,
        contract_id: int
    ) -> dict:
        """
        Get contract data with appropriate field masking based on user role.

        Sensitive fields (hidden for non-HR): basic_salary, contract_file_url, termination_reason
        """
        roles = current_user.get("roles", [])
        is_hr = "ADMIN" in roles or "HR_MANAGER" in roles

        query = text("""
            SELECT c.*,
                   e.full_name as employee_name,
                   e.employee_code,
                   p.position_name,
                   d.department_name,
                   pc.contract_number as previous_contract_number
            FROM contracts c
            JOIN employees e ON c.employee_id = e.employee_id
            LEFT JOIN positions p ON c.position_id = p.position_id
            LEFT JOIN departments d ON c.department_id = d.department_id
            LEFT JOIN contracts pc ON c.previous_contract_id = pc.contract_id
            WHERE c.contract_id = :contract_id
        """)
        result = await db.execute(query, {"contract_id": contract_id})
        contract = result.mappings().first()

        if not contract:
            raise HTTPException(
                status_code=404,
                detail="Không tìm thấy hợp đồng"
            )

        # Mask sensitive fields for non-HR users
        if not is_hr:
            contract = dict(contract)
            contract["basic_salary"] = None
            contract["insurance_salary"] = None
            contract["contract_file_url"] = None
            contract["termination_reason"] = None

        return contract
