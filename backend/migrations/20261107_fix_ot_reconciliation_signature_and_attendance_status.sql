-- Migration: Fix OT Reconciliation Source Signature & Attendance OT Shift Status
-- Date: 2026-11-07
-- Description:
-- 1. ot_reconciliation_source_signature: Không hash các trường metadata (updated_at, notes) hoặc kết quả đối soát (overtime_hours, status),
--    giúp tránh lỗi vòng lặp: khi trigger đồng bộ ghi giờ OT và updated_at vào attendances thì chữ ký nguồn bị lệch làm v_overtime_verified_current loại bỏ record.
-- 2. fn_sync_ot_reconciliation_to_approvals: Khi HR xác minh ca OT (VERIFIED), nếu nhân viên check-in ca OT bị hệ thống tính nhầm là trễ ca chính (ví dụ 777 phút),
--    trigger tự động xóa phạt trễ (late_minutes = 0) và gán status = 'OVERTIME' cùng nhãn [Ca tăng ca (OT)].
-- 3. Đồng bộ lại toàn bộ source_signature trên bảng overtime_reconciliations.

-- 1. Cập nhật hàm tạo chữ ký nguồn đối soát
CREATE OR REPLACE FUNCTION public.ot_reconciliation_source_signature(p_request_id BIGINT)
RETURNS TEXT LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public AS $$
    SELECT md5(
        (to_jsonb(o) - 'updated_at' - 'notes')::text || ':' || COALESCE((
            SELECT jsonb_agg(
                jsonb_build_object(
                    'attendance_id', a.attendance_id,
                    'employee_id', a.employee_id,
                    'store_id', a.store_id,
                    'work_date', a.work_date,
                    'check_in_time', a.check_in_time,
                    'check_out_time', a.check_out_time,
                    'attendance_context', a.attendance_context
                ) ORDER BY a.attendance_id
            )::text
            FROM public.attendances a
            WHERE a.employee_id = o.employee_id
              AND a.check_in_time IS NOT NULL
              AND a.check_in_time < o.ends_at
              AND (a.check_out_time IS NULL OR a.check_out_time > o.starts_at)
        ), '[]')
    )
    FROM public.overtime_requests o WHERE o.request_id = p_request_id;
$$;

-- 2. Cập nhật trigger đồng bộ kết quả đối soát OT sang attendances và approvals
CREATE OR REPLACE FUNCTION public.fn_sync_ot_reconciliation_to_approvals()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $func$
DECLARE
    att_id_val TEXT;
    att_id BIGINT;
    target_att_id BIGINT;
    v_total_hours NUMERIC(5, 2);
    rec_req RECORD;
BEGIN
    IF NEW.status = 'VERIFIED' AND COALESCE(NEW.verified_microseconds, 0) > 0 THEN
        v_total_hours := ROUND(NEW.verified_microseconds / 3600000000.0, 2);
        
        SELECT * INTO rec_req FROM public.overtime_requests WHERE request_id = NEW.request_id;

        IF NEW.attendance_ids IS NOT NULL AND jsonb_array_length(NEW.attendance_ids) > 0 THEN
            SELECT (val)::BIGINT INTO target_att_id
            FROM jsonb_array_elements_text(NEW.attendance_ids) val
            ORDER BY (val)::BIGINT DESC
            LIMIT 1;

            FOR att_id_val IN SELECT jsonb_array_elements_text(NEW.attendance_ids) LOOP
                att_id := att_id_val::BIGINT;

                IF att_id = target_att_id THEN
                    -- Cập nhật phiên làm việc chính nhận toàn bộ giờ OT
                    -- Xóa bỏ phạt trễ sai lệch do check-in ngoài ca chính và cập nhật trạng thái OVERTIME
                    UPDATE public.attendances
                    SET overtime_hours = GREATEST(COALESCE(overtime_hours, 0), v_total_hours),
                        late_minutes = CASE 
                            WHEN late_minutes > 15 AND rec_req.starts_at IS NOT NULL 
                                 AND check_in_time >= (rec_req.starts_at - INTERVAL '30 minutes') THEN 0
                            ELSE late_minutes
                        END,
                        early_minutes = CASE 
                            WHEN early_minutes > 0 AND rec_req.ends_at IS NOT NULL 
                                 AND check_out_time >= (rec_req.ends_at - INTERVAL '15 minutes') THEN 0
                            ELSE early_minutes
                        END,
                        status = CASE 
                            WHEN late_minutes > 15 AND rec_req.starts_at IS NOT NULL 
                                 AND check_in_time >= (rec_req.starts_at - INTERVAL '30 minutes') THEN 'OVERTIME'
                            WHEN status IN ('NORMAL', 'LATE', 'EARLY', 'LATE_AND_EARLY') AND v_total_hours > 0 THEN 'OVERTIME'
                            ELSE status
                        END,
                        notes = CASE 
                            WHEN notes IS NULL OR notes = '' THEN '[Ca tăng ca (OT)]'
                            WHEN notes NOT ILIKE '%[Ca tăng ca (OT)]%' THEN CONCAT('[Ca tăng ca (OT)] ', notes)
                            ELSE notes
                        END,
                        updated_at = clock_timestamp()
                    WHERE attendance_id = att_id;

                    INSERT INTO public.attendance_overtime_approvals (
                        attendance_id, approved_hours, decision, reviewer_user_id, reason, updated_at
                    )
                    VALUES (
                        att_id, 
                        v_total_hours, 
                        'APPROVED', 
                        NEW.reviewed_by, 
                        COALESCE(NEW.decision_reason, CONCAT('Đối soát OT Request #', NEW.request_id, ' (VERIFIED)')),
                        clock_timestamp()
                    )
                    ON CONFLICT (attendance_id) DO UPDATE SET
                        approved_hours = EXCLUDED.approved_hours,
                        decision = EXCLUDED.decision,
                        reviewer_user_id = EXCLUDED.reviewer_user_id,
                        reason = EXCLUDED.reason,
                        updated_at = clock_timestamp();
                ELSE
                    INSERT INTO public.attendance_overtime_approvals (
                        attendance_id, approved_hours, decision, reviewer_user_id, reason, updated_at
                    )
                    VALUES (
                        att_id, 
                        0, 
                        'APPROVED', 
                        NEW.reviewed_by, 
                        CONCAT('Giờ OT đã được gộp đối soát vào phiên #', target_att_id),
                        clock_timestamp()
                    )
                    ON CONFLICT (attendance_id) DO UPDATE SET
                        approved_hours = 0,
                        decision = EXCLUDED.decision,
                        reviewer_user_id = EXCLUDED.reviewer_user_id,
                        reason = EXCLUDED.reason,
                        updated_at = clock_timestamp();
                END IF;
            END LOOP;
        END IF;

    ELSIF NEW.status = 'REJECTED' THEN
        IF NEW.attendance_ids IS NOT NULL AND jsonb_array_length(NEW.attendance_ids) > 0 THEN
            FOR att_id_val IN SELECT jsonb_array_elements_text(NEW.attendance_ids) LOOP
                att_id := att_id_val::BIGINT;
                INSERT INTO public.attendance_overtime_approvals (
                    attendance_id, approved_hours, decision, reviewer_user_id, reason, updated_at
                )
                VALUES (
                    att_id, 
                    0, 
                    'REJECTED', 
                    NEW.reviewed_by, 
                    COALESCE(NEW.decision_reason, CONCAT('Từ chối đối soát OT Request #', NEW.request_id)),
                    clock_timestamp()
                )
                ON CONFLICT (attendance_id) DO UPDATE SET
                    approved_hours = 0,
                    decision = 'REJECTED',
                    reviewer_user_id = EXCLUDED.reviewer_user_id,
                    reason = EXCLUDED.reason,
                    updated_at = clock_timestamp();
            END LOOP;
        END IF;
    END IF;
    RETURN NEW;
END;
$func$;

-- 3. Đồng bộ lại signature cho tất cả các bản ghi đối soát
UPDATE public.overtime_reconciliations
SET source_signature = public.ot_reconciliation_source_signature(request_id);

