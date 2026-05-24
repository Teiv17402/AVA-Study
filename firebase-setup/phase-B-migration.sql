-- =========================================================
-- PHASE B MIGRATION — Streak Protection + My Courses + Social Proof
-- Chạy 1 lần trong Supabase SQL Editor
-- =========================================================

-- 1. Streak freeze quota (1 freeze/tuần, reset thứ 2)
ALTER TABLE user_progress
  ADD COLUMN IF NOT EXISTS streak_freezes_available  int  DEFAULT 1,
  ADD COLUMN IF NOT EXISTS streak_freezes_used_total int  DEFAULT 0,
  ADD COLUMN IF NOT EXISTS streak_last_freeze_date   date,
  ADD COLUMN IF NOT EXISTS streak_week_reset_date    date;

-- Backfill cho user cũ: cho ai cũng có 1 freeze quota
UPDATE user_progress
SET streak_freezes_available = 1
WHERE streak_freezes_available IS NULL;

-- 2. Social Proof — view aggregate hoạt động gần đây
--    Compute từ user_progress.completed (mảng JSONB) + user_progress.last_update
--    Để đơn giản: tạo VIEW thay vì table mới
CREATE OR REPLACE VIEW v_recent_activity AS
SELECT
  user_id,
  display_name,
  email,
  last_update                                      AS event_at,
  COALESCE(jsonb_array_length(completed::jsonb), 0) AS total_completed,
  COALESCE(xp_total, 0)                             AS xp_total,
  COALESCE(streak_days, 0)                          AS streak_days
FROM user_progress
WHERE role != 'admin'
  AND last_update IS NOT NULL
  AND last_update > NOW() - INTERVAL '24 hours'
ORDER BY last_update DESC
LIMIT 20;

-- Grant select public — RLS bảo vệ ở user_progress
GRANT SELECT ON v_recent_activity TO anon, authenticated;

-- 3. Check
SELECT user_id, email, streak_days, streak_freezes_available, xp_total
FROM user_progress
LIMIT 5;

SELECT * FROM v_recent_activity LIMIT 5;
