CREATE TABLE IF NOT EXISTS delivery_cancellations (
 source TEXT NOT NULL, source_id TEXT NOT NULL, created_at INTEGER NOT NULL,
 PRIMARY KEY(source,source_id)
);
