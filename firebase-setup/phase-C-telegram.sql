-- =========================================================
-- PHASE C MIGRATION — Telegram Bot Integration
-- =========================================================

-- 1. Cột telegram trong user_progress
ALTER TABLE user_progress
  ADD COLUMN IF NOT EXISTS telegram_chat_id      bigint,
  ADD COLUMN IF NOT EXISTS telegram_username     text,
  ADD COLUMN IF NOT EXISTS telegram_linked_at    timestamptz,
  ADD COLUMN IF NOT EXISTS telegram_last_reminder timestamptz;

CREATE INDEX IF NOT EXISTS idx_user_telegram_chat
  ON user_progress(telegram_chat_id)
  WHERE telegram_chat_id IS NOT NULL;

-- 2. Bảng telegram_pending_links — token tạm để liên kết
--    User vào Settings -> generate token -> mở t.me/AVAxTSB_report_bot?start=TOKEN
--    Bot nhận /start TOKEN -> lookup pending -> save chat_id vào user_progress -> xoá pending
CREATE TABLE IF NOT EXISTS telegram_pending_links (
  token       text PRIMARY KEY,
  user_id     uuid NOT NULL REFERENCES user_progress(user_id) ON DELETE CASCADE,
  created_at  timestamptz DEFAULT now(),
  expires_at  timestamptz DEFAULT now() + INTERVAL '15 minutes'
);

-- Tự cleanup token cũ
CREATE INDEX IF NOT EXISTS idx_telegram_pending_expires
  ON telegram_pending_links(expires_at);

-- RLS policy: user chỉ insert/delete pending của chính họ
ALTER TABLE telegram_pending_links ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "user_own_pending_links_insert" ON telegram_pending_links;
CREATE POLICY "user_own_pending_links_insert"
  ON telegram_pending_links FOR INSERT
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "user_own_pending_links_select" ON telegram_pending_links;
CREATE POLICY "user_own_pending_links_select"
  ON telegram_pending_links FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "user_own_pending_links_delete" ON telegram_pending_links;
CREATE POLICY "user_own_pending_links_delete"
  ON telegram_pending_links FOR DELETE
  USING (auth.uid() = user_id);

-- 3. Check
SELECT user_id, email, telegram_chat_id, telegram_username, telegram_linked_at
FROM user_progress LIMIT 5;
