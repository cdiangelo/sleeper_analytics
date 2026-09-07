/**
 * Turning raw Sleeper responses into the shapes screens render.
 *
 * The headline gotcha (spec §3): /rosters lags the draft. It can still be
 * serving last season's teams while the current draft sits 154 picks deep. So
 * rosters are reconstructed from draft picks plus transactions, then
 * reconciled against /rosters — and where the two disagree the app says so
 * rather than silently picking a side.
 */

import {
  KEEPER_ESCALATION,
  ROSTER_DIRECTORY,
  WAIVER_KEEPER_ROUND,
} from "./constants.js";
import type {
  DraftPick,
  LeagueUser,
  Player,
  PlayerIndex,
  Roster,
  Transaction,
} from "./types.js";

export interface Team {
  rosterId: number;
  ownerId: string | null;
  /** Sleeper's team name if set, else the owner's display name. */
  name: string;
  owner: string;
  avatar: string | null;
  wins: number;
  losses: number;
  ties: number;
  pointsFor: number;
  pointsAgainst: number;
  faabUsed: number;
  faabRemaining: number;
  waiverPosition: number | null;
}

/** Sleeper splits fantasy points into whole and decimal parts. */
function points(whole: number | undefined, decimal: number | undefined): number {
  return (whole ?? 0) + (decimal ?? 0) / 100;
}

export function buildTeams(
  users: LeagueUser[],
  rosters: Roster[],
  faabBudget: number,
): Team[] {
  const byId = new Map(users.map((u) => [u.user_id, u]));

  return rosters
    .map((r): Team => {
      const user = r.owner_id ? byId.get(r.owner_id) : undefined;
      const fallback = ROSTER_DIRECTORY[r.roster_id];
      const owner = user?.display_name ?? fallback?.owner ?? `Roster ${r.roster_id}`;
      const faabUsed = r.settings.waiver_budget_used ?? 0;

      return {
        rosterId: r.roster_id,
        ownerId: r.owner_id,
        name: user?.metadata?.team_name?.trim() || fallback?.team || owner,
        owner,
        avatar: user?.avatar ?? null,
        wins: r.settings.wins ?? 0,
        losses: r.settings.losses ?? 0,
        ties: r.settings.ties ?? 0,
        pointsFor: points(r.settings.fpts, r.settings.fpts_decimal),
        pointsAgainst: points(r.settings.fpts_against, r.settings.fpts_against_decimal),
        faabUsed,
        faabRemaining: faabBudget - faabUsed,
        waiverPosition: r.settings.waiver_position ?? null,
      };
    })
    .sort((a, b) => a.rosterId - b.rosterId);
}

// --- roster reconstruction --------------------------------------------------

export type RosterMap = Map<number, Set<string>>;

/**
 * Rebuild every team's roster from the draft board forward, replaying
 * transactions in the order Sleeper recorded them.
 *
 * Only completed transactions count — pending waiver claims have not happened
 * yet and failed ones never will.
 */
export function reconstructRosters(
  draftPicks: DraftPick[],
  transactions: Transaction[],
): RosterMap {
  const rosters: RosterMap = new Map();
  const owned = (rosterId: number) => {
    let set = rosters.get(rosterId);
    if (!set) {
      set = new Set();
      rosters.set(rosterId, set);
    }
    return set;
  };

  for (const pick of draftPicks) {
    if (pick.roster_id != null) owned(pick.roster_id).add(pick.player_id);
  }

  const completed = transactions
    .filter((t) => t.status === "complete")
    .sort((a, b) => a.created - b.created);

  for (const tx of completed) {
    // Drops before adds: a same-transaction add/drop of one player (rare, but
    // Sleeper allows it in trades) should leave the player on the new roster.
    for (const [playerId, rosterId] of Object.entries(tx.drops ?? {})) {
      owned(rosterId).delete(playerId);
    }
    for (const [playerId, rosterId] of Object.entries(tx.adds ?? {})) {
      owned(rosterId).add(playerId);
    }
  }

  return rosters;
}

export interface RosterDiscrepancy {
  playerId: string;
  /** Where draft + transactions say the player is. */
  reconstructed: number | null;
  /** Where /rosters says the player is. */
  reported: number | null;
}

export interface Reconciliation {
  agree: boolean;
  matched: number;
  discrepancies: RosterDiscrepancy[];
  /** Human-readable summary for the warning banner. */
  summary: string;
}

/**
 * Compare the reconstruction against what /rosters reports. Disagreement is
 * expected in the days after a draft and is surfaced, not resolved.
 */
export function reconcileRosters(
  reconstructed: RosterMap,
  rosters: Roster[],
): Reconciliation {
  const reportedOwner = new Map<string, number>();
  for (const r of rosters) {
    for (const playerId of r.players ?? []) reportedOwner.set(playerId, r.roster_id);
  }

  const rebuiltOwner = new Map<string, number>();
  for (const [rosterId, players] of reconstructed) {
    for (const playerId of players) rebuiltOwner.set(playerId, rosterId);
  }

  const discrepancies: RosterDiscrepancy[] = [];
  let matched = 0;

  for (const [playerId, rosterId] of rebuiltOwner) {
    const reported = reportedOwner.get(playerId) ?? null;
    if (reported === rosterId) matched++;
    else discrepancies.push({ playerId, reconstructed: rosterId, reported });
  }
  for (const [playerId, rosterId] of reportedOwner) {
    if (!rebuiltOwner.has(playerId)) {
      discrepancies.push({ playerId, reconstructed: null, reported: rosterId });
    }
  }

  const agree = discrepancies.length === 0;
  return {
    agree,
    matched,
    discrepancies,
    summary: agree
      ? `Rosters reconcile: ${matched} players agree.`
      : `Sleeper's /rosters disagrees with the draft board on ` +
        `${discrepancies.length} player${discrepancies.length === 1 ? "" : "s"} ` +
        `(${matched} agree). Sleeper often lags for a few days after a draft.`,
  };
}

/** Players on no roster. Recompute after every transactions fetch. */
export function freeAgents(index: PlayerIndex, rostered: Iterable<string>): Player[] {
  const taken = new Set(rostered);
  return Object.values(index)
    .filter((p) => !taken.has(p.id))
    .sort((a, b) => (a.rank ?? Infinity) - (b.rank ?? Infinity));
}

export function allRosteredPlayers(rosters: Roster[]): Set<string> {
  const out = new Set<string>();
  for (const r of rosters) {
    for (const playerId of r.players ?? []) out.add(playerId);
  }
  return out;
}

// --- keepers ----------------------------------------------------------------

export interface KeeperOption {
  rosterId: number;
  playerId: string;
  name: string;
  position: string;
  /** Round the player was drafted at this year. */
  draftedRound: number | null;
  /** What keeping them would cost next season. */
  nextYearRound: number;
  wasKeeper: boolean;
}

/**
 * Keeper cost for next season: this year's draft round minus two, escalating
 * annually. Undrafted players (waiver pickups) are treated as roughly a
 * seventh-round cost. Max one keeper per team.
 */
export function keeperOptions(
  rosterId: number,
  playerIds: Iterable<string>,
  draftPicks: DraftPick[],
  index: PlayerIndex,
): KeeperOption[] {
  const pickOf = new Map(draftPicks.map((p) => [p.player_id, p]));

  return [...playerIds]
    .map((playerId): KeeperOption => {
      const pick = pickOf.get(playerId);
      const player = index[playerId];
      const draftedRound = pick?.round ?? null;
      const baseRound = draftedRound ?? WAIVER_KEEPER_ROUND;

      return {
        rosterId,
        playerId,
        name: player?.name ?? playerId,
        position: player?.pos ?? "UNK",
        draftedRound,
        // Round 1 is the floor; a first-rounder cannot get cheaper.
        nextYearRound: Math.max(1, baseRound - KEEPER_ESCALATION),
        wasKeeper: pick?.is_keeper === true,
      };
    })
    .filter((k) => k.position !== "K" && k.position !== "DEF")
    .sort((a, b) => a.nextYearRound - b.nextYearRound);
}

// --- transactions -----------------------------------------------------------

export interface FaabSpend {
  rosterId: number;
  playerId: string;
  bid: number;
  week: number;
  created: number;
}

/** Winning FAAB bids, newest first — the record of what things actually cost. */
export function faabHistory(transactions: Transaction[]): FaabSpend[] {
  const out: FaabSpend[] = [];
  for (const tx of transactions) {
    if (tx.type !== "waiver" || tx.status !== "complete") continue;
    const bid = tx.settings?.waiver_bid ?? 0;
    for (const [playerId, rosterId] of Object.entries(tx.adds ?? {})) {
      out.push({ rosterId, playerId, bid, week: tx.leg, created: tx.created });
    }
  }
  return out.sort((a, b) => b.created - a.created);
}
