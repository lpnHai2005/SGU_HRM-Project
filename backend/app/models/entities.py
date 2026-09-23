from datetime import datetime, date
from typing import Optional, List, Dict, Any
from sqlalchemy import (
    Column, Integer, BigInteger, String, Boolean, Date, DateTime, Numeric,
    ForeignKey, Text, JSON
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import relationship
from app.core.database import Base

# ===================================================================================
# PHẦN 1: QUẢN TRỊ HỆ THỐNG & PHÂN QUYỀN (RBAC)
# ===================================================================================

class Role(Base):
    __tablename__ = "roles"

    role_id = Column(Integer, primary_key=True, index=True)
    role_code = Column(String(50), unique=True, nullable=False, index=True)
    role_name = Column(String(100), nullable=False)
    description = Column(String(255), nullable=True)
    created_at = Column(DateTime(timezone=True), default=datetime.utcnow)

    # Relationships
    permissions = relationship("Permission", secondary="role_permissions", back_populates="roles")
    users = relationship("User", secondary="user_roles", back_populates="roles")


class Permission(Base):
    __tablename__ = "permissions"

    permission_id = Column(Integer, primary_key=True, index=True)
    permission_code = Column(String(100), unique=True, nullable=False, index=True)
    permission_name = Column(String(150), nullable=False)
    module = Column(String(50), nullable=False, index=True)
    created_at = Column(DateTime(timezone=True), default=datetime.utcnow)

    roles = relationship("Role", secondary="role_permissions", back_populates="permissions")


class RolePermission(Base):
    __tablename__ = "role_permissions"

    role_id = Column(Integer, ForeignKey("roles.role_id", ondelete="CASCADE"), primary_key=True)
    permission_id = Column(Integer, ForeignKey("permissions.permission_id", ondelete="CASCADE"), primary_key=True)
    assigned_at = Column(DateTime(timezone=True), default=datetime.utcnow)


class User(Base):
    __tablename__ = "users"

    user_id = Column(Integer, primary_key=True, index=True)
    employee_id = Column(Integer, ForeignKey("employees.employee_id", ondelete="CASCADE"), unique=True, nullable=True)
    username = Column(String(50), unique=True, nullable=False, index=True)
    password_hash = Column(String(255), nullable=False)
    email = Column(String(100), unique=True, nullable=False, index=True)
    phone = Column(String(20), nullable=True)
    avatar_url = Column(String(255), nullable=True)
    is_active = Column(Boolean, default=True)
    last_login = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), default=datetime.utcnow)
    updated_at = Column(DateTime(timezone=True), default=datetime.utcnow, onupdate=datetime.utcnow)

    # Relationships
    roles = relationship("Role", secondary="user_roles", back_populates="users")
    employee = relationship("Employee", back_populates="user")
    audit_logs = relationship("AuditLog", back_populates="user")


class UserRole(Base):
    __tablename__ = "user_roles"

    user_id = Column(Integer, ForeignKey("users.user_id", ondelete="CASCADE"), primary_key=True)
    role_id = Column(Integer, ForeignKey("roles.role_id", ondelete="CASCADE"), primary_key=True)
    assigned_at = Column(DateTime(timezone=True), default=datetime.utcnow)
    assigned_by = Column(Integer, nullable=True)


class AuditLog(Base):
    __tablename__ = "audit_logs"

    log_id = Column(BigInteger, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.user_id", ondelete="SET NULL"), nullable=True)
    action = Column(String(100), nullable=False, index=True)
    entity_name = Column(String(50), nullable=False, index=True)
    entity_id = Column(String(50), nullable=True)
    old_values = Column(JSONB, nullable=True)
    new_values = Column(JSONB, nullable=True)
    ip_address = Column(String(45), nullable=True)
    user_agent = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), default=datetime.utcnow, index=True)

    user = relationship("User", back_populates="audit_logs")


# ===================================================================================
# PHẦN 2: CƠ CẤU TỔ CHỨC & DANH MỤC NỀN TẢNG
# ===================================================================================

class Department(Base):
    __tablename__ = "departments"

    department_id = Column(Integer, primary_key=True, index=True)
    department_code = Column(String(20), unique=True, nullable=False)
    department_name = Column(String(100), nullable=False)
    parent_id = Column(Integer, ForeignKey("departments.department_id", ondelete="SET NULL"), nullable=True)
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime(timezone=True), default=datetime.utcnow)

    employees = relationship("Employee", back_populates="department")


class Store(Base):
    __tablename__ = "stores"

    store_id = Column(Integer, primary_key=True, index=True)
    store_code = Column(String(20), unique=True, nullable=False, index=True)
    store_name = Column(String(150), nullable=False)
    address = Column(String(255), nullable=False)
    district = Column(String(50), nullable=False)
    city = Column(String(50), nullable=False, default="TP. Hồ Chí Minh")
    phone = Column(String(20), nullable=True)
    email = Column(String(100), nullable=True)
    manager_employee_id = Column(Integer, ForeignKey("employees.employee_id", ondelete="SET NULL"), nullable=True)
    open_date = Column(Date, nullable=False)
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime(timezone=True), default=datetime.utcnow)

    employees = relationship("Employee", foreign_keys="Employee.store_id", back_populates="store")


class EducationLevel(Base):
    __tablename__ = "education_levels"

    education_level_id = Column(Integer, primary_key=True, index=True)
    level_code = Column(String(20), unique=True, nullable=False)
    level_name = Column(String(100), nullable=False)
    description = Column(String(255), nullable=True)

    employees = relationship("Employee", back_populates="education_level")


class Position(Base):
    __tablename__ = "positions"

    position_id = Column(Integer, primary_key=True, index=True)
    position_code = Column(String(20), unique=True, nullable=False, index=True)
    position_name = Column(String(100), nullable=False)
    base_salary_min = Column(Numeric(15, 2), default=0)
    base_salary_max = Column(Numeric(15, 2), default=0)
    position_allowance = Column(Numeric(15, 2), default=0)
    position_coefficient = Column(Numeric(4, 2), nullable=False, default=1.00)
    is_store_role = Column(Boolean, default=True)
    created_at = Column(DateTime(timezone=True), default=datetime.utcnow)

    employees = relationship("Employee", back_populates="position")


# ===================================================================================
# PHẦN 3: HỒ SƠ NHÂN SỰ & HỢP ĐỒNG
# ===================================================================================

class Employee(Base):
    __tablename__ = "employees"

    employee_id = Column(Integer, primary_key=True, index=True)
    employee_code = Column(String(20), unique=True, nullable=False, index=True)
    first_name = Column(String(50), nullable=False)
    last_name = Column(String(50), nullable=False)
    # full_name is a generated column in PostgreSQL: (last_name || ' ' || first_name)
    full_name = Column(String(100), nullable=True)
    gender = Column(String(10), nullable=False, default="MALE")
    dob = Column(Date, nullable=False)
    identity_card = Column(String(20), unique=True, nullable=False)
    identity_issued_date = Column(Date, nullable=True)
    identity_issued_place = Column(String(100), nullable=True)
    phone = Column(String(20), unique=True, nullable=False)
    personal_email = Column(String(100), nullable=True)
    company_email = Column(String(100), unique=True, nullable=False)
    permanent_address = Column(String(255), nullable=True)
    current_address = Column(String(255), nullable=False)
    avatar = Column(String(255), nullable=True)

    store_id = Column(Integer, ForeignKey("stores.store_id", ondelete="SET NULL"), nullable=True)
    department_id = Column(Integer, ForeignKey("departments.department_id"), nullable=False)
    position_id = Column(Integer, ForeignKey("positions.position_id"), nullable=False)
    education_level_id = Column(Integer, ForeignKey("education_levels.education_level_id"), nullable=False)

    join_date = Column(Date, nullable=False)
    resignation_date = Column(Date, nullable=True)
    employment_status = Column(String(20), nullable=False, default="PROBATION")

    bank_account_number = Column(String(30), nullable=True)
    bank_name = Column(String(100), nullable=True)
    tax_code = Column(String(30), nullable=True)
    insurance_code = Column(String(30), nullable=True)

    created_at = Column(DateTime(timezone=True), default=datetime.utcnow)
    updated_at = Column(DateTime(timezone=True), default=datetime.utcnow, onupdate=datetime.utcnow)

    # Relationships
    user = relationship("User", back_populates="employee", uselist=False)
    store = relationship("Store", foreign_keys=[store_id], back_populates="employees")
    department = relationship("Department", back_populates="employees")
    position = relationship("Position", back_populates="employees")
    education_level = relationship("EducationLevel", back_populates="employees")
    contracts = relationship("Contract", back_populates="employee")


class Contract(Base):
    __tablename__ = "contracts"

    contract_id = Column(Integer, primary_key=True, index=True)
    contract_number = Column(String(50), unique=True, nullable=False)
    employee_id = Column(Integer, ForeignKey("employees.employee_id", ondelete="CASCADE"), nullable=False)
    contract_type = Column(String(20), nullable=False, default="FIXED_1_YEAR")
    start_date = Column(Date, nullable=False)
    end_date = Column(Date, nullable=True)
    basic_salary = Column(Numeric(15, 2), nullable=False)
    insurance_salary = Column(Numeric(15, 2), nullable=False)
    signed_date = Column(Date, nullable=False)
    contract_status = Column(String(20), default="ACTIVE")
    created_at = Column(DateTime(timezone=True), default=datetime.utcnow)

    employee = relationship("Employee", back_populates="contracts")
