import { test } from "node:test";
import assert from "node:assert/strict";
import { createMonitor } from "../src/monitor.ts";
import type { BackendResult, MappingJson, StatusEnvelope, StatusJson } from "../src/states.ts";

// Shapes as SaveTether's tests/SaveTether.Tests/Cli/json-shapes.txt gives them for `status --json`.
const mapping = (id: string, state: string, reason?: string): MappingJson => ({
  mapping_id: id,
  state,
  ...(reason ? { reason } : {}),
  target: `/sync/savetether/${id}`,
  detail: `${id} is ${state}.`,
});

const ok = (mappings: MappingJson[], status: Partial<StatusJson> = {}): BackendResult<StatusEnvelope> => ({
  ok: true,
  exit_code: 0,
  json: {
    schema: 1,
    command: "status",
    exit_code: 0,
    status: {
      device_name: "steamdeck",
      sync_root: "/sync",
      sync_root_available: true,
      device_file_mismatch: false,
      journal_open: false,
      operation_running: false,
      mappings,
      ...status,
    },
  },
});

const failed: BackendResult<StatusEnvelope> = { ok: false, exit_code: null, error: "timeout", message: "Timed out" };

const names = { ryujinx: "Ryujinx", eden: "Eden", cemu: "Cemu" };
const linked = mapping("cemu.save", "ok");
const ryujinxNotLinked = mapping("ryujinx.saves", "replaced", "folder-holds-files");
const edenBroken = mapping("eden.save", "broken", "shared-folder-missing");

test("all linked toasts nothing", () => {
  assert.equal(createMonitor().accept(ok([linked]), names), null);
});

test("a problem is toasted once, in the desktop app's words", () => {
  // As HealthMonitorTests.A_problem_is_notified_once_not_at_every_check.
  const monitor = createMonitor();
  assert.equal(monitor.accept(ok([linked]), names), null);
  assert.equal(monitor.accept(ok([linked, ryujinxNotLinked]), names), "Ryujinx saves: not linked.");
  assert.equal(monitor.accept(ok([linked, ryujinxNotLinked]), names), null);

  // A second problem: only the new one is named.
  assert.equal(monitor.accept(ok([ryujinxNotLinked, edenBroken]), names), "Eden save: shared folder missing.");

  // Fixed, then broken again: new again.
  assert.equal(monitor.accept(ok([linked]), names), null);
  assert.equal(monitor.accept(ok([ryujinxNotLinked]), names), "Ryujinx saves: not linked.");

  // The same link in another amber state is a new problem.
  assert.equal(monitor.accept(ok([mapping("ryujinx.saves", "replaced", "folder-empty")]), names), "Ryujinx saves: link missing.");
});

test("an amber state at start is toasted, and two new problems share one toast", () => {
  assert.equal(createMonitor().accept(ok([edenBroken, ryujinxNotLinked]), names),
    "Eden save: shared folder missing. Ryujinx saves: not linked.");
});

test("a device-wide condition is one problem", () => {
  const monitor = createMonitor();
  const unplugged = ok([mapping("eden.save", "broken", "sync-root-unavailable")], { sync_root_available: false });
  assert.equal(monitor.accept(unplugged, names), "Sync folder not available.");
  assert.equal(monitor.accept(unplugged, names), null);
});

test("while another process holds the lock nothing changes, and the next free check still toasts", () => {
  const monitor = createMonitor();
  assert.equal(monitor.accept(ok([ryujinxNotLinked], { operation_running: true }), names), null);
  assert.equal(monitor.accept(ok([ryujinxNotLinked]), names), "Ryujinx saves: not linked.");
  // A held lock does not clear what was toasted either.
  assert.equal(monitor.accept(ok([linked], { operation_running: true }), names), null);
  assert.equal(monitor.accept(ok([ryujinxNotLinked]), names), null);
});

test("an older CLI without operation_running counts as free", () => {
  const result = ok([ryujinxNotLinked]);
  if (result.ok) delete result.json.status!.operation_running;
  assert.equal(createMonitor().accept(result, names), "Ryujinx saves: not linked.");
});

test("three failed checks in a row toast once; fewer keep the last state", () => {
  const monitor = createMonitor();
  assert.equal(monitor.accept(failed), null);
  assert.equal(monitor.accept(failed), null);
  assert.equal(monitor.accept(failed), "Health check failed.");
  assert.equal(monitor.accept(failed), null);
  // Working again and amber: toasted, since the failure replaced it.
  assert.equal(monitor.accept(ok([ryujinxNotLinked]), names), "Ryujinx saves: not linked.");
});

test("a success resets the failure count, and failures keep what was toasted", () => {
  const monitor = createMonitor();
  assert.equal(monitor.accept(ok([ryujinxNotLinked]), names), "Ryujinx saves: not linked.");
  assert.equal(monitor.accept(failed), null);
  assert.equal(monitor.accept(failed), null);
  assert.equal(monitor.accept(ok([ryujinxNotLinked]), names), null);
  assert.equal(monitor.accept(failed), null);
  assert.equal(monitor.accept(failed), null);
});

test("a state a newer CLI adds is amber and toasted with its word", () => {
  assert.equal(createMonitor().accept(ok([mapping("eden.save", "something-new")]), names), "Eden save: needs attention.");
});

test("a CLI error with no status is one device-wide problem", () => {
  const result: BackendResult<StatusEnvelope> = {
    ok: true, exit_code: 3, json: { schema: 1, command: "status", exit_code: 3, problem: "not-found", error: "No setup." },
  };
  assert.equal(createMonitor().accept(result), "Cannot check this device.");
});
