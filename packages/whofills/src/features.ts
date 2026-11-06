/**
 * Pure feature extraction from a compact interaction stream.
 * Runs in the page and in tests. Nothing here keeps raw coordinates or key identities after it has
 * been summarised, so the token that leaves the browser holds aggregates, not a biometric trace.
 */
export type RawEvent =
  | { k: "move"; t: number; tr: boolean }
  | {
      k: "down" | "up" | "click";
      t: number;
      x: number;
      y: number;
      tr: boolean;
      off?: number;
      w?: number;
      h?: number;
      d?: number;
    }
  | { k: "kd" | "ku"; t: number; tr: boolean; nav?: boolean }
  | { k: "input"; t: number; tr: boolean; it: string; len: number }
  | { k: "focus" | "wheel" | "touch" | "compose" | "paste"; t: number; tr: boolean };

type PointerRecord = Extract<RawEvent, { k: "down" | "up" | "click" }>;

export interface Features {
  n: { clicks: number; moves: number; keys: number; inputs: number; touches: number };
  /** Clicks that hit within 1.5px of their target's exact centre (programmatic). */
  centreClicks: number;
  /** Trusted pointer clicks that had at most two pointer moves since the previous click: the cursor jumped rather than travelled. */
  teleportClicks: number;
  /** Median press duration in ms. */
  pressMs: number | null;
  /** Characters inserted with no keydown behind them, excluding paste and IME composition. */
  ghostChars: number;
  /** Characters inserted in total. */
  totalChars: number;
  /** Characters that came from paste. */
  pasteChars: number;
  /** Median gap between keydowns inside a burst, in ms. */
  keyGapMs: number | null;
  /** Coefficient of variation of the key gaps; humans are irregular. */
  keyGapCv: number | null;
  /** Median gap in seconds between discrete actions (a click or the start of a typing burst). */
  actionGapS: number | null;
  /** Untrusted (script-dispatched) events, excluding those a page's own widgets emit. */
  untrusted: number;
  durationS: number;
}

const median = (a: number[]) => {
  if (!a.length) return null;
  const s = [...a].sort((x, y) => x - y);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

export function extract(ev: RawEvent[]): Features {
  const clicks = ev.filter((e) => e.k === "click") as PointerRecord[];
  const moves = ev.filter((e) => e.k === "move");
  const kd = ev.filter((e) => e.k === "kd");
  const inputs = ev.filter((e) => e.k === "input") as Extract<RawEvent, { k: "input" }>[];
  const touches = ev.filter((e) => e.k === "touch");
  const downs = ev.filter((e) => e.k === "down") as PointerRecord[];
  const ups = ev.filter((e) => e.k === "up") as PointerRecord[];

  // detail=0 means the click came from the keyboard or from assistive tech: never treat those as pointer behaviour.
  const pointerClicks = clicks.filter((c) => (c.d ?? 1) > 0);
  // A checkbox is small enough for a person to hit dead centre, so only targets of some size count.
  const centreClicks = pointerClicks.filter(
    (c) => c.off !== undefined && c.off <= 1.5 && (c.w ?? 0) >= 24 && (c.h ?? 0) >= 24,
  ).length;
  let teleportClicks = 0;
  let prevClick = -Infinity;
  for (const c of pointerClicks) {
    const travelled = moves.filter((m) => m.t > prevClick && m.t <= c.t).length;
    if (c.tr && travelled <= 2) teleportClicks++;
    prevClick = c.t;
  }

  const press: number[] = [];
  for (const d of downs) {
    const u = ups.find((x) => x.t >= d.t);
    if (u) press.push(u.t - d.t);
  }

  let ghostChars = 0;
  let totalChars = 0;
  let pasteChars = 0;
  for (const i of inputs) {
    if (!i.len) continue;
    totalChars += i.len;
    if (i.it === "insertFromPaste" || i.it === "insertFromDrop") {
      pasteChars += i.len;
      continue;
    }
    if (i.it.startsWith("insertComposition") || i.it === "insertReplacementText") continue; // IME, autocorrect, autofill, dictation
    const typed = kd.some((k) => k.t <= i.t && i.t - k.t <= 80);
    if (!typed) ghostChars += i.len;
  }

  const gaps: number[] = [];
  for (let i = 1; i < kd.length; i++) {
    const g = kd[i].t - kd[i - 1].t;
    if (g < 1500) gaps.push(g);
  }
  const mg = median(gaps);
  let cv: number | null = null;
  if (gaps.length >= 8) {
    const mean = gaps.reduce((a, b) => a + b, 0) / gaps.length;
    const v = gaps.reduce((a, b) => a + (b - mean) ** 2, 0) / gaps.length;
    cv = mean > 0 ? Math.sqrt(v) / mean : 0;
  }

  const marks: number[] = [];
  let last = -1e9;
  for (const e of ev) {
    if (e.k === "click" || e.k === "input" || e.k === "kd") {
      if (e.t - last > 1000 || e.k === "click") marks.push(e.t);
      last = e.t;
    }
  }
  const actGaps: number[] = [];
  for (let i = 1; i < marks.length; i++) actGaps.push((marks[i] - marks[i - 1]) / 1000);

  return {
    n: { clicks: clicks.length, moves: moves.length, keys: kd.length, inputs: inputs.length, touches: touches.length },
    centreClicks,
    teleportClicks,
    pressMs: median(press),
    ghostChars,
    totalChars,
    pasteChars,
    keyGapMs: mg,
    keyGapCv: cv,
    actionGapS: median(actGaps),
    untrusted: ev.filter((e) => "tr" in e && !e.tr).length,
    durationS: ev.length ? (ev[ev.length - 1].t - ev[0].t) / 1000 : 0,
  };
}

export type Verdict = "human" | "unsure" | "agent";
export interface Scored {
  verdict: Verdict;
  score: number;
  signals: string[];
}

/**
 * Pointer signals correlate with each other and collide with screen readers and voice control, so as a
 * group they count once. "agent" needs agreement from two independent groups. The verdict is meant for a
 * harmless response (tag the submission, optional step-up), never for a silent block.
 */
export function score(f: Features, env: { webdriver?: boolean } = {}): Scored {
  const signals: string[] = [];
  const pc = f.n.clicks;
  const pointer: [string, number][] = [];
  if (f.centreClicks >= 2 && f.centreClicks / Math.max(1, pc) >= 0.6) pointer.push(["centre-clicks", 0.45]);
  if (pc >= 2 && f.teleportClicks / pc >= 0.8) pointer.push(["teleport-clicks", 0.45]);
  if (f.pressMs !== null && f.pressMs <= 8) pointer.push(["zero-press", 0.2]);
  if (f.n.moves === 0 && pc >= 2 && f.n.touches === 0) pointer.push(["no-pointer-path", 0.1]);
  const keyboard: [string, number][] = [];
  // Touch keyboards and dictation insert text with no key events, so ghost typing means nothing on touch.
  if (f.n.touches === 0 && f.totalChars >= 15 && f.ghostChars / f.totalChars >= 0.6)
    keyboard.push(["ghost-typing", 0.55]);
  if (f.keyGapMs !== null && f.keyGapCv !== null && f.keyGapMs < 25) keyboard.push(["machine-keys", 0.55]);
  else if (f.keyGapCv !== null && f.keyGapCv < 0.18) keyboard.push(["metronome-keys", 0.35]);
  const envw: [string, number][] = env.webdriver ? [["webdriver", 0.6]] : [];
  const groups = [pointer, keyboard, envw].filter((g) => g.length);
  let miss = 1;
  for (const g of groups) {
    miss *= 1 - Math.max(...g.map(([, w]) => w));
    for (const [n] of g) signals.push(n);
  }
  const total = 1 - miss;
  return {
    score: Math.round(total * 100) / 100,
    signals,
    verdict: groups.length >= 2 && total >= 0.6 ? "agent" : total >= 0.35 ? "unsure" : "human",
  };
}
