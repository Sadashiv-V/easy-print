"""Checks that every project file is in the right place with the right content.

Run from the backend folder:  python check_install.py
"""
import hashlib
import sys
from pathlib import Path

EXPECTED = {
    "alembic.ini": "55f6227b037e8558",
    "app/api/admin.py": "606c404208cd6407",
    "app/api/admin_stations.py": "36c1c8e0ad330780",
    "app/api/admin_wallet.py": "5fa9fe109b0de330",
    "app/api/agent.py": "5d1034c10266b8fe",
    "app/api/auth.py": "dbe0d17872ea3a2c",
    "app/api/deps.py": "d0bb29c1a680ef31",
    "app/api/documents.py": "ee27cc4d05da93e6",
    "app/api/jobs.py": "e9f53a286a6b8fc8",
    "app/api/station.py": "aa21938811fa2555",
    "app/api/station_deps.py": "c9b7bf22f519246e",
    "app/api/wallet.py": "dd440a52b7b94b99",
    "app/core/config.py": "5e86f6b49af8a28b",
    "app/core/crypto.py": "bc382c9235725877",
    "app/core/db.py": "82d66a092150b15e",
    "app/core/errors.py": "542a7ddcc066294d",
    "app/core/migrate.py": "f6f6f7d873d91562",
    "app/core/ratelimit.py": "b06d4a203c36b46b",
    "app/core/security.py": "7a32957927bd642a",
    "app/main.py": "14428296c3ec41c2",
    "app/models/accounts.py": "156c71520601d2b5",
    "app/models/audit.py": "1f298420ee950151",
    "app/models/documents.py": "af70598d7ab4bc5b",
    "app/models/jobs.py": "6aeb9a4a3bc53383",
    "app/models/pricing.py": "77590c5326f7f3e3",
    "app/models/stations.py": "ed581b12e16f1294",
    "app/models/wallet.py": "d6ddbbc0452f1ddb",
    "app/schemas/accounts.py": "f5d3caf0573419db",
    "app/schemas/agent.py": "57e7040c3f4d634a",
    "app/schemas/documents.py": "5f6bff597b9a5034",
    "app/schemas/stations.py": "b7a884cef9a3746d",
    "app/schemas/wallet.py": "3c82640425748497",
    "app/services/accounts.py": "13c4558171ec27f4",
    "app/services/agent.py": "0fdb1172787b39e3",
    "app/services/audit.py": "a1e0cdd21be03641",
    "app/services/documents.py": "0015b802b835295c",
    "app/services/jobs.py": "587d5309de22bc62",
    "app/services/pricing.py": "57ad86dcd6025345",
    "app/services/recharge.py": "8c41b68f9b106012",
    "app/services/stations.py": "146b0ef4874c2303",
    "app/services/wallet.py": "927b341638c6371b",
    "cli.py": "5c6c6431a4958410",
    "migrations/env.py": "43d323c3d9243bd0",
    "migrations/script.py.mako": "114d2c8daf110684",
    "migrations/versions/0001_accounts_and_audit.py": "29da13c4868d0c79",
    "migrations/versions/0002_documents_and_pricing.py": "8d929453b5a302ca",
    "migrations/versions/0003_wallet.py": "c1a56f02b2b7926b",
    "migrations/versions/0004_stations_and_print_jobs.py": "22f23bd4b245d95d",
    "migrations/versions/0005_print_agent_and_queue.py": "3abee49780b5cd98",
    "requirements-dev.txt": "83faa5058574c80f",
    "requirements.txt": "64831e3b77f28687",
    "tests/conftest.py": "15e162feb3741a6b",
    "tests/helpers.py": "57ecc0def3767613",
    "tests/test_accounts.py": "3024b97c0f8e4fc4",
    "tests/test_agent.py": "72708f8e3393ca5f",
    "tests/test_documents.py": "d931b97d500009a7",
    "tests/test_stations.py": "7d2f59bab3426e81",
    "tests/test_wallet.py": "e1c81b6a3aeb5d14",
}

ROOT = Path(__file__).resolve().parent


def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes().replace(b"\r\n", b"\n")).hexdigest()[:16]


def main() -> int:
    problems = 0
    for rel, want in EXPECTED.items():
        path = ROOT / rel
        if not path.exists():
            print(f"MISSING    {rel}")
            problems += 1
        elif digest(path) != want:
            print(f"DIFFERENT  {rel}   <- wrong or outdated content, copy this file again")
            problems += 1
    if problems:
        print(f"\n{problems} file(s) need attention (of {len(EXPECTED)} checked).")
        print("Tip: files with the same name exist in several folders. Check the folder shown above.")
        return 1
    print(f"All {len(EXPECTED)} files are correct.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
