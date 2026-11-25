# Tests for main.py with a stub `decky` module and a fake `savetether` shell script (POSIX only).
# Run from the repository root: python3 -m unittest discover -s tests
import asyncio
import json
import logging
import os
import shutil
import stat
import sys
import tempfile
import types
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
decky = types.ModuleType("decky")
decky.logger = logging.getLogger("decky-test")
sys.modules["decky"] = decky
import main  # noqa: E402

# Answers by FAKE_CLI_MODE: echoes its arguments and SAVETETHER_HOME as JSON.
FAKE_CLI = """#!/bin/sh
case "$FAKE_CLI_MODE" in
  sleep) sleep 30 ;;
  old) case "$*" in *--sizes*) echo "unknown option --sizes" >&2; exit 64 ;; esac ;;
  garbage) echo "not json"; exit 1 ;;
esac
printf '{"args":"%s","home":"%s"}\\n' "$*" "${SAVETETHER_HOME:-}"
exit 0
"""


class BackendTests(unittest.TestCase):
    def setUp(self):
        self.home = os.path.realpath(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, self.home)
        decky.DECKY_USER_HOME = self.home
        decky.DECKY_PLUGIN_SETTINGS_DIR = os.path.join(self.home, "settings")
        os.makedirs(decky.DECKY_PLUGIN_SETTINGS_DIR)
        self.cli = os.path.join(self.home, ".local", "bin", "savetether")
        os.makedirs(os.path.dirname(self.cli))
        with open(self.cli, "w") as f:
            f.write(FAKE_CLI)
        os.chmod(self.cli, os.stat(self.cli).st_mode | stat.S_IEXEC)
        os.environ.pop("FAKE_CLI_MODE", None)
        os.environ.pop("SAVETETHER_HOME", None)

    def run_call(self, name):
        return asyncio.run(getattr(main.Plugin(), name)())

    def set_home(self, path):
        with open(os.path.join(decky.DECKY_PLUGIN_SETTINGS_DIR, "settings.json"), "w") as f:
            json.dump({"savetether_home": path}, f)

    def test_status_passes_json_through(self):
        r = self.run_call("status")
        self.assertEqual(r, {"ok": True, "exit_code": 0, "json": {"args": "status --json --sizes", "home": ""}})

    def test_apps(self):
        r = self.run_call("apps")
        self.assertEqual(r["json"]["args"], "app list --json")

    def test_exit_64_retries_without_sizes(self):
        os.environ["FAKE_CLI_MODE"] = "old"
        r = self.run_call("status")
        self.assertEqual((r["exit_code"], r["json"]["args"]), (0, "status --json"))

    def test_timeout(self):
        os.environ["FAKE_CLI_MODE"] = "sleep"
        old, main.TIMEOUT = main.TIMEOUT, 0.5
        self.addCleanup(setattr, main, "TIMEOUT", old)
        with self.assertNoLogs("decky-test", logging.WARNING):  # the killed CLI really exited
            r = self.run_call("status")
        self.assertEqual((r["ok"], r["error"]), (False, "timeout"))

    def test_cli_missing(self):
        os.remove(self.cli)
        r = self.run_call("status")
        self.assertEqual((r["ok"], r["error"], r["message"]), (False, "cli-missing", self.cli))

    def test_output_that_is_not_json(self):
        os.environ["FAKE_CLI_MODE"] = "garbage"
        r = self.run_call("status")
        self.assertEqual((r["ok"], r["exit_code"], r["error"], r["message"]), (False, 1, "bad-output", "not json"))

    def test_home_override_under_sttest_is_used(self):
        target = os.path.join(self.home, "sttest", "decky", "home")
        self.set_home(target)
        r = self.run_call("status")
        self.assertEqual(r["json"]["home"], target)

    def test_home_override_outside_sttest_is_refused(self):
        for path in [os.path.join(self.home, ".local", "share", "savetether"),
                     os.path.join(self.home, "sttest-other", "home"),  # a prefix, not a child
                     os.path.join(self.home, "sttest", "..", "real"),
                     1]:  # not a path at all
            with self.subTest(path=path):
                self.set_home(path)
                r = self.run_call("status")
                self.assertEqual((r["ok"], r["error"]), (False, "home-refused"))


if __name__ == "__main__":
    unittest.main()
