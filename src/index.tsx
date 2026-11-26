import { ButtonItem, Focusable, PanelSection, PanelSectionRow, ToggleField, staticClasses } from "@decky/ui";
import { callable, definePlugin, toaster } from "@decky/api";
import { useEffect, useState, type CSSProperties } from "react";
import { FaLink, FaSyncAlt } from "react-icons/fa";
import { createMonitor, gate } from "./monitor";
import { cardsFor, failureOverall, overall, sizeLine, type BackendResult, type Card, type Overall, type Shade, type StatusEnvelope } from "./states";

const status = callable<[sizes: boolean], BackendResult<StatusEnvelope>>("status");
const apps = callable<[], BackendResult<{ apps?: { id: string; name?: string }[] }>>("apps");
const notifications = callable<[on?: boolean], BackendResult<{ notifications?: { on?: boolean } }>>("notifications");
const syncConflicts = callable<[on?: boolean], BackendResult<{ sync_conflicts?: { on?: boolean } }>>("sync_conflicts");

/** Background checks, without sizes: sizes walk every shared folder. */
const CHECK_EVERY_MS = 5 * 60_000;
// At boot Decky loads plugins before Steam can show a toast: one at load was lost on the Deck (phase 4.1 T9).
const FIRST_CHECK_AFTER_MS = 60_000;

// The mockup's colours (docs/design/decky-mockup.html in SaveTether).
const BAR: Record<Shade, string> = { green: "#59bf40", grey: "#67707b", amber: "#e8a23a" };
const WORD: Record<Shade, string> = { green: "#59bf40", grey: "#8b929a", amber: "#e8a23a" };
const MUTED = "#8b929a";

const dot = (shade: Shade): CSSProperties => ({ width: 8, height: 8, borderRadius: "50%", flex: "none", background: BAR[shade] });
const box: CSSProperties = { background: "#23262e", borderRadius: 4, padding: "8px 10px", fontSize: 12, lineHeight: 1.5 };
const row1: CSSProperties = { display: "flex", alignItems: "center", gap: 7, fontSize: 13, color: "#fff" };

interface View {
  overall: Overall;
  cards: Card[];
  device?: string;
  syncRoot?: string;
  checkedAt: string;
  /** The device's notifications switch, inverted; undefined when the CLI has no `notifications` command. */
  muted?: boolean;
  /** The device's "Detect sync conflicts" switch; undefined when the CLI has no `sync-conflicts` command. */
  conflictCheck?: boolean;
}

/** The notifications switch, inverted (true: muted), from a `notifications` result; undefined for an older CLI (exit 64) or a failure. */
function mutedFrom(n: Awaited<ReturnType<typeof notifications>>): boolean | undefined {
  return n.ok && typeof n.json.notifications?.on === "boolean" ? !n.json.notifications.on : undefined;
}

/** The "Detect sync conflicts" switch, from a `sync-conflicts` result; undefined for an older CLI (exit 64) or a failure. */
function conflictCheckFrom(c: Awaited<ReturnType<typeof syncConflicts>>): boolean | undefined {
  return c.ok && typeof c.json.sync_conflicts?.on === "boolean" ? c.json.sync_conflicts.on : undefined;
}

// One monitor for the panel's checks and the background ones, as the desktop app counts both.
const monitor = createMonitor();

/** Steam's "Show Notification Toasts" set to Never. An undocumented internal, read only for the log line. */
function steamToastsOff(): boolean {
  try {
    return (window as any).settingsStore?.m_ClientSettings?.disable_all_toasts === true;
  } catch {
    return false;
  }
}

// Never `critical: true`, which would pass Steam's toast setting. The harness reads these log lines.
function notify(body: string, muted: boolean) {
  const g = gate(muted, steamToastsOff());
  if (g === "muted") return console.log(`[SaveTether] toast muted: ${body}`);
  toaster.toast({ title: "SaveTether", body });
  console.log(g === "hidden" ? `[SaveTether] toast hidden by Steam: ${body}` : `[SaveTether] toast: ${body}`);
}

async function check(sizes: boolean): Promise<View> {
  const [s, a, n, c] = await Promise.all([status(sizes), apps(), notifications(), syncConflicts()]);
  const names: Record<string, string> = {};
  // Names are a nicety: without them a card shows the app's ID.
  if (a.ok) for (const app of a.json.apps ?? []) if (app.name) names[app.id] = app.name;
  const muted = mutedFrom(n);
  const conflictCheck = conflictCheckFrom(c);
  const body = monitor.accept(s, names);
  if (body) notify(body, muted === true); // an older CLI has no switch: on, as the desktop's default
  const checkedAt = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });
  if (!s.ok) return { overall: failureOverall(s), cards: [], checkedAt, muted, conflictCheck };
  return {
    overall: overall(s.json, names),
    cards: cardsFor(s.json, names),
    device: s.json.status?.device_name,
    syncRoot: s.json.status?.sync_root,
    checkedAt,
    muted,
    conflictCheck,
  };
}

// One check at a time: a panel check waits for a running one; a background tick skips while one runs.
let queue: Promise<unknown> = Promise.resolve();
let pending = 0;

function checkInTurn(sizes: boolean): Promise<View> {
  pending++;
  const next = queue.then(() => check(sizes)).finally(() => pending--);
  queue = next.catch(() => {});
  return next;
}

function backgroundCheck() {
  if (pending === 0) checkInTurn(false).catch((e) => console.error("[SaveTether] background check failed:", e));
}

function OverviewBlock({ view, checking }: { view?: View; checking: boolean }) {
  const o = view?.overall ?? { headline: "Checking…", shade: "grey" as Shade };
  return (
    // Focusable so that moving up stops here and scrolls it into view before the back button.
    <Focusable onActivate={() => {}} focusClassName="st-focus" style={box}>
      <div style={row1} data-st-overall={o.shade}>
        <span style={dot(o.shade)} />
        {o.headline}
      </div>
      {o.detail && <div style={{ color: o.shade === "amber" ? BAR.amber : MUTED }}>{o.detail}</div>}
      {view?.syncRoot && (
        <>
          <div style={{ color: MUTED }}>Sync folder</div>
          <div style={{ wordBreak: "break-all" }}>{view.syncRoot}</div>
        </>
      )}
      {view && !checking && (
        <div style={{ color: MUTED }}>{[view.device, `checked ${view.checkedAt}`].filter(Boolean).join(" · ")}</div>
      )}
    </Focusable>
  );
}

function LinkCard({ card }: { card: Card }) {
  return (
    // onActivate makes the card a focus target, so the controller can scroll through the list.
    <Focusable
      onActivate={() => {}}
      focusClassName="st-focus"
      data-st-card={card.mappingId}
      data-st-state={card.word}
      data-st-name={card.appName}
      style={{ ...box, marginTop: 6, borderLeft: `3px solid ${BAR[card.shade]}` }}
    >
      <div style={row1}>
        <span style={dot(card.shade)} />
        <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>
          {card.appName}
          {/* An app can share several folders: the role tells its cards apart. */}
          {card.role && <span style={{ color: MUTED }}> ({card.role})</span>}
        </span>
        <span style={{ marginLeft: "auto", fontSize: 11, color: WORD[card.shade], textAlign: "right" }}>{card.word}</span>
      </div>
      <div style={{ fontSize: 11, color: MUTED, marginLeft: 15 }}>{sizeLine(card)}</div>
      {card.shade === "amber" && (
        <div style={{ fontSize: 11, color: BAR.amber, marginLeft: 15, lineHeight: 1.4 }}>
          {card.detail && `${card.detail} `}Open the desktop app to fix.
        </div>
      )}
    </Focusable>
  );
}

function Content() {
  const [view, setView] = useState<View>();
  const [checking, setChecking] = useState(false);

  const run = async () => {
    setChecking(true);
    try {
      setView(await checkInTurn(true));
    } catch (e) {
      setView({ overall: { headline: "Check failed", shade: "amber", detail: String(e) }, cards: [], checkedAt: "" });
    } finally {
      setChecking(false);
    }
  };

  const setMute = async (muted: boolean) => {
    if (!view) return;
    setView({ ...view, muted });
    const n = await notifications(!muted).catch(() => undefined);
    // Shows what the switch says now: on a failed write, the old value comes back.
    const now = n ? mutedFrom(n) : undefined;
    setView((v) => v && { ...v, muted: now ?? !muted });
  };

  const setConflictCheck = async (on: boolean) => {
    if (!view) return;
    setView({ ...view, conflictCheck: on });
    const c = await syncConflicts(on).catch(() => undefined);
    // As Mute: on a failed write the old value comes back. On a saved change, check at once so the cards show it.
    const now = c ? conflictCheckFrom(c) : undefined;
    setView((v) => v && { ...v, conflictCheck: now ?? !on });
    if (now === on) await run();
  };

  // Checks when the panel opens and on Check now; the background checks run from definePlugin.
  useEffect(() => {
    void run();
  }, []);

  return (
    <>
      {/* Cards do nothing when pressed, but the controller still moves over them: show where it is. */}
      <style>{`.st-focus { background: #3d4450 !important; box-shadow: 0 0 0 2px #fff; }`}</style>
      <PanelSection>
        <PanelSectionRow>
          <OverviewBlock view={view} checking={checking} />
        </PanelSectionRow>
        <PanelSectionRow>
          <ButtonItem layout="below" disabled={checking} onClick={() => void run()}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              {checking ? "Checking…" : "Check now"}
              <FaSyncAlt />
            </div>
          </ButtonItem>
        </PanelSectionRow>
        {view?.muted !== undefined && (
          <PanelSectionRow>
            {/* On means notify, as the desktop app's switch; `muted` stays the inverse for the gate and the harness. */}
            <div data-st-muted={String(view.muted)}>
              <ToggleField
                label="Notifications"
                description="A toast when a link needs attention."
                checked={!view.muted}
                onChange={(on) => void setMute(!on)}
              />
            </div>
          </PanelSectionRow>
        )}
        {view?.conflictCheck !== undefined && (
          <PanelSectionRow>
            <div data-st-conflicts={String(view.conflictCheck)}>
              <ToggleField
                label="Detect sync conflicts"
                description="Warn when the sync tool leaves conflict copies of a save."
                checked={view.conflictCheck}
                onChange={(on) => void setConflictCheck(on)}
              />
            </div>
          </PanelSectionRow>
        )}
      </PanelSection>
      {view && view.cards.length > 0 && (
        <PanelSection title="Links">
          {view.cards.map((c) => (
            <LinkCard key={c.mappingId} card={c} />
          ))}
        </PanelSection>
      )}
    </>
  );
}

export default definePlugin(() => {
  // Kept on window, not in the module: a hot reload loads a new module and may skip onDismount.
  const w = window as { saveTetherTimer?: ReturnType<typeof setInterval>; saveTetherFirst?: ReturnType<typeof setTimeout> };
  clearInterval(w.saveTetherTimer);
  clearTimeout(w.saveTetherFirst);
  w.saveTetherTimer = setInterval(backgroundCheck, CHECK_EVERY_MS);
  // Soon after load: an amber setup toasts once after boot, as the desktop app at login.
  w.saveTetherFirst = setTimeout(backgroundCheck, FIRST_CHECK_AFTER_MS);
  return {
    name: "SaveTether",
    titleView: <div className={staticClasses.Title}>SaveTether</div>,
    content: <Content />,
    icon: <FaLink />,
    onDismount() {
      clearInterval(w.saveTetherTimer);
      clearTimeout(w.saveTetherFirst);
      w.saveTetherTimer = w.saveTetherFirst = undefined;
    },
  };
});
