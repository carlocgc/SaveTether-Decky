// What the panel shows for `savetether status --json`: a port of the desktop app's StateWords.cs and
// OverallState.cs (SaveTether's src/SaveTether.Gui.Presentation), so both say the same words in the
// same colours. Plain functions, no React, so `node --test` can run them. Unknown values never throw:
// the JSON contract lets a newer CLI add states, and they show amber with the CLI's own sentence.

export type Shade = "green" | "grey" | "amber";

/** One entry of `status.mappings` (docs/cli-json.md). `bytes` and `files` come with `--sizes`. */
export interface MappingJson {
  mapping_id: string;
  state: string;
  reason?: string;
  source?: string;
  target: string;
  detail: string;
  bytes?: number;
  files?: number;
  /** The app's name typed when the mapping was added by hand (CLI 2026-11-26); absent otherwise and from an older CLI. */
  name?: string;
  /** For `file-conflict`: the sync tool's conflict copies, relative to the shared folder (CLI 2026-11-26); absent otherwise. */
  conflicts?: string[];
}

export interface StatusJson {
  device_name: string;
  sync_root: string;
  sync_root_available: boolean;
  sync_root_problem?: string;
  device_file_mismatch: boolean;
  journal_open: boolean;
  mappings: MappingJson[];
  removal?: string;
  /** Another SaveTether process holds the operation lock (CLI 0.7.0-beta2); absent from an older CLI. */
  operation_running?: boolean;
}

/** The `status --json` envelope. */
export interface StatusEnvelope {
  schema: number;
  command: string;
  exit_code: number;
  error?: string;
  problem?: string;
  message?: string;
  status?: StatusJson;
}

export interface Card {
  mappingId: string;
  appName: string;
  role: string;
  word: string;
  shade: Shade;
  detail: string;
  bytes?: number;
  files?: number;
}

export interface Overall {
  headline: string;
  shade: Shade;
  /** A sentence to show under the headline when the state is not about one link. */
  detail?: string;
}

/** Desktop app spec 5.1, as StateWords.For. */
export function wordFor(state: string, reason?: string): { word: string; shade: Shade } {
  switch (state) {
    case "ok":
      return { word: "Linked", shade: "green" };
    case "not-applied":
      if (reason === "no-save-folder") return { word: "Not set up here", shade: "grey" };
      if (reason === "save-folder-not-absolute") return { word: "Device file error", shade: "amber" };
      return { word: "Ready to link", shade: "grey" };
    case "replaced":
      if (reason === "folder-empty") return { word: "Link missing", shade: "amber" };
      if (reason === "folder-missing") return { word: "Folder gone", shade: "amber" };
      if (reason === "not-a-folder") return { word: "Not a folder", shade: "amber" };
      return { word: "Not linked", shade: "amber" };
    case "broken":
      return { word: "Shared folder missing", shade: "amber" };
    case "retargeted":
      return { word: "Linked elsewhere", shade: "amber" };
    case "foreign-link":
      return { word: "Not SaveTether's link", shade: "amber" };
    case "file-conflict":
      return { word: "File conflict", shade: "amber" };
    default:
      return { word: "Needs attention", shade: "amber" };
  }
}

/**
 * The CLI ends a sentence with the command to type (SaveTether's cli-json.md, "Messages"). In Game Mode the
 * desktop app is the way to fix it, so the sentence holding the command and any after it are dropped.
 */
export function withoutCliHint(detail: string): string {
  const at = detail.indexOf("'savetether ");
  if (at < 0) return detail;
  const end = detail.lastIndexOf(". ", at);
  return end < 0 ? "" : detail.slice(0, end + 1);
}

// Object.hasOwn needs ES2022; this targets ES2020.
const has = (o: object, key: string): boolean => Object.prototype.hasOwnProperty.call(o, key);

function appIdOf(mappingId: string): string {
  const dot = mappingId.indexOf(".");
  return dot < 0 ? mappingId : mappingId.slice(0, dot);
}

/**
 * As AppNames.cs: an app's definition name (`names`, from `app list`) first, then the name typed for an app added
 * by hand, from the first of its mappings that has one in ID order, so all its folders show under one name.
 */
export function withTypedNames(mappings: MappingJson[], names: Record<string, string>): Record<string, string> {
  const all = { ...names };
  for (const m of [...mappings].sort((a, b) => (a.mapping_id < b.mapping_id ? -1 : a.mapping_id > b.mapping_id ? 1 : 0))) {
    const appId = appIdOf(m.mapping_id);
    if (m.name && !has(all, appId)) all[appId] = m.name;
  }
  return all;
}

/**
 * The app's ID is the part of the mapping ID before the dot; `names` maps it to the name from `app list`.
 * Own keys only: a plain object also answers `constructor` and `toString`, which are valid app IDs.
 */
export function cardFor(mapping: MappingJson, names: Record<string, string> = {}): Card {
  const dot = mapping.mapping_id.indexOf(".");
  const appId = appIdOf(mapping.mapping_id);
  const { word, shade } = wordFor(mapping.state, mapping.reason);
  return {
    mappingId: mapping.mapping_id,
    appName: (has(names, appId) ? names[appId] : undefined) ?? mapping.name ?? appId,
    role: dot < 0 ? "" : mapping.mapping_id.slice(dot + 1),
    word,
    shade,
    detail: withoutCliHint(mapping.detail),
    bytes: mapping.bytes,
    files: mapping.files,
  };
}

/** As the desktop app: the ones needing attention first, then by app name, then by mapping ID. */
export function sortCards(cards: Card[]): Card[] {
  const attention = (c: Card) => (c.shade === "amber" ? 0 : 1);
  return [...cards].sort(
    (a, b) =>
      attention(a) - attention(b) ||
      a.appName.localeCompare(b.appName, undefined, { sensitivity: "base" }) ||
      (a.mappingId < b.mappingId ? -1 : a.mappingId > b.mappingId ? 1 : 0),
  );
}

export function cardsFor(envelope: StatusEnvelope, names: Record<string, string> = {}): Card[] {
  const mappings = envelope.status?.mappings ?? [];
  const all = withTypedNames(mappings, names);
  return sortCards(mappings.map((m) => cardFor(m, all)));
}

/** The overall state, first match wins, in OverallState.cs's order. */
export function overall(envelope: StatusEnvelope, names: Record<string, string> = {}): Overall {
  const status = envelope.status;
  if (!status) {
    // No "Not set up" row: the CLI reports a missing setup as `not-found`, the same problem as this device's
    // file missing from the sync folder, so the CLI's own sentence says which it is.
    if (envelope.problem === "schema-too-new") {
      return { headline: "Update SaveTether", shade: "amber", detail: withoutCliHint(envelope.error ?? "") };
    }
    return { headline: "Cannot check this device", shade: "amber", detail: withoutCliHint(envelope.error ?? envelope.message ?? "") };
  }

  if (status.journal_open) {
    return { headline: "An operation did not finish", shade: "amber", detail: "Open the desktop app to finish it." };
  }
  if (!status.sync_root_available) {
    return { headline: "Sync folder not available", shade: "amber", detail: status.sync_root_problem };
  }
  if (status.removal === "removed-by-another") {
    return { headline: "Removed from the sync folder", shade: "amber" };
  }
  if (status.removal === "unfinished") {
    return { headline: "Removal not finished", shade: "amber" };
  }
  if (status.device_file_mismatch) {
    return { headline: "Device name used by another install", shade: "amber" };
  }

  const all = withTypedNames(status.mappings, names);
  const cards = status.mappings.map((m) => cardFor(m, all));
  const apps = new Set(cards.filter((c) => c.shade === "amber").map((c) => c.appName)).size;
  if (apps > 0) {
    return { headline: apps === 1 ? "1 app needs attention" : `${apps} apps need attention`, shade: "amber" };
  }

  // "All linked" only when it is so: folders here not linked yet are counted; "Not set up here" is not.
  const ready = status.mappings.filter((m) => m.state === "not-applied" && m.reason !== "no-save-folder").length;
  if (ready === 0) {
    return { headline: "All linked", shade: "green" };
  }
  const linked = status.mappings.filter((m) => m.state === "ok").length;
  return { headline: linked === 0 ? `${ready} ready to link` : `${linked} linked, ${ready} ready to link`, shade: "green" };
}

/** The CLI's units (FormatBytes in SaveTether's Output.cs). */
export function formatSize(bytes: number): string {
  if (bytes >= 2 ** 30) return `${(bytes / 2 ** 30).toFixed(1)} GiB`;
  if (bytes >= 2 ** 20) return `${(bytes / 2 ** 20).toFixed(1)} MiB`;
  if (bytes >= 2 ** 10) return `${(bytes / 2 ** 10).toFixed(1)} KiB`;
  return `${bytes} bytes`;
}

/** The card's second line: "2.1 MiB · 14 files", or "size unknown" without `--sizes` data. */
export function sizeLine(card: Card): string {
  if (card.bytes === undefined || card.files === undefined) return "size unknown";
  return `${formatSize(card.bytes)} · ${card.files} ${card.files === 1 ? "file" : "files"}`;
}

/** What the Python backend returns (main.py): the CLI's JSON, or why there is none. */
export type BackendResult<T> =
  | { ok: true; exit_code: number; json: T }
  | { ok: false; exit_code: number | null; error: string; message: string };

/** The overall state when the backend got no JSON from the CLI. */
export function failureOverall(result: { error: string; message: string }): Overall {
  switch (result.error) {
    case "cli-missing":
      return { headline: "Install SaveTether in Desktop Mode", shade: "amber", detail: `Not found: ${result.message}` };
    case "timeout":
      // A sync folder on a mount that stopped answering is the likely cause (a dead network or overlay mount).
      return { headline: "Sync folder not available", shade: "amber", detail: `${result.message}. The sync folder may not be answering.` };
    default:
      return { headline: "Check failed", shade: "amber", detail: result.message };
  }
}
