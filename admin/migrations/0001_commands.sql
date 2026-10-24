CREATE TABLE IF NOT EXISTS commands (
  id TEXT PRIMARY KEY, actor TEXT NOT NULL, component TEXT NOT NULL,
  operation TEXT NOT NULL, fingerprint TEXT NOT NULL,
  state TEXT NOT NULL CHECK(state IN ('pending','done','rejected','uncertain')),
  result TEXT, created_at INTEGER NOT NULL, finished_at INTEGER
);
CREATE INDEX IF NOT EXISTS commands_recent ON commands(created_at DESC);
