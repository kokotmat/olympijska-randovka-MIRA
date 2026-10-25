"""Off-server consistent state backup. No OAuth token or active OAuth sessions exported."""
import base64
import gzip
import hashlib
import hmac
import json
import os
import sqlite3
import time
import urllib.request
import uuid
from contextlib import closing
from datetime import datetime
from zoneinfo import ZoneInfo


def envelope(op, args, secret, now=None):
    value = {"source": "assistant", "op": op, "args": args,
             "ts": int((time.time() if now is None else now) * 1000), "nonce": str(uuid.uuid4())}
    canonical = json.dumps(["randovka-ops-v1", value["ts"], value["nonce"], "assistant", op, args],
                           ensure_ascii=False, separators=(",", ":"))
    value["signature"] = hmac.new(secret.encode(), canonical.encode(), hashlib.sha256).hexdigest()
    return value


def sqlite_snapshot(path):
    with closing(sqlite3.connect(str(path), timeout=30)) as source:
        with closing(sqlite3.connect(":memory:")) as snapshot:
            source.backup(snapshot)
            snapshot.execute("PRAGMA secure_delete=ON")
            if snapshot.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name='oauth'").fetchone():
                snapshot.execute("DELETE FROM oauth")
                snapshot.commit()
            snapshot.execute("VACUUM")
            if snapshot.execute("PRAGMA integrity_check").fetchone()[0] != "ok":
                raise ValueError("OPS_SQLITE_INTEGRITY")
            return snapshot.serialize()


def post(op, args, secret):
    body = json.dumps(envelope(op, args, secret), ensure_ascii=False, separators=(",", ":")).encode()
    request = urllib.request.Request("https://olympijskarandovka.cz/api/ops", data=body,
                                     headers={"Content-Type": "application/json"}, method="POST")
    # urllib normally follows redirects. An operations request must never move its signed body.
    class NoRedirect(urllib.request.HTTPRedirectHandler):
        def redirect_request(self, req, fp, code, msg, headers, newurl):
            return None
    with urllib.request.build_opener(NoRedirect).open(request, timeout=15) as response:
        if response.status != 200:
            raise ValueError("OPS_REMOTE_FAILED")
        result = json.loads(response.read(2_000_000))
    if result.get("status") != "success":
        raise ValueError("OPS_REMOTE_FAILED")
    return result["data"]


def synchronize(store, send=post, secret=None):
    secret = os.getenv("ADMIN_BRIDGE_SECRET", "") if secret is None else secret
    if len(secret) < 32:
        return
    day = datetime.now(ZoneInfo("Europe/Prague")).date().isoformat()
    if store.meta("ops_backup_day") != day:
        data = gzip.compress(sqlite_snapshot(store.path), mtime=0)
        encoded = base64.b64encode(data).decode()
        if len(encoded) > 1_500_000:
            raise ValueError("OPS_BACKUP_TOO_LARGE")
        reply = send("backup", {"day": day, "format": "sqlite-gzip-v1",
                                "sha256": hashlib.sha256(data).hexdigest(), "payload": encoded}, secret)
        if not reply.get("stored"):
            raise ValueError("OPS_BACKUP_UNCONFIRMED")
        store.meta("ops_backup_day", day)
        store.meta("ops_backup_at", time.time())
    send("report", {"state": "ok", "issues": []}, secret)
    store.meta("ops_error", "")
