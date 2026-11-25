// When to toast after a check: the desktop app's HealthMonitor rules (SaveTether's
// src/SaveTether.Gui.Presentation/HealthMonitor.cs, desktop-app-spec 3.1): each problem once, nothing while
// another process holds the lock, "Health check failed" after three failures. The text is the panel's
// headline, a count ("2 apps need attention."), not a list: the panel or the desktop app shows the rest.
// Pure, no React, so `node --test` can run it.

import { cardsFor, overall, type BackendResult, type StatusEnvelope } from "./states";

/** As HealthMonitor.FailuresBeforeAmber. */
export const failuresBeforeAmber = 3;

export interface Monitor {
  /** Takes one check's result; returns the toast's text, or null for none. */
  accept(result: BackendResult<StatusEnvelope>, names?: Record<string, string>): string | null;
}

/**
 * What is amber, as keys that stay the same while the problem does, and the headline to toast. A device-wide
 * condition is one problem: the links under it are covered by its headline.
 */
function problems(envelope: StatusEnvelope, names: Record<string, string>): { keys: string[]; text: string } {
  const o = overall(envelope, names);
  if (o.shade !== "amber") return { keys: [], text: "" };
  // overall() says "N app(s) need(s) attention" only when no device-wide condition comes first.
  const keys = envelope.status && /^\d+ apps? needs? attention$/.test(o.headline)
    ? cardsFor(envelope, names).filter((c) => c.shade === "amber").map((c) => `${c.mappingId}:${c.word}`)
    : [`condition:${o.headline}`];
  return { keys, text: `${o.headline}.` };
}

export function createMonitor(): Monitor {
  let notified = new Set<string>();
  let failures = 0;

  // Toasts only when something is amber that was not at the last accepted check.
  const accept = ({ keys, text }: { keys: string[]; text: string }): string | null => {
    const fresh = keys.some((k) => !notified.has(k));
    notified = new Set(keys);
    return fresh ? text : null;
  };

  return {
    accept(result, names = {}) {
      if (!result.ok) {
        // A failed check keeps the last state; three in a row are a problem of their own.
        failures++;
        return failures >= failuresBeforeAmber
          ? accept({ keys: ["condition:Health check failed"], text: "Health check failed." })
          : null;
      }
      failures = 0;
      // Another process is changing links: a folder may look unlinked for a moment, so nothing changes.
      if (result.json.status?.operation_running === true) return null;
      return accept(problems(result.json, names));
    },
  };
}

export type Gate = "muted" | "hidden" | "show";

/**
 * What happens to a due toast: muted by the device's switch (not sent), sent but hidden by Steam's "Show
 * Notification Toasts" set to Never (Steam drops it, the plugin only logs it), or shown.
 */
export function gate(muted: boolean, steamOff: boolean): Gate {
  return muted ? "muted" : steamOff ? "hidden" : "show";
}
