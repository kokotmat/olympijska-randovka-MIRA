import sqlite3
import time
from contextlib import contextmanager
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo


class AIPaused(Exception):
    def __init__(self, reason, until=0):
        super().__init__(reason)
        self.until = until


def accounting_day(now=None):
    local = datetime.fromtimestamp(time.time() if now is None else now, ZoneInfo("Europe/Prague"))
    tomorrow = (local + timedelta(days=1)).replace(hour=0, minute=0, second=0, microsecond=0)
    return local.date().isoformat(), tomorrow.timestamp()


class Store:
    """Short independent transactions; safe across the worker and HTTP threads."""

    def __init__(self, path):
        self.path = path
        with self.connect() as db:
            db.executescript("""
                PRAGMA journal_mode=WAL;
                CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS threads (id TEXT PRIMARY KEY);
                CREATE TABLE IF NOT EXISTS jobs (
                    id TEXT PRIMARY KEY, thread_id TEXT NOT NULL,
                    state TEXT NOT NULL DEFAULT 'pending', reason TEXT NOT NULL DEFAULT '',
                    attempts INTEGER NOT NULL DEFAULT 0, next_attempt REAL NOT NULL DEFAULT 0,
                    draft_id TEXT, updated REAL NOT NULL
                );
                CREATE TABLE IF NOT EXISTS oauth (
                    session TEXT PRIMARY KEY, state TEXT NOT NULL,
                    verifier TEXT NOT NULL, expires REAL NOT NULL
                );
                CREATE TABLE IF NOT EXISTS ai_calls (
                    id INTEGER PRIMARY KEY AUTOINCREMENT, day TEXT NOT NULL,
                    started REAL NOT NULL, message_id TEXT NOT NULL, model TEXT NOT NULL,
                    status TEXT NOT NULL DEFAULT 'started',
                    input_tokens INTEGER, output_tokens INTEGER, thinking_tokens INTEGER,
                    cached_tokens INTEGER, total_tokens INTEGER
                );
                CREATE INDEX IF NOT EXISTS ai_calls_day ON ai_calls(day);
                CREATE TABLE IF NOT EXISTS ai_decisions (
                    message_id TEXT PRIMARY KEY, payload TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS ai_decision_versions (
                    message_id TEXT PRIMARY KEY, version TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS gmail_thread_queue (
                    id TEXT PRIMARY KEY, version INTEGER NOT NULL DEFAULT 1,
                    due REAL NOT NULL DEFAULT 0
                );
                CREATE TABLE IF NOT EXISTS gmail_body_cache (
                    id TEXT PRIMARY KEY, body TEXT NOT NULL, attachments TEXT NOT NULL
                );
            """)
            columns = {r[1] for r in db.execute("PRAGMA table_info(jobs)")}
            for name, definition in {"sender": "TEXT NOT NULL DEFAULT ''",
                                     "subject": "TEXT NOT NULL DEFAULT ''",
                                     "received_at": "REAL NOT NULL DEFAULT 0"}.items():
                if name not in columns:
                    db.execute(f"ALTER TABLE jobs ADD COLUMN {name} {definition}")
        path.chmod(0o600)

    @contextmanager
    def connect(self):
        db = sqlite3.connect(self.path, timeout=15)
        db.row_factory = sqlite3.Row
        try:
            with db:
                yield db
        finally:
            db.close()

    def meta(self, key, value=None):
        with self.connect() as db:
            if value is not None:
                db.execute("INSERT OR REPLACE INTO meta VALUES (?, ?)", (key, str(value)))
            row = db.execute("SELECT value FROM meta WHERE key=?", (key,)).fetchone()
            return row[0] if row else None

    def track(self, ids):
        with self.connect() as db:
            db.executemany("INSERT OR IGNORE INTO threads VALUES (?)", [(i,) for i in ids])

    def threads(self):
        with self.connect() as db:
            return [r[0] for r in db.execute("SELECT id FROM threads ORDER BY id")]

    def job(self, message_id):
        with self.connect() as db:
            row = db.execute("SELECT * FROM jobs WHERE id=?", (message_id,)).fetchone()
            return dict(row) if row else None

    def ensure_job(self, message_id, thread_id):
        with self.connect() as db:
            db.execute("INSERT OR IGNORE INTO jobs(id,thread_id,updated) VALUES (?,?,?)",
                       (message_id, thread_id, time.time()))
        return self.job(message_id)

    def update(self, message_id, state, reason="", **extra):
        allowed = {"attempts", "next_attempt", "draft_id"}
        if not set(extra) <= allowed:
            raise ValueError("Invalid job field")
        values = {"state": state, "reason": reason[:1500], "updated": time.time(), **extra}
        with self.connect() as db:
            assignments = ",".join(f"{key}=?" for key in values)
            db.execute(f"UPDATE jobs SET {assignments} WHERE id=?", (*values.values(), message_id))

    def save_identity(self, message_id, sender, subject, received_at):
        with self.connect() as db:
            db.execute("UPDATE jobs SET sender=?,subject=?,received_at=? WHERE id=?",
                       (sender[:1000] or "(odesílatel neuveden)", subject[:2000], received_at, message_id))

    def missing_identity_threads(self, limit=3):
        with self.connect() as db:
            return [r[0] for r in db.execute(
                "SELECT thread_id FROM jobs WHERE sender='' GROUP BY thread_id ORDER BY max(updated) DESC LIMIT ?", (limit,))]

    def recover(self):
        with self.connect() as db:
            db.execute("""UPDATE jobs SET state='uncertain', reason=?, updated=?
                          WHERE state='creating'""",
                       ("Proces skončil při vytváření konceptu. Zkontrolujte Gmail ručně.", time.time()))

    def jobs(self, limit=100):
        with self.connect() as db:
            return [dict(r) for r in db.execute(
                "SELECT * FROM jobs ORDER BY updated DESC LIMIT ?", (limit,))]

    def counts(self):
        with self.connect() as db:
            return dict(db.execute("SELECT state, count(*) FROM jobs GROUP BY state").fetchall())

    def save_oauth(self, session, state, verifier):
        with self.connect() as db:
            db.execute("DELETE FROM oauth WHERE expires < ?", (time.time(),))
            db.execute("INSERT INTO oauth VALUES (?,?,?,?)",
                       (session, state, verifier, time.time() + 600))

    def pop_oauth(self, session):
        with self.connect() as db:
            row = db.execute("SELECT * FROM oauth WHERE session=?", (session,)).fetchone()
            db.execute("DELETE FROM oauth WHERE session=?", (session,))
            return dict(row) if row and row["expires"] > time.time() else None

    def initialize_controls(self, start_paused=True):
        with self.connect() as db:
            db.execute("INSERT OR IGNORE INTO meta VALUES ('ai_paused', ?)", ("1" if start_paused else "0",))
            db.execute("INSERT OR IGNORE INTO meta VALUES ('processing_since', ?)", (str(time.time()),))

    def set_paused(self, paused):
        self.meta("ai_paused", "1" if paused else "0")

    def cooldown(self, until):
        with self.connect() as db:
            db.execute("BEGIN IMMEDIATE")
            old = db.execute("SELECT value FROM meta WHERE key='ai_blocked_until'").fetchone()
            db.execute("INSERT OR REPLACE INTO meta VALUES ('ai_blocked_until', ?)",
                       (str(max(float(old[0]) if old else 0, until)),))

    def _check_ai(self, db, daily_limit):
        day, reset = accounting_day()
        meta = dict(db.execute("SELECT key,value FROM meta"))
        if meta.get("ai_paused") == "1":
            raise AIPaused("Generování je ručně pozastavené", time.time() + 120)
        blocked = float(meta.get("ai_blocked_until", 0))
        if blocked > time.time():
            raise AIPaused("Čekání po omezení nebo chybě poskytovatele AI", blocked)
        count = db.execute("SELECT count(*) FROM ai_calls WHERE day=?", (day,)).fetchone()[0]
        if count >= daily_limit:
            raise AIPaused("Dosažen denní limit AI volání", reset)
        return day

    def check_ai(self, daily_limit):
        with self.connect() as db:
            return self._check_ai(db, daily_limit)

    def reserve_call(self, message_id, model, daily_limit):
        # Count BEFORE contacting the provider; crash/timeout cannot reset the allowance.
        with self.connect() as db:
            db.execute("BEGIN IMMEDIATE")
            day = self._check_ai(db, daily_limit)
            cursor = db.execute("INSERT INTO ai_calls(day,started,message_id,model) VALUES (?,?,?,?)",
                                (day, time.time(), message_id, model))
            return cursor.lastrowid

    def finish_call(self, call_id, status, usage=None):
        fields = ("prompt_token_count", "candidates_token_count", "thoughts_token_count",
                  "cached_content_token_count", "total_token_count")
        values = [getattr(usage, key, None) if usage is not None else None for key in fields]
        with self.connect() as db:
            db.execute("""UPDATE ai_calls SET status=?, input_tokens=?,output_tokens=?,thinking_tokens=?,
                          cached_tokens=?,total_tokens=? WHERE id=?""", (status, *values, call_id))

    def usage(self, daily_limit):
        day, reset = accounting_day()
        with self.connect() as db:
            result = dict(db.execute("""SELECT count(*) AS requests,
                coalesce(sum(input_tokens),0) AS input_tokens,
                coalesce(sum(output_tokens),0) AS output_tokens,
                coalesce(sum(thinking_tokens),0) AS thinking_tokens,
                coalesce(sum(cached_tokens),0) AS cached_tokens,
                coalesce(sum(total_tokens),0) AS total_tokens,
                count(*) - count(total_tokens) AS requests_without_token_report
                FROM ai_calls WHERE day=?""", (day,)).fetchone())
            result["recent_calls"] = [dict(row) for row in db.execute(
                "SELECT * FROM ai_calls ORDER BY id DESC LIMIT 30")]
        return {"day": day, "timezone": "Europe/Prague", "resets_at": reset,
                "daily_request_limit": daily_limit, "remaining_requests": max(0, daily_limit - result["requests"]),
                "paused": self.meta("ai_paused") == "1",
                "blocked_until": float(self.meta("ai_blocked_until") or 0),
                "processing_since": float(self.meta("processing_since") or 0), **result}

    def decision(self, message_id, payload=None, context_version=None):
        with self.connect() as db:
            if payload is not None:
                db.execute("INSERT OR REPLACE INTO ai_decisions VALUES (?,?)", (message_id, payload))
                db.execute("DELETE FROM ai_decision_versions WHERE message_id=?", (message_id,))
                if context_version is not None:
                    db.execute("INSERT INTO ai_decision_versions VALUES (?,?)", (message_id, context_version))
            row = db.execute("SELECT payload FROM ai_decisions WHERE message_id=?", (message_id,)).fetchone()
            return row[0] if row else None

    def decision_version(self, message_id):
        with self.connect() as db:
            row = db.execute("SELECT version FROM ai_decision_versions WHERE message_id=?", (message_id,)).fetchone()
            return row[0] if row else None

    def clear_decision(self, message_id):
        with self.connect() as db:
            db.execute("DELETE FROM ai_decisions WHERE message_id=?", (message_id,))
            db.execute("DELETE FROM ai_decision_versions WHERE message_id=?", (message_id,))
