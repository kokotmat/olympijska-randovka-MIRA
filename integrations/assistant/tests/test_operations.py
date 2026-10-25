import base64
import gzip
import hashlib
import hmac
import json
import sqlite3
import tempfile
import unittest
from unittest.mock import patch
from pathlib import Path
from app.operations import envelope, sqlite_snapshot, synchronize, post
from app.store import Store


class OperationsTests(unittest.TestCase):
    def test_service_identifies_itself_without_changing_signed_protocol(self):
        class Response:
            status = 200
            def __enter__(self): return self
            def __exit__(self, *args): pass
            def read(self, limit): return b'{"status":"success","data":{"recorded":true}}'
        with patch('app.operations.urllib.request.build_opener') as opener:
            opener.return_value.open.return_value = Response()
            self.assertEqual(post('report', {'state': 'ok', 'issues': []}, 'offline-key'*4), {'recorded': True})
            request = opener.return_value.open.call_args.args[0]
            self.assertEqual(request.get_header('User-agent'), 'RandovkaOperations/1.0')
            self.assertEqual(json.loads(request.data)['source'], 'assistant')

    def test_snapshot_restores_committed_wal_and_drops_oauth_sessions(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "live.sqlite3"
            db = sqlite3.connect(path)
            db.execute("PRAGMA journal_mode=WAL")
            db.executescript("CREATE TABLE records(id TEXT); CREATE TABLE oauth(verifier TEXT);")
            db.execute("INSERT INTO records VALUES('committed WAL row')")
            db.execute("INSERT INTO oauth VALUES('private-verifier-not-to-export')")
            db.commit()
            raw = sqlite_snapshot(path)
            self.assertNotIn(b"private-verifier-not-to-export", raw)
            restored = sqlite3.connect(":memory:")
            restored.deserialize(raw)
            self.assertEqual(restored.execute("PRAGMA integrity_check").fetchone()[0], "ok")
            self.assertEqual(restored.execute("SELECT * FROM records").fetchone()[0], "committed WAL row")
            self.assertEqual(restored.execute("SELECT COUNT(*) FROM oauth").fetchone()[0], 0)
            self.assertEqual(db.execute("SELECT COUNT(*) FROM oauth").fetchone()[0], 1)
            restored.close()
            db.close()

    def test_signing_and_daily_idempotent_upload(self):
        key = "offline-ops-key" * 4
        e = envelope("report", {"state": "ok", "issues": []}, key, 1234)
        canonical = json.dumps(["randovka-ops-v1", e["ts"], e["nonce"], e["source"], e["op"], e["args"]], separators=(",", ":"))
        self.assertEqual(e["signature"], hmac.new(key.encode(), canonical.encode(), hashlib.sha256).hexdigest())
        with tempfile.TemporaryDirectory() as folder:
            store = Store(Path(folder) / "state.sqlite3")
            calls = []
            def send(op, args, _):
                calls.append(op)
                if op == "backup":
                    self.assertTrue(gzip.decompress(base64.b64decode(args["payload"])).startswith(b"SQLite format 3"))
                    return {"stored": True}
                return {"recorded": True}
            synchronize(store, send, key)
            synchronize(store, send, key)
            self.assertEqual(calls, ["backup", "report", "report"])


if __name__ == "__main__":
    unittest.main()
