CREATE TABLE IF NOT EXISTS delivery_settings(id INTEGER PRIMARY KEY CHECK(id=1), mode TEXT NOT NULL, daily_budget INTEGER NOT NULL, revision INTEGER NOT NULL, updated_at INTEGER NOT NULL, actor TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS admin_actions(id TEXT PRIMARY KEY, actor TEXT NOT NULL, operation TEXT NOT NULL, fingerprint TEXT NOT NULL, result TEXT NOT NULL, created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS delivery_resolutions(job_id TEXT PRIMARY KEY, actor TEXT NOT NULL, outcome TEXT NOT NULL, evidence TEXT NOT NULL, provider_id TEXT, created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS web_partners(id TEXT PRIMARY KEY, sponsor_id TEXT NOT NULL, name TEXT NOT NULL, url TEXT NOT NULL, mime TEXT NOT NULL, image TEXT NOT NULL, state TEXT NOT NULL, revision INTEGER NOT NULL, actor TEXT NOT NULL, updated_at INTEGER NOT NULL);
CREATE UNIQUE INDEX IF NOT EXISTS web_partner_published ON web_partners(sponsor_id) WHERE state='published';
