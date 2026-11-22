"""Legacy test entrypoint deliberately redirected to isolated fixture.

Prevents old audit scripts from creating synthetic customers in the real local
SQLite business database on port 3001.  Visible Chrome requires launching
from the user\'s interactive Windows desktop session.
"""
from pathlib import Path
import subprocess
import sys

if __name__ == "__main__":
    safe_runner = Path(__file__).with_name("isolated_visible_lifecycle.py")
    print("Running isolated RepairlyLabs browser lifecycle; no live database writes.", flush=True)
    raise SystemExit(subprocess.call([sys.executable, str(safe_runner)]))
