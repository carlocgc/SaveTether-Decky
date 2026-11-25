import { ButtonItem, Focusable, PanelSection, PanelSectionRow, staticClasses } from "@decky/ui";
import { callable, definePlugin } from "@decky/api";
import { useEffect, useState, type CSSProperties } from "react";
import { FaLink, FaSyncAlt } from "react-icons/fa";
import { cardsFor, failureOverall, overall, sizeLine, type BackendResult, type Card, type Overall, type Shade, type StatusEnvelope } from "./states";

const status = callable<[], BackendResult<StatusEnvelope>>("status");
const apps = callable<[], BackendResult<{ apps?: { id: string; name?: string }[] }>>("apps");

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
}

async function check(): Promise<View> {
  const [s, a] = await Promise.all([status(), apps()]);
  const names: Record<string, string> = {};
  // Names are a nicety: without them a card shows the app's ID.
  if (a.ok) for (const app of a.json.apps ?? []) if (app.name) names[app.id] = app.name;
  const checkedAt = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });
  if (!s.ok) return { overall: failureOverall(s), cards: [], checkedAt };
  return {
    overall: overall(s.json, names),
    cards: cardsFor(s.json, names),
    device: s.json.status?.device_name,
    syncRoot: s.json.status?.sync_root,
    checkedAt,
  };
}

function OverviewBlock({ view, checking }: { view?: View; checking: boolean }) {
  const o = view?.overall ?? { headline: "Checking…", shade: "grey" as Shade };
  return (
    <div style={box}>
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
    </div>
  );
}

function LinkCard({ card }: { card: Card }) {
  return (
    // onActivate makes the card a focus target, so the controller can scroll through the list.
    <Focusable
      onActivate={() => {}}
      data-st-card={card.mappingId}
      data-st-state={card.word}
      data-st-name={card.appName}
      style={{ ...box, marginTop: 6, borderLeft: `3px solid ${BAR[card.shade]}` }}
    >
      <div style={row1}>
        <span style={dot(card.shade)} />
        <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{card.appName}</span>
        <span style={{ marginLeft: "auto", fontSize: 11, color: WORD[card.shade], textAlign: "right" }}>{card.word}</span>
      </div>
      <div style={{ fontSize: 11, color: MUTED, marginLeft: 15 }}>{sizeLine(card)}</div>
      {card.shade === "amber" && (
        <div style={{ fontSize: 11, color: BAR.amber, marginLeft: 15, lineHeight: 1.4 }}>
          {card.detail} Open the desktop app to fix.
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
      setView(await check());
    } catch (e) {
      setView({ overall: { headline: "Check failed", shade: "amber", detail: String(e) }, cards: [], checkedAt: "" });
    } finally {
      setChecking(false);
    }
  };

  // Checks when the panel opens and on Check now only: no background polling, to spare the battery.
  useEffect(() => {
    void run();
  }, []);

  return (
    <>
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

export default definePlugin(() => ({
  name: "SaveTether",
  titleView: <div className={staticClasses.Title}>SaveTether</div>,
  content: <Content />,
  icon: <FaLink />,
}));
