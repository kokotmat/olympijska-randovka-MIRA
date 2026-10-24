"""Narrow, signed administrative bridge. It cannot send emails or change secrets."""
import hashlib
import hmac
import json
import os
import re
import time
from urllib.parse import quote

from fastapi import Request
from fastapi.responses import JSONResponse


def compact(value):
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"))


def version(value):
    return hashlib.sha256(compact(value).encode()).hexdigest()


def initialize(store):
    with store.connect() as db:
        db.execute("""CREATE TABLE IF NOT EXISTS admin_commands (
            id TEXT PRIMARY KEY, fingerprint TEXT NOT NULL, actor TEXT NOT NULL,
            operation TEXT NOT NULL, state TEXT NOT NULL, result TEXT NOT NULL,
            created_at REAL NOT NULL, finished_at REAL NOT NULL)""")


def authenticate(data):
    secret = os.getenv("ADMIN_BRIDGE_SECRET", "")
    allowed = {v.strip().lower() for v in os.getenv("ADMIN_ALLOWED_EMAILS", "").split(",") if v.strip()}
    if len(secret) < 32 or not allowed:
        raise ValueError("BRIDGE_NOT_CONFIGURED")
    if (data.get("v") != 1 or type(data.get("ts")) is not int
            or abs(time.time()*1000-data["ts"]) > 120000
            or not re.fullmatch(r"[a-fA-F0-9-]{36}", data.get("nonce", ""))
            or data.get("actor") not in allowed or not isinstance(data.get("args"), dict)):
        raise ValueError("AUTH")
    value = compact(["randovka-admin-v1", data["ts"], data["nonce"], data.get("op"),
                     data["actor"], data.get("commandId", ""), data.get("expectedVersion", ""), data["args"]])
    expected = hmac.new(secret.encode(), value.encode(), hashlib.sha256).hexdigest()
    if not hmac.compare_digest(expected, str(data.get("signature", ""))):
        raise ValueError("AUTH")


def process(data, store, settings, worker):
    authenticate(data)
    initialize(store)
    op, args = data.get("op"), data["args"]
    if op == "health":
        usage = store.usage(settings.daily_ai_requests)
        last_success = float(store.meta("last_success") or 0)
        ready = (worker.thread.is_alive() and last_success > 0
                 and time.time()-last_success <= max(600, getattr(settings, "interval", 120)*3)
                 and not store.meta("last_error")
                 and float(store.meta("gmail_blocked_until") or 0) <= time.time())
        return {"status": "success", "data": {
            "release": "central-admin-v1", "checkedAt": int(time.time()*1000),
            "paused": usage["paused"], "requests": usage["requests"],
            "dailyLimit": usage["daily_request_limit"], "jobs": store.counts(),
            "lastSuccess": int(float(store.meta("last_success") or 0)*1000),
            "lastError": bool(store.meta("last_error")),
            "gmailBlockedUntil": float(store.meta("gmail_blocked_until") or 0)*1000,
            "workerRunning": worker.thread.is_alive(), "ready": bool(ready)}}
    if op == "usage":
        usage = store.usage(settings.daily_ai_requests)
        return {"status": "success", "data": {**usage, "version": version([usage["paused"]])}}
    if op == "jobs":
        rows = store.jobs()
        for row in rows:
            row["version"] = version(row)
            row["gmailUrl"] = ("https://mail.google.com/mail/u/?authuser=" + quote(settings.account)
                               + "#all/" + quote(row["thread_id"])) if re.fullmatch(r"[a-fA-F0-9]+", row["thread_id"]) else None
        return {"status": "success", "data": {"items": rows, "checkedAt": int(time.time()*1000)}}
    if op == "history":
        with store.connect() as db:
            rows = [dict(row) for row in db.execute("SELECT id,actor,operation,state,created_at,finished_at FROM admin_commands ORDER BY created_at DESC LIMIT 100")]
        return {"status": "success", "data": {"items": rows}}
    if op == "commandStatus":
        with store.connect() as db:
            row = db.execute("SELECT state,result FROM admin_commands WHERE id=? AND actor=?",
                             (str(args.get("id", "")), data["actor"])).fetchone()
        return {"status": "success", "data": {"state": row["state"], "result": json.loads(row["result"])}
                if row else {"state": "not_found"}}
    if op not in {"pauseAi", "resumeAi", "retryJob"} or not re.fullmatch(r"[a-fA-F0-9-]{36}", data.get("commandId", "")):
        raise ValueError("REJECTED")
    fingerprint = version([data["actor"], op, args, data.get("expectedVersion", "")])
    with store.connect() as db:
        db.execute("BEGIN IMMEDIATE")
        prior = db.execute("SELECT * FROM admin_commands WHERE id=?", (data["commandId"],)).fetchone()
        if prior:
            if prior["fingerprint"] != fingerprint:
                raise ValueError("COMMAND_CONFLICT")
            return json.loads(prior["result"])
        try:
            if op in {"pauseAi", "resumeAi"}:
                row = db.execute("SELECT value FROM meta WHERE key='ai_paused'").fetchone()
                if version([bool(row and row[0] == "1")]) != data.get("expectedVersion"):
                    raise ValueError("CONFLICT")
                db.execute("INSERT OR REPLACE INTO meta VALUES ('ai_paused', ?)", ("1" if op == "pauseAi" else "0",))
                # Resume does not erase provider cooldowns or daily allowance.
                result = {"status": "success", "data": {"paused": op == "pauseAi"}}
            else:
                row = db.execute("SELECT * FROM jobs WHERE id=?", (str(args.get("id", "")),)).fetchone()
                if not row:
                    raise ValueError("NOT_FOUND")
                if version(dict(row)) != data.get("expectedVersion"):
                    raise ValueError("CONFLICT")
                if row["state"] not in {"error", "review", "historical"}:
                    raise ValueError("REJECTED")
                if row["state"] != "error":
                    db.execute("DELETE FROM ai_decisions WHERE message_id=?", (row["id"],))
                    db.execute("DELETE FROM ai_decision_versions WHERE message_id=?", (row["id"],))
                db.execute("UPDATE jobs SET state='pending',reason=?,attempts=0,next_attempt=0,updated=? WHERE id=?",
                           ("Ruční zařazení přes centrální administraci", time.time(), row["id"]))
                db.execute("""INSERT INTO gmail_thread_queue(id) VALUES (?)
                    ON CONFLICT(id) DO UPDATE SET version=version+1,due=0""", (row["thread_id"],))
                result = {"status": "success", "data": {"queued": True}}
        except ValueError as error:
            if str(error) not in {"CONFLICT", "NOT_FOUND", "REJECTED"}:
                raise
            result = {"status": "error", "code": str(error)}
        now = time.time()
        db.execute("INSERT INTO admin_commands VALUES (?,?,?,?,?,?,?,?)", (data["commandId"], fingerprint,
                   data["actor"], op, "done" if result["status"] == "success" else "rejected", compact(result), now, now))
    worker.wake.set()
    return result


async def endpoint(request: Request):
    try:
        raw = bytearray()
        async for part in request.stream():
            raw.extend(part)
            if len(raw) > 12000:
                return JSONResponse({"status": "error", "code": "REQUEST_TOO_LARGE"}, status_code=413)
        result = process(json.loads(raw), request.app.state.store, request.app.state.settings, request.app.state.worker)
        return JSONResponse(result, headers={"Cache-Control": "no-store"})
    except (ValueError, TypeError, KeyError) as error:
        code = str(error) if str(error) in {"AUTH", "BRIDGE_NOT_CONFIGURED", "REJECTED", "COMMAND_CONFLICT"} else "REJECTED"
        return JSONResponse({"status": "error", "code": code})
    except Exception:
        return JSONResponse({"status": "error", "code": "BRIDGE_UNAVAILABLE"}, status_code=503)
