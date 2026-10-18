-- Synthetic parent tables for a newly created, isolated local PostgreSQL database.
-- Never run against Supabase or a database containing application data.
CREATE TABLE public.users (
    user_id INTEGER PRIMARY KEY,
    username TEXT NOT NULL
);
CREATE TABLE public.stores (
    store_id INTEGER PRIMARY KEY,
    store_name TEXT NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE
);
CREATE TABLE public.employees (
    employee_id INTEGER PRIMARY KEY,
    employee_code TEXT NOT NULL,
    full_name TEXT NOT NULL,
    store_id INTEGER NOT NULL REFERENCES public.stores(store_id),
    employment_status TEXT NOT NULL
);
CREATE TABLE public.attendances (
    attendance_id BIGSERIAL PRIMARY KEY,
    employee_id INTEGER NOT NULL REFERENCES public.employees(employee_id),
    store_id INTEGER NOT NULL REFERENCES public.stores(store_id),
    shift_id INTEGER,
    work_date DATE NOT NULL,
    check_in_time TIMESTAMPTZ,
    check_out_time TIMESTAMPTZ,
    attendance_context JSONB,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);
INSERT INTO public.users(user_id, username) VALUES
    (1,'admin_test'),(2,'manager_test'),(3,'employee_test'),
    (4,'hr_test'),(5,'other_employee_test'),(6,'second_hr_test');
INSERT INTO public.stores(store_id, store_name) VALUES
    (1,'Synthetic Branch One'),(2,'Synthetic Branch Two');
INSERT INTO public.employees(employee_id, employee_code, full_name, store_id, employment_status) VALUES
    (20,'M-20','Synthetic Manager',1,'ACTIVE'),
    (21,'E-21','Synthetic Employee',1,'ACTIVE'),
    (22,'H-22','Synthetic HR',1,'ACTIVE'),
    (23,'H-23','Synthetic Second HR',1,'ACTIVE'),
    (30,'E-30','Synthetic Other Employee',2,'ACTIVE'),
    (99,'A-99','Synthetic Admin',1,'ACTIVE');
