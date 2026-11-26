#!/usr/bin/env node
// Game Mode harness (phase 4 T8): opens the SaveTether panel in the Deck's Quick Access menu through
// the CEF debugger, presses Check now, reads what the panel shows and compares it with what is expected.
// Node 22+ only (built-in fetch and WebSocket), no dependency.
//
// Needs Decky's "Allow Remote CEF Debugging" on and a tunnel: ssh -L 8081:localhost:8081 <deck>.
//
//   node scripts/qam-check.mjs --expect scripts/expected/a.json [--shot a.png] [--port 8081]
//   node scripts/qam-check.mjs --status status.json [--shot f.png]   (the real setup: `savetether status --json`)
//   node scripts/qam-check.mjs --expect scripts/expected/j-mute.json --mute on   (sets Mute before Check now)
//   node scripts/qam-check.mjs --expect <file> --conflicts on   (sets "Detect sync conflicts" before Check now)
//   node scripts/qam-check.mjs --expect scripts/expected/k.json --listen 400     (QAM closed: waits for a background toast)
//
// Toasts (phase 4.1 T8): the plugin logs "[SaveTether] toast…" lines in SharedJSContext; those logged from the
// start of the run are `toasts`. An expected file is compared on its own keys only (overall, cards, muted, conflicts, toasts).
//
// Exit 0: the panel matches. 1: it does not (both printed). 2: the harness could not run.
import { readFileSync, writeFileSync } from "node:fs";
import { isDeepStrictEqual, parseArgs } from "node:util";

const { values: args } = parseArgs({
  options: {
    expect: { type: "string" },
    status: { type: "string" },
    shot: { type: "string" },
    port: { type: "string", default: "8081" },
    mute: { type: "string" },
    conflicts: { type: "string" },
    listen: { type: "string" },
  },
});

const CHECK_LIMIT_MS = 25_000; // the backend gives up on the CLI after 20 s; the panel must answer by then
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const sockets = [];
function fail(message) {
  throw new Error(message);
}

async function targets() {
  const res = await fetch(`http://localhost:${args.port}/json`).catch((e) => fail(`no CEF debugger on port ${args.port}: ${e.message}`));
  return res.json();
}

/** A Chrome DevTools Protocol session on one target. */
async function connect(target) {
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  sockets.push(ws);
  await new Promise((ok, ko) => {
    ws.onopen = ok;
    ws.onerror = () => ko(new Error(`cannot connect to ${target.title}`));
  });
  let id = 0;
  const waiting = new Map();
  const handlers = new Map();
  ws.onmessage = (event) => {
    const msg = JSON.parse(event.data);
    if (msg.method) return handlers.get(msg.method)?.(msg.params);
    const w = waiting.get(msg.id);
    if (!w) return;
    waiting.delete(msg.id);
    msg.error ? w.ko(new Error(msg.error.message)) : w.ok(msg.result);
  };
  // A dropped tunnel or a closed page would otherwise leave every pending call waiting forever.
  ws.onclose = () => waiting.forEach((w) => w.ko(new Error(`the debugger connection to ${target.title} closed`)));
  const send = (method, params = {}) =>
    new Promise((ok, ko) => {
      waiting.set(++id, { ok, ko });
      ws.send(JSON.stringify({ id, method, params }));
    });
  /** Evaluates an expression in the page and returns its value (JSON-serialisable). */
  const evaluate = async (expression) => {
    const r = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
    return r.result.value;
  };
  /** Calls `fn` with the params of each event `method` (one handler per method). */
  const on = (method, fn) => handlers.set(method, fn);
  return { send, evaluate, on };
}

async function until(what, probe, limitMs) {
  const start = Date.now();
  for (;;) {
    const value = await probe();
    if (value) return value;
    if (Date.now() - start > limitMs) fail(`timed out waiting for ${what}`);
    await sleep(50);
  }
}

async function main() {
if (!args.expect === !args.status) fail("give exactly one of --expect <file> or --status <file>");
if (args.listen && !args.expect) fail("--listen needs --expect");
if (args.mute && !/^(on|off)$/.test(args.mute)) fail("--mute takes on or off");
if (args.listen && !(Number(args.listen) > 0)) fail("--listen takes seconds");

// 1. The shared context, where Steam's and Decky's globals live, and where the plugin logs its toasts.
const shared = (await targets()).find((t) => t.title === "SharedJSContext");
if (!shared) fail("no SharedJSContext target: is the Deck in Game Mode?");
const js = await connect(shared);
// Runtime.enable replays the console's earlier messages: keep only those logged from now on (the page's clock).
const toasts = [];
const since = await js.evaluate("Date.now()");
js.on("Runtime.consoleAPICalled", ({ args: a, timestamp }) => {
  const line = a?.[0]?.value;
  if (timestamp >= since && typeof line === "string" && line.startsWith("[SaveTether] toast")) toasts.push(line);
});
await js.send("Runtime.enable");

let shown, checkMs;
if (args.listen) {
  // The background check, with the menu closed: wait for its toast (one check toasts at most once).
  await js.evaluate(`DFL.Navigation.CloseSideMenus?.(); true`).catch(() => {});
  console.error(`listening up to ${args.listen} s for a background toast`);
  await until("a toast", () => toasts.length > 0, Number(args.listen) * 1000).catch(() => {});
  shown = { toasts };
} else {
  ({ shown, checkMs } = await panel(js));
  await sleep(500); // the console events can trail the check's end
  shown.toasts = toasts;
}
await js.send("Runtime.disable").catch(() => {});

// 6. Compare.
let expected, actual;
if (args.expect) {
  expected = JSON.parse(readFileSync(args.expect, "utf8"));
  actual = Object.fromEntries(Object.keys(expected).map((k) => [k, shown[k]]));
} else {
  // The real setup: every mapping has a card, and a card says Linked exactly when the CLI says ok.
  const envelope = JSON.parse(readFileSync(args.status, "utf8"));
  const byId = (a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  expected = { cards: (envelope.status?.mappings ?? []).map((m) => ({ id: m.mapping_id, linked: m.state === "ok" })).sort(byId) };
  actual = { cards: shown.cards.map((c) => ({ id: c.id, linked: c.state === "Linked" })).sort(byId) };
}
const ok = isDeepStrictEqual(expected, actual);
console.log(JSON.stringify({ match: ok, check_ms: checkMs, shown }, null, 2));
if (!ok) console.log(`expected:\n${JSON.stringify(expected, null, 2)}`);
return ok ? 0 : 1;
}

/** Opens the panel, sets Mute if asked, presses Check now and returns what the panel shows. */
async function panel(js) {
// Open the Decky tab of the QAM on our plugin.
await js.evaluate(`DFL.Navigation.OpenQuickAccessMenu(999); DeckyPluginLoader.deckyState.setActivePlugin("SaveTether"); true`);

// 2. The Quick Access menu's own page, where the panel renders.
const qamTarget = await until("the QuickAccess target", async () => (await targets()).find((t) => t.title.startsWith("QuickAccess")), 10_000);
const qam = await connect(qamTarget);
await until("the SaveTether panel", () => qam.evaluate(`!!document.querySelector("[data-st-overall]")`), 15_000);

// 3. Check now. The button is found by its words; the click bubbles to Steam's button handler. The panel
// checks once when it opens, so wait for that check to end first.
const findButton = `[...document.querySelectorAll("div, button")].filter((e) => /^(Check now|Checking…)$/.test(e.textContent.trim())).pop()`;
await until("the panel's first check to finish", () => qam.evaluate(`${findButton}?.textContent.trim() === "Check now"`), CHECK_LIMIT_MS);

// Mute: clicks Steam's toggle inside the row the plugin marks, then waits for the row to show the click. The
// panel shows it before the CLI has written it, so a run's `muted` is checked on the next run's opening check.
if (args.mute) {
  const want = String(args.mute === "on");
  const clicked = await qam.evaluate(`(() => {
    const row = document.querySelector("[data-st-muted]");
    if (!row) return "no Mute notifications toggle on the panel (an older CLI?)";
    if (row.dataset.stMuted === ${JSON.stringify(want)}) return "";
    const t = row.querySelector('[class*="Toggle"]') ?? row.querySelector('[role="checkbox"], [tabindex]') ?? row;
    t.click();
    return "";
  })()`);
  if (clicked) fail(clicked);
  await until(`Mute to read ${args.mute}`, () => qam.evaluate(`document.querySelector("[data-st-muted]")?.dataset.stMuted === ${JSON.stringify(want)}`), CHECK_LIMIT_MS);
}

// "Detect sync conflicts", the same way as Mute. A saved change runs a check of its own: wait for it to end too.
if (args.conflicts) {
  const want = String(args.conflicts === "on");
  const clicked = await qam.evaluate(`(() => {
    const row = document.querySelector("[data-st-conflicts]");
    if (!row) return "no Detect sync conflicts toggle on the panel (an older CLI?)";
    if (row.dataset.stConflicts === ${JSON.stringify(want)}) return "";
    const t = row.querySelector('[class*="Toggle"]') ?? row.querySelector('[role="checkbox"], [tabindex]') ?? row;
    t.click();
    return "";
  })()`);
  if (clicked) fail(clicked);
  await until(`Detect sync conflicts to read ${args.conflicts}`, () => qam.evaluate(`document.querySelector("[data-st-conflicts]")?.dataset.stConflicts === ${JSON.stringify(want)}`), CHECK_LIMIT_MS);
  await until("the check after the switch to finish", () => qam.evaluate(`${findButton}?.textContent.trim() === "Check now"`), CHECK_LIMIT_MS);
}

const pressedAt = Date.now();
// An observer records "Checking…" however briefly it shows (a missing CLI answers at once): proof that
// the press started a check.
const pressed = await qam.evaluate(`(() => {
  const b = ${findButton};
  if (!b || b.textContent.trim() !== "Check now") return false;
  window.__stSawChecking = false;
  window.__stObserver?.disconnect();
  window.__stObserver = new MutationObserver((_, o) => {
    if (document.body.textContent.includes("Checking…")) { window.__stSawChecking = true; o.disconnect(); }
  });
  window.__stObserver.observe(document.body, { subtree: true, childList: true, characterData: true });
  b.click();
  return true;
})()`);
if (!pressed) fail("Check now is not on the panel, or a check is already running");
// Disconnected whether or not it saw the check, so no observer is left running in Steam's UI.
await until("the press to start a check", () => qam.evaluate(`window.__stSawChecking`), 3_000).finally(() =>
  qam.evaluate(`window.__stObserver?.disconnect(); true`).catch(() => {}),
);
await until("the check to finish", () => qam.evaluate(`${findButton}?.textContent.trim() === "Check now"`), CHECK_LIMIT_MS);
const checkMs = Date.now() - pressedAt;

// 4. What the panel shows. `muted` and `conflicts` are null when their toggle is hidden.
const shown = await qam.evaluate(`(() => {
  const o = document.querySelector("[data-st-overall]");
  const m = document.querySelector("[data-st-muted]");
  const c = document.querySelector("[data-st-conflicts]");
  return {
    overall: { shade: o.dataset.stOverall, headline: o.textContent.trim() },
    cards: [...document.querySelectorAll("[data-st-card]")].map((c) => ({ id: c.dataset.stCard, state: c.dataset.stState, name: c.dataset.stName })),
    muted: m ? m.dataset.stMuted === "true" : null,
    conflicts: c ? c.dataset.stConflicts === "true" : null,
  };
})()`);

// 5. The screenshot, then close the menu.
if (args.shot) {
  const { data } = await qam.send("Page.captureScreenshot", { format: "png" });
  writeFileSync(args.shot, Buffer.from(data, "base64"));
}
await js.evaluate(`DFL.Navigation.CloseSideMenus?.(); true`).catch(() => {});
return { shown, checkMs };
}

// Sockets are closed and the exit code set rather than process.exit(), which with a socket still open
// trips a libuv assertion on Windows.
main()
  .then((code) => (process.exitCode = code))
  .catch((e) => {
    console.error(`qam-check: ${e.message}`);
    process.exitCode = 2;
  })
  .finally(() => sockets.forEach((ws) => ws.close()));
