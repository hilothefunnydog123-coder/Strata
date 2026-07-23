"""Frozen entry point for the Strata Desktop executable.

PyInstaller bundles this script; it simply hands off to the real app. Kept tiny and
import-light so the analysis phase starts from a clean root. The strata package is pulled in
as a whole via ``collect_submodules('strata')`` in the .spec (the app imports several
submodules lazily, which static analysis would otherwise miss).
"""
import os
import sys

# When frozen, the package is on the bundle path already; when run from source, add the repo.
if not getattr(sys, "frozen", False):
    sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from strata.desktop import main  # noqa: E402

if __name__ == "__main__":
    raise SystemExit(main())
