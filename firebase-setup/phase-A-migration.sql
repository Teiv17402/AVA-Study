-- =========================================================
-- PHASE A MIGRATION — Settings + Dashboard + Streak
-- Chạy 1 lần trong Supabase SQL Editor
-- =========================================================

-- 1. Thêm cột cho user profile mở rộng (Hồ sơ tab)
ALTER TABLE user_progress
  ADD COLUMN IF NOT EXISTS phone        text DEFAULT '',
  ADD COLUMN IF NOT EXISTS bio          text DEFAULT '',
  ADD COLUMN IF NOT EXISTS custom_name  text DEFAULT '',
  ADD COLUMN IF NOT EXISTS custom_avatar text DEFAULT '';

-- 2. Notification preferences (Thông báo tab) — JSONB linh hoạt
ALTER TABLE user_progress
  ADD COLUMN IF NOT EXISTS notification_prefs jsonb DEFAULT '{
    "email_reminders":     true,
    "email_milestones":    true,
    "email_promotions":    true,
    "email_newsletter":    true,
    "push_messages":       true,
    "push_reminders":      true,
    "push_achievements":   true
  }'::jsonb;

-- 3. Streak tracking (Dashboard)
ALTER TABLE user_progress
  ADD COLUMN IF NOT EXISTS streak_days        int DEFAULT 0,
  ADD COLUMN IF NOT EXISTS streak_longest     int DEFAULT 0,
  ADD COLUMN IF NOT EXISTS streak_last_date   date,
  ADD COLUMN IF NOT EXISTS xp_total           int DEFAULT 0;
  -- xp_total computed lazily ở client (cộng từ completed*10 + courses*100 + quiz*20 - violations*10)
  -- Lưu cache để leaderboard / dashboard load nhanh, sẽ recompute khi mark lesson completed

-- 4. RLS bổ sung: cho phép user update các cột Hồ sơ + Notification của chính mình
--   (giả định bạn đã có policy "Users can update own progress" — nếu chưa, mở comment bên dưới)
-- DROP POLICY IF EXISTS "user_update_own_profile" ON user_progress;
-- CREATE POLICY "user_update_own_profile" ON user_progress
--   FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- 5. Trigger backfill notification_prefs cho các user cũ (nếu cột vừa thêm là NULL)
UPDATE user_progress
SET notification_prefs = '{
  "email_reminders":     true,
  "email_milestones":    true,
  "email_promotions":    true,
  "email_newsletter":    true,
  "push_messages":       true,
  "push_reminders":      true,
  "push_achievements":   true
}'::jsonb
WHERE notification_prefs IS NULL;

-- 6. Check
SELECT user_id, email, phone, bio, notification_prefs, streak_days, xp_total
FROM user_progress LIMIT 5;
