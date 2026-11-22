-- 0022: AI assistant usage log. Counts only: who used which feature and when. The questions and answers are NOT stored. Additive only.
CREATE TABLE IF NOT EXISTS ai_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER, feature TEXT NOT NULL, ok INTEGER NOT NULL DEFAULT 1, created_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_ai_log_day ON ai_log(created_at);
