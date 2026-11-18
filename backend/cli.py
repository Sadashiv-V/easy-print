import argparse
import csv
import getpass
import os
import sys
from pathlib import Path

from app.core.config import DATA_DIR
from app.core.db import SessionLocal
from app.core.migrate import run_migrations
from app.services import accounts as svc


def cmd_import_roster(args) -> int:
    path = Path(args.csv_file)
    if not path.exists():
        print(f"File not found: {path}")
        return 1
    with open(path, newline="", encoding="utf-8-sig") as f:
        rows = list(csv.DictReader(f))

    run_migrations()
    with SessionLocal() as db:
        codes, skipped = svc.import_roster(db, rows)

    out = DATA_DIR / "activation_codes.csv"
    if codes:
        with open(out, "w", newline="", encoding="utf-8") as f:
            writer = csv.writer(f)
            writer.writerow(["college_id", "full_name", "activation_code"])
            writer.writerows(codes)

    print(f"Imported {len(codes)} people, skipped {len(skipped)}.")
    for line, cid, reason in skipped:
        print(f"  line {line}: {cid or '(blank)'} - {reason}")
    if codes:
        print(f"Activation codes written to: {out}")
        print("Hand these out privately, then delete that file. Never share or commit it.")
    return 0


def cmd_create_admin(args) -> int:
    password = os.environ.get("EASYPRINT_ADMIN_PASSWORD") or getpass.getpass("Admin password: ")
    run_migrations()
    with SessionLocal() as db:
        try:
            user = svc.create_admin(db, args.college_id, args.full_name, password)
        except svc.AccountError as exc:
            print(f"Could not create admin: {exc.detail}")
            return 1
    print(f"Admin created: {user.college_id}")
    return 0


def cmd_reset_password(args) -> int:
    """Server-side password reset for any account (admin recovery, or helping a locked-out user
    without email access). Requires terminal/server access, so it bypasses OTP and roster email
    entirely. Use this when an admin forgets their own password and there's no one else who can
    reset it through the website.
    """
    password = os.environ.get("EASYPRINT_RESET_PASSWORD") or getpass.getpass("New password: ")
    confirm = os.environ.get("EASYPRINT_RESET_PASSWORD") or getpass.getpass("Confirm new password: ")
    if password != confirm:
        print("Passwords do not match.")
        return 1

    run_migrations()
    with SessionLocal() as db:
        try:
            user = svc.reset_password_by_cli(db, args.college_id, password)
        except svc.AccountError as exc:
            print(f"Could not reset password: {exc.detail}")
            return 1
    print(f"Password reset for {user.college_id} ({user.role}). They are signed out of any active session.")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(prog="cli.py")
    sub = parser.add_subparsers(dest="command", required=True)

    p = sub.add_parser("import-roster", help="Import a roster CSV and generate activation codes")
    p.add_argument("csv_file")
    p.set_defaults(func=cmd_import_roster)

    p = sub.add_parser("create-admin", help="Create an admin account")
    p.add_argument("college_id")
    p.add_argument("full_name")
    p.set_defaults(func=cmd_create_admin)

    p = sub.add_parser("reset-password", help="Reset any account's password from the server (admin recovery)")
    p.add_argument("college_id")
    p.set_defaults(func=cmd_reset_password)

    args = parser.parse_args()
    return args.func(args)


if __name__ == "__main__":
    sys.exit(main())