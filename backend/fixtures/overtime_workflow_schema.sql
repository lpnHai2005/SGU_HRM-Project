-- Mission 9 synthetic-only parent schema. Apply only to a newly created loopback DB.
CREATE TABLE public.departments (department_id integer PRIMARY KEY, department_name text NOT NULL);
CREATE TABLE public.positions (position_id integer PRIMARY KEY, position_name text NOT NULL);
CREATE TABLE public.stores (store_id integer PRIMARY KEY, store_name text NOT NULL, is_active boolean NOT NULL DEFAULT true);
CREATE TABLE public.employees (
    employee_id integer PRIMARY KEY, employee_code text NOT NULL UNIQUE,
    full_name text NOT NULL, store_id integer NOT NULL REFERENCES public.stores,
    department_id integer REFERENCES public.departments,
    position_id integer REFERENCES public.positions, employment_status text NOT NULL
);
CREATE TABLE public.users (
    user_id integer PRIMARY KEY, username text NOT NULL UNIQUE,
    password_hash text NOT NULL, is_active boolean NOT NULL DEFAULT true,
    employee_id integer REFERENCES public.employees,
    email text, phone text, last_login timestamptz
);
CREATE TABLE public.roles (role_id integer PRIMARY KEY, role_code text NOT NULL UNIQUE);
CREATE TABLE public.permissions (permission_id integer PRIMARY KEY, permission_code text NOT NULL UNIQUE);
CREATE TABLE public.user_roles (user_id integer NOT NULL REFERENCES public.users,
    role_id integer NOT NULL REFERENCES public.roles, PRIMARY KEY (user_id, role_id));
CREATE TABLE public.role_permissions (role_id integer NOT NULL REFERENCES public.roles,
    permission_id integer NOT NULL REFERENCES public.permissions, PRIMARY KEY (role_id, permission_id));
CREATE TABLE public.work_shifts (shift_id integer PRIMARY KEY, shift_name text NOT NULL,
    start_time time NOT NULL, end_time time NOT NULL, work_hours numeric(6,2),
    is_active boolean NOT NULL DEFAULT true);
CREATE TABLE public.work_schedules (schedule_id bigserial PRIMARY KEY,
    employee_id integer NOT NULL REFERENCES public.employees,
    store_id integer NOT NULL REFERENCES public.stores,
    shift_id integer NOT NULL REFERENCES public.work_shifts,
    work_date date NOT NULL, starts_at timestamptz, ends_at timestamptz, cancelled_at timestamptz);
CREATE TABLE public.leave_requests (request_id bigserial PRIMARY KEY,
    employee_id integer NOT NULL REFERENCES public.employees,
    start_date date NOT NULL, end_date date NOT NULL, status text NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp());
CREATE TABLE public.attendances (attendance_id bigserial PRIMARY KEY,
    employee_id integer NOT NULL REFERENCES public.employees,
    store_id integer NOT NULL REFERENCES public.stores, shift_id integer,
    work_date date NOT NULL, check_in_time timestamptz, check_out_time timestamptz,
    attendance_context jsonb, late_minutes integer NOT NULL DEFAULT 0,
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp());
CREATE TABLE public.notification_reads (user_id integer NOT NULL REFERENCES public.users,
    notice_id text NOT NULL, PRIMARY KEY (user_id, notice_id));
CREATE TABLE public.audit_logs (audit_id bigserial PRIMARY KEY, user_id integer,
    action text, entity_name text, entity_id text, old_values jsonb, new_values jsonb,
    ip_address text, user_agent text, created_at timestamptz DEFAULT clock_timestamp());

INSERT INTO public.departments VALUES (1, 'Synthetic Operations');
INSERT INTO public.positions VALUES (1, 'Synthetic Staff');
INSERT INTO public.stores VALUES (1, 'Synthetic Branch One', true), (2, 'Synthetic Branch Two', true);
INSERT INTO public.employees VALUES
    (20, 'M-20', 'Synthetic Manager', 1, 1, 1, 'ACTIVE'),
    (21, 'E-21', 'Synthetic Employee', 1, 1, 1, 'ACTIVE'),
    (22, 'H-22', 'Synthetic HR', 1, 1, 1, 'ACTIVE'),
    (23, 'H-23', 'Synthetic Second HR', 1, 1, 1, 'ACTIVE'),
    (30, 'E-30', 'Synthetic Other Store Employee', 2, 1, 1, 'ACTIVE'),
    (99, 'A-99', 'Synthetic Admin', 1, 1, 1, 'ACTIVE');
INSERT INTO public.roles VALUES
    (1, 'ADMIN'), (2, 'HR_MANAGER'), (3, 'STORE_MANAGER'), (4, 'EMPLOYEE');
INSERT INTO public.work_shifts VALUES (8, 'Synthetic Day Shift', '09:00', '17:00', 8, true);
