"""Havak API package.

Loading .env happens *here*, and this is the only place it can safely happen.

`storage.py` and `security.py` read configuration into module-level constants at
import time, so anything that populates the environment has to run before the
first `server.*` submodule is imported. A package __init__ is the one file
guaranteed to do that, whatever the import order downstream. Putting the call in
`db.py` appears to work only because `main.py` happens to list `db` before
`storage`; reorder that line and the settings silently fall back to defaults.

A missing .env is not an error. In production the environment is supplied by
systemd or the platform, and `load_dotenv()` is then a no-op.
"""

from dotenv import load_dotenv

load_dotenv()
