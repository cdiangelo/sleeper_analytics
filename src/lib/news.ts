/**
 * News from the data already on hand.
 *
 * Sleeper publishes no news API, but the player index carries `injury_status`
 * for everyone. Diffing it week over week catches most of what actually
 * matters — a starter ruled out, a questionable tag cleared — with no second
 * source and no server (spec §7, tier 1).
 */

import type { PlayerIndex } from "./types.js";

/**
 * How bad a status is, so a change can be called an improvement or not.
 * Anything unrecognised sits just above questionable: unknown is not good news.
 */
const SEVERITY: Record<string, number> = {
  Questionable: 1,
  Doubtful: 2,
  Out: 3,
  Suspended: 4,
  Sus: 4,
  PUP: 4,
  IR: 5,
  "Injured Reserve": 5,
  NA: 5,
  DNR: 5,
  COV: 3,
};

export function injurySeverity(status: string | null | undefined): number {
  if (!status) return 0;
  return SEVERITY[status] ?? 2;
}

/** A player whose availability changed between two snapshots. */
export interface StatusChange {
  playerId: string;
  from: string | null;
  to: string | null;
  /** True when the player got healthier. */
  improved: boolean;
  /** When the change was first observed. */
  at: number;
}

export type InjurySnapshot = Record<string, string | null>;

/** Availability of every player carrying a status, for storing between loads. */
export function injurySnapshot(index: PlayerIndex): InjurySnapshot {
  const out: InjurySnapshot = {};
  for (const player of Object.values(index)) {
    if (player.injury) out[player.id] = player.injury;
  }
  return out;
}

/**
 * Compare a stored snapshot against the current index.
 *
 * A player absent from the snapshot but carrying a status now is newly hurt; a
 * player in the snapshot with no status now has been cleared. An empty
 * snapshot yields nothing rather than reporting the entire league as newly
 * injured on first run.
 */
export function diffInjuries(
  previous: InjurySnapshot,
  index: PlayerIndex,
  now = Date.now(),
): StatusChange[] {
  if (Object.keys(previous).length === 0) return [];

  const changes: StatusChange[] = [];

  // Only players still in the index. Someone who fell out of it entirely was
  // released or stopped being fantasy-relevant, which is not a recovery.
  for (const player of Object.values(index)) {
    const before = previous[player.id] ?? null;
    const after = player.injury ?? null;
    if (before === after) continue;
    changes.push({
      playerId: player.id,
      from: before,
      to: after,
      improved: injurySeverity(after) < injurySeverity(before),
      at: now,
    });
  }

  return changes.sort(
    (a, b) => injurySeverity(b.to) - injurySeverity(a.to) || a.playerId.localeCompare(b.playerId),
  );
}

/** Drop changes older than the window so the feed stays current. */
export function pruneChanges(
  changes: StatusChange[],
  windowMs = 7 * 24 * 60 * 60_000,
  now = Date.now(),
): StatusChange[] {
  return changes.filter((c) => now - c.at <= windowMs);
}

/**
 * Merge newly observed changes into the stored feed, keeping one entry per
 * player — the latest. A player who goes Questionable then Out inside a week
 * is one story, not two.
 */
export function mergeChanges(
  stored: StatusChange[],
  fresh: StatusChange[],
): StatusChange[] {
  const byPlayer = new Map<string, StatusChange>();
  for (const change of [...stored, ...fresh]) {
    const existing = byPlayer.get(change.playerId);
    if (!existing || change.at >= existing.at) byPlayer.set(change.playerId, change);
  }
  return [...byPlayer.values()].sort((a, b) => b.at - a.at);
}

export function describeChange(change: StatusChange): string {
  if (!change.from) return `now ${change.to}`;
  if (!change.to) return `cleared from ${change.from}`;
  return `${change.from} → ${change.to}`;
}
