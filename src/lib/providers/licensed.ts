// Licensed third-party data providers. RC does NOT scrape these sites and
// does not assume access. Each one connects only when the program has a
// signed data agreement and the provider's API credentials are configured.
// Until then RC shows "Not connected" and coaches use permitted CSV imports.

import type { DataProvider } from "./types";

function licensed(id: string, name: string, envPrefix: string, description: string): DataProvider {
  return {
    id,
    name,
    kind: "licensed_api",
    description,
    supportsSync: true,
    status(env) {
      const key = env[`${envPrefix}_API_KEY`];
      const base = env[`${envPrefix}_API_BASE`];
      if (!key || !base) {
        return {
          status: "not_connected",
          detail: `Requires a licensed data agreement with ${name}. Set ${envPrefix}_API_KEY and ${envPrefix}_API_BASE once access is granted. RC does not scrape ${name}.`,
        };
      }
      return {
        status: "error",
        detail: `Credentials found, but the ${name} adapter must be built against the API specification supplied under your data agreement. No data is pulled until it is.`,
      };
    },
    async sync() {
      throw new Error(`${name} integration is not connected. RC will not access ${name} without a licensed API agreement.`);
    },
  };
}

export const MAXPREPS = licensed("maxpreps", "MaxPreps", "MAXPREPS", "High school schedules, rosters and stats (licensed API required).");
export const PERFECT_GAME = licensed("perfect_game", "Perfect Game", "PERFECT_GAME", "Showcase measurables and event data (licensed API required).");
export const PREP_BASEBALL = licensed("prep_baseball", "Prep Baseball Report", "PBR", "Showcase measurables and scouting data (licensed API required).");
