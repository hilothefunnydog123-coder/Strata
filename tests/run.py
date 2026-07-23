"""Run the whole Strata test suite (standard library only, no network).

    python tests/run.py
"""
import importlib
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

MODULES = ["test_strata", "test_pipeline", "test_monitoring", "test_api", "test_sources"]


def main() -> int:
    failed = 0
    for name in MODULES:
        mod = importlib.import_module(name)
        print(f"\n=== {name} ===")
        for attr, fn in sorted(vars(mod).items()):
            if attr.startswith("test_") and callable(fn):
                try:
                    fn()
                except Exception as exc:  # noqa: BLE001
                    failed += 1
                    print(f"FAIL  {attr}: {type(exc).__name__}: {exc}")
    print("\n" + ("all tests passed" if not failed else f"{failed} test(s) failed"))
    return 1 if failed else 0


if __name__ == "__main__":
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    sys.exit(main())
