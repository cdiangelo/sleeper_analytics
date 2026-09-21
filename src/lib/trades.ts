/**
 * Trade fits.
 *
 * Two signals, both cheap and both non-obvious from a standings page:
 *
 *  - A handcuff you own is worth far more to the manager who owns the starter
 *    than to you. He is insurance to them and a bench spot to you.
 *  - A trade only happens when it is mutual, so a fit means each side is deep
 *    where the other is thin.
 *
 * Deliberately narrow. A long ranked list of every player on every roster is
 * a spreadsheet, not a suggestion.
 */

import type { PlayerIndex } from "./types.js";

export interface RosterLike {
  rosterId: number;
  players: readonly string[];
}

/** Rest-of-season value per week. Null where nothing is projected. */
export type ValueLookup = (playerId: string) => number | null;

// --- handcuffs --------------------------------------------------------------

export interface HandcuffLink {
  /** The backup, and who holds him. */
  backupId: string;
  backupRosterId: number;
  /** The starter he sits behind, and who holds him. */
  starterId: string;
  starterRosterId: number;
  position: string;
  team: string;
}

/**
 * Backups whose starter belongs to someone else.
 *
 * Only running backs: a second receiver or tight end plays anyway, so being
 * next in line means little. A backup back is the one whose value is almost
 * entirely contingent on the man ahead of him.
 */
export function handcuffLinks(
  rosters: readonly RosterLike[],
  index: PlayerIndex,
  positions: readonly string[] = ["RB"],
): HandcuffLink[] {
  const ownerOf = new Map<string, number>();
  for (const roster of rosters) {
    for (const id of roster.players) ownerOf.set(id, roster.rosterId);
  }

  const links: HandcuffLink[] = [];
  for (const [backupId, backupRosterId] of ownerOf) {
    // Strictly the next man up. Third string sits behind two healthy players,
    // which is a lottery ticket rather than insurance, and nobody trades for
    // one.
    const backup = index[backupId];
    if (!backup?.team || backup.depthOrder !== 2) continue;
    if (!positions.includes(backup.pos)) continue;
    const starter = Object.values(index).find(
      (p) =>
        p.team === backup.team && p.pos === backup.pos && p.depthOrder === 1,
    );
    if (!starter) continue;

    const starterRosterId = ownerOf.get(starter.id);
    if (starterRosterId == null || starterRosterId === backupRosterId) continue;

    links.push({
      backupId,
      backupRosterId,
      starterId: starter.id,
      starterRosterId,
      position: backup.pos,
      team: backup.team,
    });
  }
  return links;
}

// --- positional surplus and need -------------------------------------------

export interface PositionStrength {
  rosterId: number;
  position: string;
  /** Combined value of the players who would fill this position's slots. */
  value: number;
  /** 1 is the strongest team in the league at this position. */
  rank: number;
}

/**
 * Starter-quality by position for every team: the top N players at that
 * position, where N is how many the lineup starts. Bench depth beyond that
 * does not win games, so it does not count toward strength.
 */
export function positionStrength(
  rosters: readonly RosterLike[],
  index: PlayerIndex,
  valueOf: ValueLookup,
  slots: Record<string, number>,
): PositionStrength[] {
  const rows: PositionStrength[] = [];

  for (const position of Object.keys(slots)) {
    const scored = rosters.map((roster) => {
      const values = roster.players
        .filter((id) => index[id]?.pos === position)
        .map((id) => valueOf(id) ?? 0)
        .sort((a, b) => b - a)
        .slice(0, slots[position]);
      return {
        rosterId: roster.rosterId,
        position,
        value: values.reduce((a, b) => a + b, 0),
        rank: 0,
      };
    });

    scored
      .sort((a, b) => b.value - a.value)
      .forEach((row, i) => {
        row.rank = i + 1;
      });
    rows.push(...scored);
  }

  return rows;
}

export interface TradeFit {
  rosterId: number;
  /** Positions they are thin at and you are deep at. */
  theyNeed: string[];
  /** Positions you are thin at and they are deep at. */
  youNeed: string[];
  /** Handcuffs sitting on the wrong roster, either direction. */
  handcuffs: HandcuffLink[];
}

/**
 * Teams worth approaching.
 *
 * A fit needs both directions — a team that is thin where you are deep but
 * has nothing you want is not a trade, it is a favour. Handcuff links count
 * on their own, because the whole point is that the player is worth more to
 * them than the market price.
 */
export function tradeFits(
  myRosterId: number,
  rosters: readonly RosterLike[],
  index: PlayerIndex,
  valueOf: ValueLookup,
  slots: Record<string, number>,
  opts: { deep?: number; thin?: number } = {},
): TradeFit[] {
  const deep = opts.deep ?? 3;
  const thin = opts.thin ?? 7;

  const strength = positionStrength(rosters, index, valueOf, slots);
  const rankOf = (rosterId: number, position: string) =>
    strength.find((r) => r.rosterId === rosterId && r.position === position)?.rank ??
    99;

  const links = handcuffLinks(rosters, index);
  const teamCount = rosters.length;

  const fits: TradeFit[] = [];
  for (const roster of rosters) {
    if (roster.rosterId === myRosterId) continue;

    const theyNeed: string[] = [];
    const youNeed: string[] = [];
    for (const position of Object.keys(slots)) {
      const mine = rankOf(myRosterId, position);
      const theirs = rankOf(roster.rosterId, position);
      if (mine <= deep && theirs >= thin) theyNeed.push(position);
      if (theirs <= deep && mine >= thin) youNeed.push(position);
    }

    const handcuffs = links.filter(
      (l) =>
        (l.backupRosterId === myRosterId && l.starterRosterId === roster.rosterId) ||
        (l.starterRosterId === myRosterId && l.backupRosterId === roster.rosterId),
    );

    if (handcuffs.length === 0 && (theyNeed.length === 0 || youNeed.length === 0)) {
      continue;
    }
    fits.push({ rosterId: roster.rosterId, theyNeed, youNeed, handcuffs });
  }

  // Handcuff links first — they are the concrete ones. Then mutual fits.
  return fits
    .sort(
      (a, b) =>
        b.handcuffs.length - a.handcuffs.length ||
        Math.min(b.theyNeed.length, b.youNeed.length) -
          Math.min(a.theyNeed.length, a.youNeed.length),
    )
    .slice(0, Math.max(3, Math.floor(teamCount / 2)));
}
