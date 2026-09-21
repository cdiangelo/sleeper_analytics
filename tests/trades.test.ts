import { describe, expect, it } from "vitest";

import { handcuffLinks, positionStrength, tradeFits } from "../src/lib/trades.js";
import type { Player, PlayerIndex } from "../src/lib/types.js";

function player(p: Partial<Player> & { id: string }): Player {
  return {
    name: p.id,
    pos: "RB",
    team: "PHI",
    injury: null,
    number: null,
    depthOrder: null,
    rank: null,
    ...p,
  };
}

const index: PlayerIndex = Object.fromEntries(
  [
    // The real case: a starter and his backup on different rosters.
    player({ id: "saquon", name: "Saquon Barkley", team: "PHI", depthOrder: 1 }),
    player({ id: "bigsby", name: "Tank Bigsby", team: "PHI", depthOrder: 2 }),
    player({ id: "shipley", name: "Will Shipley", team: "PHI", depthOrder: 3 }),
    // Same roster owns both — not a trade.
    player({ id: "starterA", team: "KC", depthOrder: 1 }),
    player({ id: "backupA", team: "KC", depthOrder: 2 }),
    // Receivers play regardless of depth, so they are not handcuffs.
    player({ id: "wr1", pos: "WR", team: "SF", depthOrder: 1 }),
    player({ id: "wr2", pos: "WR", team: "SF", depthOrder: 2 }),
  ].map((p) => [p.id, p]),
);

const rosters = [
  { rosterId: 5, players: ["bigsby", "wr2", "starterA", "backupA"] },
  { rosterId: 1, players: ["saquon", "wr1"] },
  { rosterId: 2, players: ["shipley"] },
];

describe("handcuffLinks", () => {
  const links = handcuffLinks(rosters, index);

  it("finds a backup whose starter belongs to someone else", () => {
    expect(links).toContainEqual({
      backupId: "bigsby",
      backupRosterId: 5,
      starterId: "saquon",
      starterRosterId: 1,
      position: "RB",
      team: "PHI",
    });
  });

  it("ignores a handcuff the same manager already owns", () => {
    // Insurance you hold yourself is not a trade chip.
    expect(links.find((l) => l.backupId === "backupA")).toBeUndefined();
  });

  it("ignores receivers, who play regardless of depth", () => {
    expect(links.find((l) => l.backupId === "wr2")).toBeUndefined();
  });

  it("ignores a third stringer — two men ahead is a lottery ticket", () => {
    expect(links.find((l) => l.backupId === "shipley")).toBeUndefined();
  });

  it("finds nothing when the starter is unowned", () => {
    const orphan = [{ rosterId: 5, players: ["bigsby"] }];
    expect(handcuffLinks(orphan, index)).toEqual([]);
  });
});

describe("positionStrength", () => {
  const valueIndex: PlayerIndex = Object.fromEntries(
    [
      player({ id: "rb1" }),
      player({ id: "rb2" }),
      player({ id: "rb3" }),
      player({ id: "rb4" }),
    ].map((p) => [p.id, p]),
  );
  const values: Record<string, number> = { rb1: 20, rb2: 10, rb3: 8, rb4: 1 };

  it("counts only as many players as the lineup starts", () => {
    // Bench depth beyond the starting slots does not win games.
    const rows = positionStrength(
      [
        { rosterId: 1, players: ["rb1", "rb2", "rb3"] },
        { rosterId: 2, players: ["rb4"] },
      ],
      valueIndex,
      (id) => values[id] ?? null,
      { RB: 2 },
    );
    expect(rows.find((r) => r.rosterId === 1)!.value).toBe(30); // 20 + 10, not 38
    expect(rows.find((r) => r.rosterId === 2)!.value).toBe(1);
  });

  it("ranks the strongest team first", () => {
    const rows = positionStrength(
      [
        { rosterId: 1, players: ["rb4"] },
        { rosterId: 2, players: ["rb1"] },
      ],
      valueIndex,
      (id) => values[id] ?? null,
      { RB: 1 },
    );
    expect(rows.find((r) => r.rosterId === 2)!.rank).toBe(1);
    expect(rows.find((r) => r.rosterId === 1)!.rank).toBe(2);
  });
});

describe("tradeFits", () => {
  /** Ten teams so deep/thin thresholds mean something. */
  const many = Array.from({ length: 10 }, (_, i) => ({
    rosterId: i + 1,
    players: [`rb${i + 1}`, `te${i + 1}`],
  }));
  const manyIndex: PlayerIndex = Object.fromEntries(
    many.flatMap((_, i) => [
      [`rb${i + 1}`, player({ id: `rb${i + 1}`, pos: "RB", team: `T${i}` })],
      [`te${i + 1}`, player({ id: `te${i + 1}`, pos: "TE", team: `T${i}` })],
    ]),
  );
  // Roster 1 is best at RB and worst at TE; roster 10 is the mirror.
  const value = (id: string) => {
    const n = Number(id.replace(/\D/g, ""));
    return id.startsWith("rb") ? 100 - n * 5 : n * 5;
  };

  it("pairs you with a team that is your mirror image", () => {
    const fits = tradeFits(1, many, manyIndex, value, { RB: 1, TE: 1 });
    const mirror = fits.find((f) => f.rosterId === 10)!;
    expect(mirror.theyNeed).toContain("RB");
    expect(mirror.youNeed).toContain("TE");
  });

  it("skips a team that needs what you have but has nothing you want", () => {
    // One-directional need is a favour, not a trade.
    const oneWay = tradeFits(1, many, manyIndex, value, { RB: 1 });
    expect(oneWay.every((f) => f.handcuffs.length > 0)).toBe(true);
  });

  it("surfaces a handcuff pairing even with no positional fit", () => {
    const fits = tradeFits(5, rosters, index, () => 10, { RB: 2 });
    const tract = fits.find((f) => f.rosterId === 1)!;
    expect(tract.handcuffs[0]!.backupId).toBe("bigsby");
  });

  it("puts handcuff pairings first — they are the concrete ones", () => {
    const fits = tradeFits(5, rosters, index, () => 10, { RB: 2 });
    expect(fits[0]!.handcuffs.length).toBeGreaterThan(0);
  });

  it("never suggests trading with yourself", () => {
    const fits = tradeFits(5, rosters, index, () => 10, { RB: 2 });
    expect(fits.find((f) => f.rosterId === 5)).toBeUndefined();
  });
});

describe("what counts as a need", () => {
  it("ranks only the positions it is given", () => {
    // Kickers and defences are streamed weekly, so the caller leaves them out;
    // including them produced "they are thin at K" as a headline trade fit.
    const rows = positionStrength(
      [{ rosterId: 1, players: ["k1"] }],
      { k1: player({ id: "k1", pos: "K" }) },
      () => 9,
      { RB: 2 },
    );
    expect(rows.every((r) => r.position === "RB")).toBe(true);
    expect(rows[0]!.value).toBe(0);
  });
});
