// What to toast after a check: a port of the desktop app's HealthMonitor (SaveTether's
// src/SaveTether.Gui.Presentation/HealthMonitor.cs, desktop-app-spec 3.1), so the Deck and the desktop
// notify the same problems in the same words. Pure, no React, so `node --test` can run it.

import { cardsFor, overall, type BackendResult, type StatusEnvelope } from "./states";

/** As HealthMonitor.FailuresBeforeAmber. */
export const failuresBeforeAmber = 3;

export interface Monitor {
  /** Takes one check's result; returns the toast's text, or null for none. */
  accept(result: BackendResult<StatusEnvelope>, names?: Record<string, string>): string | null;
}

type Problem = { key: string; text: string };

const lower = (word: string) => (word.length === 0 ? word : word[0].toLowerCase() + word.slice(1));

/**
 * What is amber, each with a key that stays the same while the problem does. A device-wide condition is one
 * problem: the links under it are covered by its headline.
 */
function problems(envelope: StatusEnvelope, names: Record<string, string>): Problem[] {
  const o = overall(envelope, names);
  if (o.shade !== "amber") return [];
  // overall() says "N app(s) need(s) attention" only when no device-wide condition comes first.
  if (envelope.status && /^\d+ apps? needs? attention$/.test(o.headline)) {
    return cardsFor(envelope, names)
      .filter((c) => c.shade === "amber")
      .map((c) => ({ key: `${c.mappingId}:${c.word}`, text: `${c.appName} ${c.role}: ${lower(c.word)}.` }));
  }
  return [{ key: `condition:${o.headline}`, text: `${o.headline}.` }];
}

export function createMonitor(): Monitor {
  let notified = new Set<string>();
  let failures = 0;

  const accept = (found: Problem[]): string | null => {
    const fresh = found.filter((p) => !notified.has(p.key)).map((p) => p.text);
    notified = new Set(found.map((p) => p.key));
    return fresh.length === 0 ? null : fresh.join(" ");
  };

  return {
    accept(result, names = {}) {
      if (!result.ok) {
        // A failed check keeps the last state; three in a row are a problem of their own.
        failures++;
        return failures >= failuresBeforeAmber
          ? accept([{ key: "condition:Health check failed", text: "Health check failed." }])
          : null;
      }
      failures = 0;
      // Another process is changing links: a folder may look unlinked for a moment, so nothing changes.
      if (result.json.status?.operation_running === true) return null;
      return accept(problems(result.json, names));
    },
  };
}
