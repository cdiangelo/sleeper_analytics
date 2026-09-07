/** Formatting and safe HTML assembly. Views build strings, so escaping is not optional. */

const ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

/** Escape interpolated text. Player and team names come from user input. */
export function esc(value: unknown): string {
  return String(value ?? "").replace(/[&<>"']/g, (c) => ESCAPES[c] ?? c);
}

/** Tagged template that escapes every interpolation. */
export function html(strings: TemplateStringsArray, ...values: unknown[]): string {
  return strings.reduce(
    (acc, str, i) => acc + str + (i < values.length ? esc(values[i]) : ""),
    "",
  );
}

/** Interpolate pre-built markup without escaping it. */
export function raw(markup: string): { __html: string } {
  return { __html: markup };
}

/** Join markup fragments produced by map(). */
export function join(parts: string[]): string {
  return parts.join("");
}

export function num(value: number, digits = 1): string {
  if (!Number.isFinite(value)) return "—";
  return value.toFixed(digits);
}

export function signed(value: number, digits = 1): string {
  if (!Number.isFinite(value)) return "—";
  return `${value > 0 ? "+" : value < 0 ? "−" : ""}${Math.abs(value).toFixed(digits)}`;
}

export function pct(value: number, digits = 0): string {
  if (!Number.isFinite(value)) return "—";
  return `${(value * 100).toFixed(digits)}%`;
}

export function signedPct(value: number, digits = 0): string {
  if (!Number.isFinite(value)) return "—";
  const sign = value > 0 ? "+" : value < 0 ? "−" : "";
  return `${sign}${(Math.abs(value) * 100).toFixed(digits)}%`;
}

export function record(r: { wins: number; losses: number; ties: number }): string {
  return r.ties > 0 ? `${r.wins}-${r.losses}-${r.ties}` : `${r.wins}-${r.losses}`;
}

/** Positive is good by default; pass invert for metrics where lower is better. */
export function toneClass(value: number, invert = false): string {
  if (Math.abs(value) < 1e-9) return "dim";
  return (invert ? -value : value) > 0 ? "good" : "bad";
}

export function ordinal(n: number): string {
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${n}th`;
  return `${n}${["th", "st", "nd", "rd"][n % 10] ?? "th"}`;
}

/** Sleeper's injury codes, shortened for a 380px column. */
export function injuryTag(status: string | null): string {
  if (!status) return "";
  const short: Record<string, string> = {
    Questionable: "Q",
    Doubtful: "D",
    Out: "OUT",
    IR: "IR",
    PUP: "PUP",
    Sus: "SUS",
    COV: "COV",
    NA: "NA",
    "Injured Reserve": "IR",
  };
  const tag = short[status] ?? status.slice(0, 3).toUpperCase();
  return `<span class="injury" title="${esc(status)}">${esc(tag)}</span>`;
}

export function posTag(position: string | null | undefined): string {
  const p = position ?? "—";
  return `<span class="pos" data-pos="${esc(p)}">${esc(p)}</span>`;
}
