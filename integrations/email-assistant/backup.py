"""Consistent local pre-upgrade snapshot. Never restores over live data."""
import hashlib
import json
import os
import shutil
import sqlite3
import uuid
from contextlib import closing
from pathlib import Path


def snapshot_before_upgrade(data_dir, release):
    root = Path(data_dir)
    source = root / 'state.sqlite3'
    if not source.exists():
        return None
    if not release or any(c not in 'abcdefghijklmnopqrstuvwxyz0123456789-' for c in release):
        raise ValueError('Invalid snapshot release')
    snapshots = root / 'backups'
    snapshots.mkdir(mode=0o700, exist_ok=True)
    destination = snapshots / release
    if destination.exists():
        manifest = json.loads((destination / 'manifest.json').read_text(encoding='utf-8'))
        for name, digest in manifest['sha256'].items():
            if name not in {'state.sqlite3', 'token.json'}:
                raise ValueError('Invalid snapshot manifest')
            if hashlib.sha256((destination / name).read_bytes()).hexdigest() != digest:
                raise ValueError('Snapshot checksum mismatch')
        return destination
    staging = snapshots / ('.pending-' + str(uuid.uuid4()))
    staging.mkdir(mode=0o700)
    # SQLite backup API includes committed WAL content; copying only the database file does not.
    with closing(sqlite3.connect(source.as_uri() + '?mode=ro', uri=True, timeout=30)) as src:
        with closing(sqlite3.connect(staging / 'state.sqlite3')) as dst:
            src.backup(dst)
            if dst.execute('PRAGMA integrity_check').fetchone()[0] != 'ok':
                raise ValueError('Snapshot integrity check failed')
    files = ['state.sqlite3']
    if (root / 'token.json').exists():
        # OAuth tokens are written using atomic replace; this reads one complete version.
        shutil.copyfile(root / 'token.json', staging / 'token.json')
        files.append('token.json')
    for name in files:
        (staging / name).chmod(0o600)
    manifest = {'release': release, 'sqlite_integrity': 'ok', 'sha256': {
        name: hashlib.sha256((staging / name).read_bytes()).hexdigest() for name in files}}
    (staging / 'manifest.json').write_text(json.dumps(manifest, indent=2), encoding='utf-8')
    (staging / 'manifest.json').chmod(0o600)
    os.rename(staging, destination)
    return destination
