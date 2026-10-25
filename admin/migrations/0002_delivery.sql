CREATE TABLE IF NOT EXISTS delivery_jobs (
 id TEXT PRIMARY KEY, source TEXT NOT NULL, source_id TEXT NOT NULL,
 fingerprint TEXT NOT NULL, mode TEXT NOT NULL, kind TEXT NOT NULL, priority INTEGER NOT NULL,
 recipient TEXT NOT NULL, subject TEXT NOT NULL, payload TEXT NOT NULL,
 state TEXT NOT NULL, created_at INTEGER NOT NULL, expires_at INTEGER,
 attempt_at INTEGER, provider_id TEXT, accepted_at INTEGER, delivered_at INTEGER,
 error_code TEXT, event_at INTEGER, UNIQUE(source,source_id)
);
CREATE INDEX IF NOT EXISTS delivery_pending ON delivery_jobs(state,priority,created_at);
CREATE TABLE IF NOT EXISTS delivery_attempts (
 id TEXT PRIMARY KEY, job_id TEXT NOT NULL, started_at INTEGER NOT NULL,
 finished_at INTEGER, state TEXT NOT NULL, provider_id TEXT, error_code TEXT
);
CREATE TABLE IF NOT EXISTS delivery_events (
 id TEXT PRIMARY KEY, job_id TEXT NOT NULL, event TEXT NOT NULL,
 provider_id TEXT NOT NULL, occurred_at INTEGER NOT NULL, received_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS delivery_controls (
 source TEXT PRIMARY KEY, enabled INTEGER NOT NULL, policy TEXT NOT NULL,
 checked_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS delivery_nonces (id TEXT PRIMARY KEY, expires_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS delivery_suppressions (recipient TEXT PRIMARY KEY, reason TEXT NOT NULL, created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS delivery_lock (id INTEGER PRIMARY KEY CHECK(id=1), owner TEXT, until_at INTEGER NOT NULL);
INSERT OR IGNORE INTO delivery_lock(id,owner,until_at) VALUES(1,'',0);
