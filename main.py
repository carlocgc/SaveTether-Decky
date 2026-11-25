# SaveTether's Decky backend. It only runs the installed `savetether` CLI with --json and passes the
# result through untouched (design 5.11): every check and rule stays in SaveTether itself.
import asyncio
import json
import os
import signal

import decky

TIMEOUT = 20  # seconds; a hung sync folder (a dead network mount) must not freeze the panel
EXIT_USAGE = 64  # the CLI did not understand the command line (docs/cli-json.md)


def _cli_path():
    return os.path.join(decky.DECKY_USER_HOME, ".local", "bin", "savetether")


def _env():
    """The CLI's environment, or an error result when the test-only home override is refused."""
    env = dict(os.environ)
    settings = os.path.join(decky.DECKY_PLUGIN_SETTINGS_DIR, "settings.json")
    try:
        with open(settings, encoding="utf-8") as f:
            home = json.load(f).get("savetether_home")
    except (OSError, ValueError, AttributeError):
        home = None
    if not home:
        return env, None
    # Only a throwaway home under ~/sttest, as in docs/testing/hardware-testing.md, so a stray
    # setting can never point the plugin at another real setup.
    scratch = os.path.realpath(os.path.join(decky.DECKY_USER_HOME, "sttest")) + os.sep
    resolved = os.path.realpath(home) if isinstance(home, str) else ""  # not a path: refused below
    if not resolved.startswith(scratch):
        decky.logger.warning("savetether_home %r is not under %s; refused", home, scratch)
        return None, {"ok": False, "exit_code": None, "error": "home-refused",
                      "message": f"The test setting savetether_home must be under {scratch}"}
    env["SAVETETHER_HOME"] = resolved
    return env, None


async def _run(*args):
    """Runs the CLI and returns {ok, exit_code, json} or {ok: False, exit_code, error, message}."""
    env, refused = _env()
    if refused:
        return refused
    cli = _cli_path()
    try:
        proc = await asyncio.create_subprocess_exec(
            cli, *args, env=env, stdin=asyncio.subprocess.DEVNULL,
            stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE, start_new_session=True)
    except (FileNotFoundError, PermissionError):
        return {"ok": False, "exit_code": None, "error": "cli-missing", "message": cli}
    try:
        out, err = await asyncio.wait_for(proc.communicate(), TIMEOUT)
    except asyncio.TimeoutError:
        try:
            os.killpg(proc.pid, signal.SIGKILL)  # the group: a child left alive would hold the pipes open
        except ProcessLookupError:
            pass
        try:
            # A process stuck on a dead mount may not die at once; do not wait on it for long.
            await asyncio.wait_for(proc.wait(), 1)
        except asyncio.TimeoutError:
            decky.logger.warning("savetether %s did not exit after kill", " ".join(args))
        return {"ok": False, "exit_code": None, "error": "timeout",
                "message": f"savetether did not answer within {TIMEOUT} s"}
    try:
        # The CLI prints JSON on failures too (problem and message), so it passes through whatever the exit code.
        return {"ok": True, "exit_code": proc.returncode, "json": json.loads(out)}
    except ValueError:
        text = (err or out).decode("utf-8", "replace").strip()
        return {"ok": False, "exit_code": proc.returncode, "error": "bad-output", "message": text}


class Plugin:
    async def status(self, sizes: bool = True):
        if sizes:
            result = await _run("status", "--json", "--sizes")
            if result.get("exit_code") != EXIT_USAGE:
                return result
        return await _run("status", "--json")  # also the retry for an older CLI without --sizes

    async def apps(self):
        return await _run("app", "list", "--json")

    async def notifications(self, on: bool | None = None):
        """Reads the device's notifications switch, or sets it. A CLI without the command exits 64."""
        value = [] if on is None else ["on" if on else "off"]
        return await _run("notifications", *value, "--json")

    async def _main(self):
        decky.logger.info("SaveTether plugin loaded")

    async def _unload(self):
        decky.logger.info("SaveTether plugin unloaded")
