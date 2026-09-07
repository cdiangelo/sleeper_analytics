/**
 * Depth-chart context for a waiver target (spec §6).
 *
 * A backup's projection is only half the story. What makes them worth a claim
 * is the availability of the players ahead of them: a third-string running
 * back is noise until the starter is ruled out, at which point he is the most
 * valuable player on the wire. The player index already carries
 * `depth_chart_order`, so this costs nothing extra to compute.
 */

import { injurySeverity } from "./news.js";
import type { Player, PlayerIndex } from "./types.js";

export interface DepthNeighbour {
  playerId: string;
  name: string;
  order: number;
  injury: string | null;
}

export interface DepthContext {
  /** Where they sit on their team's depth chart, if known. */
  order: number | null;
  /** Genuine starters at the same position on the same team, ranked ahead. */
  ahead: DepthNeighbour[];
  /** Those of them who are Doubtful or worse. */
  unavailableAhead: DepthNeighbour[];
  /**
   * True when every starter ahead is Doubtful or worse — the backup is next
   * up, which is the whole reason to look at him.
   */
  opportunity: boolean;
}

/** Doubtful or worse. Questionable is too weak a signal to act on. */
const UNAVAILABLE = 2;

/**
 * Only the top of a depth chart blocks anyone. Sleeper's `depth_chart_order`
 * runs deep and gets unreliable fast: without this, a ninth receiver with a
 * long-injured eighth ahead of him reads as an opportunity, which is noise.
 */
const BLOCKING_DEPTH = 2;

/** Past this, a player is not one absence away from touches. */
const CONTRIBUTOR_DEPTH = 4;

export function depthChartContext(index: PlayerIndex, playerId: string): DepthContext {
  const player = index[playerId];
  const empty: DepthContext = {
    order: null,
    ahead: [],
    unavailableAhead: [],
    opportunity: false,
  };
  if (!player?.team || player.depthOrder == null) return empty;

  const ahead: DepthNeighbour[] = [];
  for (const other of Object.values(index) as Player[]) {
    if (other.id === player.id) continue;
    if (other.team !== player.team || other.pos !== player.pos) continue;
    if (other.depthOrder == null || other.depthOrder >= player.depthOrder) continue;
    if (other.depthOrder > BLOCKING_DEPTH) continue;
    ahead.push({
      playerId: other.id,
      name: other.name,
      order: other.depthOrder,
      injury: other.injury,
    });
  }

  ahead.sort((a, b) => a.order - b.order);
  const unavailableAhead = ahead.filter((p) => injurySeverity(p.injury) >= UNAVAILABLE);

  return {
    order: player.depthOrder,
    ahead,
    unavailableAhead,
    opportunity:
      // Nobody ahead at all is not an opportunity — that is just a starter.
      ahead.length > 0 &&
      unavailableAhead.length === ahead.length &&
      player.depthOrder <= CONTRIBUTOR_DEPTH,
  };
}

/** One line of context for a waiver row, or empty when there is nothing to say. */
export function describeDepth(context: DepthContext): string {
  if (context.opportunity) {
    const names = context.unavailableAhead.map((p) => p.name).join(", ");
    return context.ahead.length === 1
      ? `next up — ${names} out`
      : `next up — ${names} all out`;
  }
  if (context.unavailableAhead.length > 0) {
    return `${context.unavailableAhead.map((p) => p.name).join(", ")} out ahead`;
  }
  return "";
}
