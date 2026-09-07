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

/**
 * Horizontal bar comparing a value against a reference, drawn inside a table
 * cell. Used for positional contribution vs the league average.
 */
export function barCell(value: number, max: number, bad = false): string {
  const width = max <= 0 ? 0 : Math.max(0, Math.min(100, (value / max) * 100));
  return `<span class="bar${bad ? " is-bad" : ""}"><i style="width:${width.toFixed(1)}%"></i></span>`;
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
