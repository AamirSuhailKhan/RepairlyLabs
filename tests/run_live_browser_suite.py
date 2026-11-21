"""Safe, portable browser suite for a fresh isolated test database.

This intentionally does NOT log into the owner's live account, embed a real
password, or assume a particular Windows path. Tests/browser_e2e.py starts and
stops its own local Node server with test-only credentials in a temporary DB.
Run: python tests/run_live_browser_suite.py
"""
from pathlib import Path
import subprocess
import sys

if __name__ == '__main__':
    runner = Path(__file__).with_name('browser_e2e.py')
    raise SystemExit(subprocess.call([sys.executable, str(runner)]))
