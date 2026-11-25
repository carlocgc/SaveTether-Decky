import { test } from "node:test";
import assert from "node:assert/strict";
import {
  cardFor,
  cardsFor,
  formatSize,
  overall,
  sizeLine,
  wordFor,
  type MappingJson,
  type StatusEnvelope,
  type StatusJson,
} from "../src/states.ts";

const mapping = (id: string, state: string, reason?: string, extra: Partial<MappingJson> = {}): MappingJson => ({
  mapping_id: id,
  state,
  ...(reason ? { reason } : {}),
  target: `/sync/savetether/${id}`,
  detail: `${id} is ${state}.`,
  ...extra,
});

const envelope = (status: Partial<StatusJson>, rest: Partial<StatusEnvelope> = {}): StatusEnvelope => ({
  schema: 1,
  command: "status",
  exit_code: 0,
  status: {
    device_name: "steamdeck",
    sync_root: "/sync",
    sync_root_available: true,
    device_file_mismatch: false,
    journal_open: false,
    mappings: [],
    ...status,
  },
  ...rest,
});

test("every state and reason has the desktop app's word and shade", () => {
  const rows: [string, string | undefined, string, string][] = [
    ["ok", undefined, "Linked", "green"],
    ["not-applied", "no-save-folder", "Not on this device", "grey"],
    ["not-applied", "save-folder-not-absolute", "Device file error", "amber"],
    ["not-applied", "not-linked-yet", "Ready to link", "grey"],
    ["replaced", "folder-holds-files", "Not linked", "amber"],
    ["replaced", "folder-empty", "Link missing", "amber"],
    ["replaced", "folder-missing", "Folder gone", "amber"],
    ["replaced", "not-a-folder", "Not a folder", "amber"],
    ["broken", "shared-folder-missing", "Shared folder missing", "amber"],
    ["broken", "sync-root-unavailable", "Shared folder missing", "amber"],
    ["retargeted", undefined, "Linked elsewhere", "amber"],
    ["double-seed", undefined, "Two shared copies", "amber"],
    ["foreign-link", undefined, "Not SaveTether's link", "amber"],
  ];
  for (const [state, reason, word, shade] of rows) {
    assert.deepEqual(wordFor(state, reason), { word, shade }, `${state}/${reason}`);
  }
});

test("a state a newer CLI adds shows amber instead of failing", () => {
  assert.deepEqual(wordFor("something-new"), { word: "Needs attention", shade: "amber" });
});

test("the card takes the app name from app list, or the ID before the dot", () => {
  const card = cardFor(mapping("cemu.save", "ok", undefined, { bytes: 2048, files: 3 }), { cemu: "Cemu" });
  assert.equal(card.appName, "Cemu");
  assert.equal(card.role, "save");
  assert.equal(sizeLine(card), "2.0 KiB · 3 files");
  assert.equal(cardFor(mapping("dolphin.gc", "ok")).appName, "dolphin");
  assert.equal(sizeLine(cardFor(mapping("dolphin.gc", "ok"))), "size unknown");
});

test("cards needing attention come first, then by name", () => {
  const cards = cardsFor(
    envelope({
      mappings: [
        mapping("zelda.save", "ok"),
        mapping("celeste.save", "broken", "shared-folder-missing"),
        mapping("astro.save", "not-applied", "no-save-folder"),
        mapping("stardew.save", "replaced", "folder-holds-files"),
      ],
    }),
  );
  assert.deepEqual(
    cards.map((c) => c.mappingId),
    ["celeste.save", "stardew.save", "astro.save", "zelda.save"],
  );
});

test("the overall state follows the desktop app's order", () => {
  const amber = [mapping("a.save", "broken", "shared-folder-missing")];
  assert.equal(overall(envelope({ journal_open: true, sync_root_available: false, mappings: amber })).headline, "An operation did not finish");
  assert.equal(overall(envelope({ sync_root_available: false, sync_root_problem: "Drive gone.", mappings: amber })).headline, "Sync folder not available");
  assert.equal(overall(envelope({ sync_root_available: false, sync_root_problem: "Drive gone." })).detail, "Drive gone.");
  assert.equal(overall(envelope({ removal: "removed-by-another", mappings: amber })).headline, "Removed from the sync folder");
  assert.equal(overall(envelope({ removal: "unfinished" })).headline, "Removal not finished");
  assert.equal(overall(envelope({ device_file_mismatch: true, mappings: amber })).headline, "Device name used by another install");
  assert.deepEqual(overall(envelope({ mappings: amber })), { headline: "1 app needs attention", shade: "amber" });
  assert.equal(
    overall(envelope({ mappings: [...amber, mapping("a.config", "foreign-link"), mapping("b.save", "retargeted")] })).headline,
    "2 apps need attention",
  );
});

test("green headlines count folders ready to link but not other devices' mappings", () => {
  assert.deepEqual(overall(envelope({ mappings: [mapping("a.save", "ok"), mapping("b.save", "not-applied", "no-save-folder")] })), {
    headline: "All linked",
    shade: "green",
  });
  assert.equal(overall(envelope({ mappings: [mapping("a.save", "ok"), mapping("b.save", "not-applied", "not-linked-yet")] })).headline, "1 linked, 1 ready to link");
  assert.equal(overall(envelope({ mappings: [mapping("b.save", "not-applied", "not-linked-yet")] })).headline, "1 ready to link");
});

test("a refused status shows the CLI's sentence", () => {
  const notSetUp: StatusEnvelope = {
    schema: 1,
    command: "status",
    exit_code: 1,
    problem: "not-found",
    error: "This device is not set up yet. Run 'savetether init --sync-root <path>' first.",
  };
  assert.deepEqual(overall(notSetUp), { headline: "Cannot check this device", shade: "amber", detail: notSetUp.error });
  assert.equal(overall({ ...notSetUp, problem: "schema-too-new" }).headline, "Update SaveTether");
  assert.deepEqual(cardsFor(notSetUp), []);
});

test("sizes use the CLI's units", () => {
  assert.equal(formatSize(0), "0 bytes");
  assert.equal(formatSize(1023), "1023 bytes");
  assert.equal(formatSize(1536), "1.5 KiB");
  assert.equal(formatSize(18.4 * 2 ** 20), "18.4 MiB");
  assert.equal(formatSize(3 * 2 ** 30), "3.0 GiB");
  assert.equal(sizeLine({ mappingId: "a.b", appName: "a", role: "b", word: "", shade: "green", detail: "", bytes: 5, files: 1 }), "5 bytes · 1 file");
});
