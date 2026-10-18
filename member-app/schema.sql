-- 會員資料表
CREATE TABLE IF NOT EXISTS members (
  line_user_id TEXT PRIMARY KEY,      -- LINE 使用者 ID（U 開頭）
  display_name TEXT,                  -- LINE 顯示名稱（每次登入更新）
  birth        TEXT,                  -- 綁定的本人國曆生日 YYYY-MM-DD
  plan         TEXT,                  -- 方案名稱，例如「年費」「兩年」
  expires_at   TEXT,                  -- 到期日 YYYY-MM-DD（含當天可用）；空白 = 未開通
  note         TEXT,                  -- 管理備註（付款方式、金額等）
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL,
  last_seen_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_members_expires ON members(expires_at);

-- 管理操作紀錄
CREATE TABLE IF NOT EXISTS admin_log (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  admin_id     TEXT NOT NULL,
  target_id    TEXT NOT NULL,
  action       TEXT NOT NULL,
  detail       TEXT,
  created_at   TEXT NOT NULL
);
