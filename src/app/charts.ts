/**
 * Inline SVG charts. No chart library: this is a read-only, data-dense app on
 * a phone, and hand-written SVG is smaller and faster than anything a library
 * would render for these shapes.
 *
 * Every chart scales to its container via viewBox, so nothing scrolls
 * sideways at 380px.
 */

import { esc, num } from "./format.js";

export interface Series {
  label: string;
  color: string;
  values: Array<number | null>;
  /** Dashed lines read as reference series rather than data. */
  dashed?: boolean;
}

const W = 320;
const H = 150;
const PAD = { top: 10, right: 8, bottom: 20, left: 28 };

/**
 * Multi-series line chart over a shared x axis (weeks).
 *
 * Used for score vs league average vs week high — three series, one chart.
 */
export function lineChart(
  xLabels: Array<string | number>,
  series: Series[],
  opts: { yLabel?: string } = {},
): string {
  const all = series.flatMap((s) => s.values).filter((v): v is number => v != null);
  if (all.length === 0 || xLabels.length === 0) return "";

  const rawMin = Math.min(...all);
  const rawMax = Math.max(...all);
  // Pad the range so lines never sit on the frame, and keep a sane floor.
  const span = Math.max(1, rawMax - rawMin);
  const yMin = Math.max(0, rawMin - span * 0.15);
  const yMax = rawMax + span * 0.15;

  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;

  const x = (i: number) =>
    PAD.left + (xLabels.length === 1 ? plotW / 2 : (plotW * i) / (xLabels.length - 1));
  const y = (v: number) => PAD.top + plotH - ((v - yMin) / (yMax - yMin)) * plotH;

  // Three gridlines is enough context without crowding a phone screen.
  const ticks = [yMin, (yMin + yMax) / 2, yMax];
  const grid = ticks
    .map(
      (t) =>
        `<line x1="${PAD.left}" y1="${y(t).toFixed(1)}" x2="${W - PAD.right}" y2="${y(t).toFixed(1)}" stroke="var(--line)" stroke-width="1"/>` +
        `<text x="${PAD.left - 5}" y="${(y(t) + 3.5).toFixed(1)}" text-anchor="end" font-size="9" fill="var(--ink-faint)">${num(t, 0)}</text>`,
    )
    .join("");

  const xAxis = xLabels
    .map((label, i) =>
      // Thin the labels once a season's worth of weeks won't fit.
      xLabels.length > 9 && i % 2 === 1
        ? ""
        : `<text x="${x(i).toFixed(1)}" y="${H - 6}" text-anchor="middle" font-size="9" fill="var(--ink-faint)">${esc(label)}</text>`,
    )
    .join("");

  const lines = series
    .map((s) => {
      // Break the path at gaps rather than interpolating across a missing week.
      const segments: string[] = [];
      let current: string[] = [];
      s.values.forEach((v, i) => {
        if (v == null) {
          if (current.length) segments.push(current.join(" "));
          current = [];
          return;
        }
        current.push(`${current.length ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`);
      });
      if (current.length) segments.push(current.join(" "));

      const path = segments
        .map(
          (d) =>
            `<path d="${d}" fill="none" stroke="${s.color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"${
              s.dashed ? ' stroke-dasharray="3 3" stroke-width="1.5"' : ""
            }/>`,
        )
        .join("");

      // Dots only on the primary series; three dotted lines is noise.
      const dots = s.dashed
        ? ""
        : s.values
            .map((v, i) =>
              v == null
                ? ""
                : `<circle cx="${x(i).toFixed(1)}" cy="${y(v).toFixed(1)}" r="2.5" fill="${s.color}"/>`,
            )
            .join("");

      return path + dots;
    })
    .join("");

  const legend = series
    .map(
      (s) =>
        `<span><i class="swatch" style="background:${s.color}${s.dashed ? ";opacity:.7" : ""}"></i>${esc(s.label)}</span>`,
    )
    .join("");

  return (
    `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(opts.yLabel ?? "chart")}">` +
    grid +
    xAxis +
    lines +
    `</svg><div class="legend">${legend}</div>`
  );
}

export interface EmphasisSeries {
  id: string;
  label: string;
  /** Starters are drawn bright; everyone else recedes. */
  emphasis: boolean;
  points: Array<{
    week: number;
    actual: number | null;
    projected: number | null;
    /**
     * Points this league's bonuses add over generic half PPR. Not drawn — it
     * rides along for the tap readout, which is where that comparison moved
     * when it stopped being a column.
     */
    edge?: number | null;
  }>;
}

/** Coordinate mapping, returned so a click can be resolved to a data point. */
export interface ChartGeometry {
  vbW: number;
  vbH: number;
  padLeft: number;
  padTop: number;
  plotW: number;
  plotH: number;
  weeks: number;
  max: number;
}

/**
 * Every player on the roster as its own line.
 *
 * Seventeen distinct hues would be unreadable and is a known anti-pattern, so
 * colour carries one thing only: starting or benched. Individual identity comes
 * from tapping a line, which is also why the roster table below stays — it is
 * the table view, where every value is readable without hovering anything.
 */
export function emphasisLineChart(
  series: EmphasisSeries[],
  opts: { weeks: number; max: number; selectedId?: string | null },
): { svg: string; geometry: ChartGeometry } {
  const vbW = 320;
  const vbH = 214;
  const pad = { top: 8, right: 8, bottom: 26, left: 26 };
  const plotW = vbW - pad.left - pad.right;
  const plotH = vbH - pad.top - pad.bottom;
  const max = Math.max(1, opts.max);
  const weeks = Math.max(2, opts.weeks);

  const geometry: ChartGeometry = {
    vbW,
    vbH,
    padLeft: pad.left,
    padTop: pad.top,
    plotW,
    plotH,
    weeks,
    max,
  };

  const x = (week: number) => pad.left + (plotW * (week - 1)) / (weeks - 1);
  const y = (v: number) => pad.top + plotH - (v / max) * plotH;

  // Solid hairlines, one shade off the surface. Never dashed: dashing means
  // "projected" on this chart and must not also mean "grid".
  const grid = [0, max / 2, max]
    .map(
      (t) =>
        `<line x1="${pad.left}" y1="${y(t).toFixed(1)}" x2="${vbW - pad.right}" y2="${y(t).toFixed(1)}" stroke="var(--line)" stroke-width="1"/>` +
        `<text x="${pad.left - 4}" y="${(y(t) + 3).toFixed(1)}" text-anchor="end" font-size="8.5" fill="var(--ink-faint)">${t.toFixed(0)}</text>`,
    )
    .join("");

  const step = weeks > 10 ? 3 : 2;
  const xAxis = Array.from({ length: weeks }, (_, i) => i + 1)
    .filter((week) => week === 1 || week === weeks || week % step === 0)
    .map(
      (week) =>
        `<text x="${x(week).toFixed(1)}" y="${vbH - 8}" text-anchor="middle" font-size="8.5" fill="var(--ink-faint)">${week}</text>`,
    )
    .join("");

  const linesFor = (s: EmphasisSeries) => {
    const build = (pick: (p: EmphasisSeries["points"][number]) => number | null) => {
      const segs: string[] = [];
      let cur: string[] = [];
      for (const p of s.points) {
        const v = pick(p);
        if (v == null) {
          if (cur.length > 1) segs.push(cur.join(" "));
          cur = [];
          continue;
        }
        cur.push(`${cur.length ? "L" : "M"}${x(p.week).toFixed(1)},${y(v).toFixed(1)}`);
      }
      if (cur.length > 1) segs.push(cur.join(" "));
      return segs;
    };

    const selected = opts.selectedId === s.id;
    // With a line picked, everything else recedes hard. Seventeen lines at
    // phone width is a thicket; the only way a selection reads is if the rest
    // gets out of its way.
    const dimmed = opts.selectedId != null && !selected;
    const color = selected
      ? "var(--good)"
      : s.emphasis
        ? "var(--accent)"
        : "var(--ink-faint)";
    const opacity = selected
      ? 1
      : dimmed
        ? s.emphasis
          ? 0.16
          : 0.09
        : s.emphasis
          ? 0.8
          : 0.36;
    const width = selected ? 2.6 : s.emphasis ? 1.8 : 1.3;

    const draw = (d: string, dashed: boolean) =>
      `<path d="${d}" fill="none" stroke="${color}" stroke-width="${width}" ` +
      `opacity="${dashed ? opacity * 0.8 : opacity}" stroke-linecap="round" ` +
      `stroke-linejoin="round"${dashed ? ' stroke-dasharray="3 3"' : ""}/>`;

    const actual = build((p) => p.actual);
    const projected = build((p) => p.projected);

    // Single points would otherwise be invisible — common in week 1, where a
    // player has one projection and no history at all.
    const dots = s.points
      .filter((p) => p.actual != null || p.projected != null)
      .map((p) => {
        const v = (p.actual ?? p.projected)!;
        // Dots on a dimmed line are noise; the selection keeps its markers.
        if (dimmed) return "";
        const r = selected ? 3.2 : s.emphasis ? 2.1 : 1.7;
        return `<circle cx="${x(p.week).toFixed(1)}" cy="${y(v).toFixed(1)}" r="${r}" fill="${color}" opacity="${opacity}"/>`;
      })
      .join("");

    return (
      actual.map((d) => draw(d, false)).join("") +
      projected.map((d) => draw(d, true)).join("") +
      dots
    );
  };

  // Benched first so starters, and the selection, sit on top.
  const ordered = [...series].sort((a, b) => {
    const rank = (s: EmphasisSeries) =>
      s.id === opts.selectedId ? 2 : s.emphasis ? 1 : 0;
    return rank(a) - rank(b);
  });

  const svg =
    `<svg class="chart chart-tap" viewBox="0 0 ${vbW} ${vbH}" role="img" ` +
    `aria-label="Weekly points for every player on the roster">` +
    grid +
    xAxis +
    ordered.map(linesFor).join("") +
    `</svg>`;

  return { svg, geometry };
}

/** Nearest data point to a click, in viewBox coordinates. */
export function nearestPoint(
  series: EmphasisSeries[],
  geometry: ChartGeometry,
  vx: number,
  vy: number,
): { series: EmphasisSeries; week: number; value: number; projected: boolean } | null {
  const x = (week: number) =>
    geometry.padLeft + (geometry.plotW * (week - 1)) / (geometry.weeks - 1);
  const y = (v: number) =>
    geometry.padTop + geometry.plotH - (v / geometry.max) * geometry.plotH;

  let best: ReturnType<typeof nearestPoint> = null;
  let bestDist = Infinity;

  for (const s of series) {
    for (const p of s.points) {
      const value = p.actual ?? p.projected;
      if (value == null) continue;
      const d = Math.hypot(x(p.week) - vx, y(value) - vy);
      if (d < bestDist) {
        bestDist = d;
        best = { series: s, week: p.week, value, projected: p.actual == null };
      }
    }
  }

  // Generous radius: the reader only has to be closest, not accurate.
  return bestDist <= 28 ? best : null;
}

/**
 * Horizontal bar comparing a value against a reference, drawn inside a table
 * cell. Used for positional contribution vs the league average.
 */
export function barCell(value: number, max: number, bad = false): string {
  const width = max <= 0 ? 0 : Math.max(0, Math.min(100, (value / max) * 100));
  return `<span class="bar${bad ? " is-bad" : ""}"><i style="width:${width.toFixed(1)}%"></i></span>`;
}

/**
 * Row sparkline: what a player has actually scored, continuing into what they
 * are projected to score.
 *
 * Solid is real, dashed is forecast — the one place dashing carries meaning
 * rather than adding noise. Sized to occupy roughly two table columns.
 */
export function seasonSpark(
  points: Array<{ week: number; actual: number | null; projected: number | null }>,
  opts: { max: number; weeks: number; muted?: boolean } = { max: 1, weeks: 17 },
): string {
  const w = 96;
  const h = 26;
  const pad = 2;
  const color = opts.muted ? "var(--ink-faint)" : "var(--accent)";
  const max = Math.max(1, opts.max);

  const x = (week: number) =>
    pad + ((w - pad * 2) * (week - 1)) / Math.max(1, opts.weeks - 1);
  const y = (v: number) => h - pad - (v / max) * (h - pad * 2);

  // Two paths from one series: the played part and the forecast part, joined
  // at the boundary so the line does not visibly break.
  const path = (pick: (p: (typeof points)[number]) => number | null) => {
    const segs: string[] = [];
    let cur: string[] = [];
    for (const p of points) {
      const v = pick(p);
      if (v == null) {
        if (cur.length > 1) segs.push(cur.join(" "));
        cur = [];
        continue;
      }
      cur.push(`${cur.length ? "L" : "M"}${x(p.week).toFixed(1)},${y(v).toFixed(1)}`);
    }
    if (cur.length > 1) segs.push(cur.join(" "));
    return segs;
  };

  const actualPaths = path((p) => p.actual);
  // Bridge the last actual into the first projection so the eye follows one line.
  const lastActual = [...points].reverse().find((p) => p.actual != null);
  const projected = points.filter((p) => p.projected != null);
  const bridge =
    lastActual && projected.length
      ? [
          `M${x(lastActual.week).toFixed(1)},${y(lastActual.actual!).toFixed(1)}`,
          `L${x(projected[0]!.week).toFixed(1)},${y(projected[0]!.projected!).toFixed(1)}`,
        ].join(" ")
      : null;
  const projPaths = path((p) => p.projected);

  const stroke = (d: string, dashed: boolean) =>
    `<path d="${d}" fill="none" stroke="${color}" stroke-width="1.75" ` +
    `stroke-linecap="round" stroke-linejoin="round"${
      dashed ? ' stroke-dasharray="2.5 2.5" opacity=".75"' : ""
    }/>`;

  const marks =
    actualPaths.map((d) => stroke(d, false)).join("") +
    (bridge ? stroke(bridge, true) : "") +
    projPaths.map((d) => stroke(d, true)).join("");

  // A single point has no line, so give it a dot rather than nothing.
  const only = points.filter((p) => p.actual != null || p.projected != null);
  const dot =
    only.length === 1
      ? `<circle cx="${x(only[0]!.week).toFixed(1)}" cy="${y(
          (only[0]!.actual ?? only[0]!.projected)!,
        ).toFixed(1)}" r="2.25" fill="${color}"${opts.muted ? ' opacity=".8"' : ""}/>`
      : "";

  if (!marks && !dot) return `<span class="faint">—</span>`;

  return (
    `<svg class="spark" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" ` +
    `aria-hidden="true" focusable="false">${marks}${dot}</svg>`
  );
}

/**
 * Compact sparkline for a single series — no axes, sized to sit in a row.
 */
export function sparkline(values: number[], color = "var(--accent)"): string {
  if (values.length < 2) return "";
  const w = 64;
  const h = 18;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;

  const d = values
    .map((v, i) => {
      const x = (w * i) / (values.length - 1);
      const y = h - 2 - ((v - min) / span) * (h - 4);
      return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");

  return `<svg class="chart" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" aria-hidden="true"><path d="${d}" fill="none" stroke="${color}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
}
