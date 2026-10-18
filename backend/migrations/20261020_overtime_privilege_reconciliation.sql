-- TechZone HRM: reconcile OT table ACL after the 20261017-20261019 migrations.
-- Apply only to a verified target with the project's database change procedure.
-- The existing append-only trigger does not protect against TRUNCATE.

BEGIN;
SET LOCAL lock_timeout = '10s';

REVOKE ALL ON TABLE public.overtime_requests, public.overtime_request_events
    FROM anon, authenticated, service_role;
REVOKE ALL ON SEQUENCE public.overtime_requests_request_id_seq,
    public.overtime_request_events_event_id_seq
    FROM anon, authenticated, service_role;

ALTER TABLE public.overtime_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.overtime_request_events ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.overtime_requests TO service_role;
GRANT SELECT, INSERT ON TABLE public.overtime_request_events TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.overtime_requests_request_id_seq,
    public.overtime_request_events_event_id_seq TO service_role;

COMMIT;
