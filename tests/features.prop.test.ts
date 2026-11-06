/**
 * Properties a detector must hold whatever a person's input looks like. Each generator describes a way
 * real people use a form. These are models of those populations, not recordings of them.
 */
import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { extract, score, type RawEvent } from "../packages/whofills/src/features.ts";

const seq = (parts: RawEvent[][]) => parts.flat().sort((a, b) => a.t - b.t);

/** Typing with human-like inter-key timing, from fast typists to slow one-finger typists. */
const typing = (start: number, n: number, base: number, jitter: number[]): RawEvent[] => {
  let t = start;
  const out: RawEvent[] = [];
  for (let i = 0; i < n; i++) {
    t += base * (0.45 + jitter[i % jitter.length] * 1.4);
    out.push({ k: "kd", t, tr: true });
    out.push({ k: "input", t: t + 2, tr: true, it: "insertText", len: 1 });
    out.push({ k: "ku", t: t + 70, tr: true });
  }
  return out;
};
const jitterArb = fc.array(fc.double({ min: 0, max: 1, noNaN: true }), { minLength: 8, maxLength: 24 }).filter((a) => {
  const m = a.reduce((x, y) => x + y) / a.length;
  return Math.sqrt(a.reduce((x, y) => x + (y - m) ** 2, 0) / a.length) > 0.12;
});

/** Mouse use with a travel path before each click, off-centre. */
const pointerClick = (t: number, off: number, press: number, w = 400, h = 40): RawEvent[] => {
  const out: RawEvent[] = [];
  for (let i = 0; i < 12; i++) out.push({ k: "move", t: t - 300 + i * 25, tr: true });
  out.push({ k: "down", t, x: 0, y: 0, tr: true });
  out.push({ k: "up", t: t + press, x: 0, y: 0, tr: true });
  out.push({ k: "click", t: t + press, x: 0, y: 0, tr: true, off, w, h, d: 1 });
  return out;
};

const notAgent = (ev: RawEvent[], env = {}) => expect(score(extract(ev), env).verdict).not.toBe("agent");

describe("people the detector must never call an agent", () => {
  it("mouse and keyboard users, at any speed", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 2, max: 8 }),
        fc.integer({ min: 60, max: 600 }),
        jitterArb,
        fc.double({ min: 3, max: 200, noNaN: true }),
        fc.integer({ min: 40, max: 200 }),
        (clicks, base, j, off, press) => {
          const parts: RawEvent[][] = [];
          let t = 1000;
          for (let i = 0; i < clicks; i++) {
            parts.push(pointerClick(t, off, press));
            t += 400;
            parts.push(typing(t, 30, base, j));
            t += 30 * base * 2;
          }
          notAgent(seq(parts));
        },
      ),
      { numRuns: 300 },
    );
  });
  it("keyboard-only users: no pointer at all, tabbing between fields", () => {
    fc.assert(
      fc.property(fc.integer({ min: 2, max: 10 }), fc.integer({ min: 70, max: 500 }), jitterArb, (fields, base, j) => {
        const parts: RawEvent[][] = [];
        let t = 500;
        for (let i = 0; i < fields; i++) {
          parts.push(typing(t, 25, base, j));
          t += 25 * base * 2;
          parts.push([
            { k: "kd", t, tr: true },
            { k: "focus", t: t + 1, tr: true },
          ]);
          t += 200;
        }
        notAgent(seq(parts));
      }),
      { numRuns: 300 },
    );
  });
  it("screen readers and switch access: synthetic clicks at the exact centre with detail=0", () => {
    fc.assert(
      fc.property(fc.integer({ min: 2, max: 30 }), fc.integer({ min: 300, max: 5000 }), (n, gap) => {
        const ev: RawEvent[] = [];
        for (let i = 0; i < n; i++)
          ev.push({ k: "click", t: 100 + i * gap, x: 0, y: 0, tr: true, off: 0, w: 400, h: 40, d: 0 });
        notAgent(ev);
      }),
    );
  });
  it("voice control: exact-centre clicks with zero press and dictated text, without ever reaching agent on the pointer signals alone", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 2, max: 20 }),
        fc.integer({ min: 800, max: 6000 }),
        fc.integer({ min: 10, max: 200 }),
        (n, gap, len) => {
          const parts: RawEvent[][] = [];
          for (let i = 0; i < n; i++) {
            const t = 100 + i * gap;
            parts.push([
              { k: "down", t, x: 0, y: 0, tr: true },
              { k: "up", t: t + 1, x: 0, y: 0, tr: true },
              { k: "click", t: t + 1, x: 0, y: 0, tr: true, off: 0, w: 400, h: 40, d: 1 },
            ]);
            parts.push([{ k: "input", t: t + 500, tr: true, it: "insertReplacementText", len }]);
          }
          const r = score(extract(seq(parts)));
          expect(r.signals).not.toContain("ghost-typing");
        },
      ),
    );
  });
  it("screen readers that synthesise a real mouse click at the centre (measured for NVDA), with normal typing", () => {
    fc.assert(
      fc.property(fc.integer({ min: 2, max: 20 }), fc.integer({ min: 70, max: 400 }), jitterArb, (n, base, j) => {
        const parts: RawEvent[][] = [];
        let t = 300;
        for (let i = 0; i < n; i++) {
          parts.push([
            { k: "down", t, x: 0, y: 0, tr: true },
            { k: "up", t: t + 0.5, x: 0, y: 0, tr: true },
            { k: "click", t: t + 0.5, x: 0, y: 0, tr: true, off: 0, w: 400, h: 40, d: 1 },
          ]);
          t += 300;
          parts.push(typing(t, 24, base, j));
          t += 24 * base * 2;
        }
        notAgent(seq(parts));
      }),
      { numRuns: 200 },
    );
  });
  it("mobile dictation and virtual keyboards: text with no key events, on touch", () => {
    fc.assert(
      fc.property(fc.integer({ min: 2, max: 12 }), fc.integer({ min: 15, max: 200 }), (n, len) => {
        const parts: RawEvent[][] = [];
        for (let i = 0; i < n; i++) {
          const t = 200 + i * 2000;
          parts.push([
            { k: "touch", t, tr: true },
            { k: "click", t: t + 90, x: 0, y: 0, tr: true, off: 20, w: 300, h: 44, d: 1 },
            { k: "input", t: t + 800, tr: true, it: "insertText", len },
          ]);
        }
        notAgent(seq(parts));
      }),
    );
  });
  it("autofill and password managers: instant values with no keys", () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 12 }), fc.integer({ min: 5, max: 40 }), (fields, len) => {
        const parts: RawEvent[][] = [pointerClick(500, 30, 90)];
        for (let i = 0; i < fields; i++)
          parts.push([{ k: "input", t: 900 + i, tr: true, it: "insertReplacementText", len }]);
        notAgent(seq(parts));
      }),
    );
  });
  it("people who paste a prepared statement", () => {
    fc.assert(
      fc.property(fc.integer({ min: 100, max: 5000 }), (len) => {
        notAgent(
          seq([
            pointerClick(500, 40, 100),
            [
              { k: "paste", t: 900, tr: true },
              { k: "input", t: 901, tr: true, it: "insertFromPaste", len },
            ],
          ]),
        );
      }),
    );
  });
  it("IME composition users", () => {
    fc.assert(
      fc.property(fc.integer({ min: 20, max: 300 }), (len) => {
        const ev: RawEvent[] = [{ k: "compose", t: 10, tr: true }];
        for (let i = 0; i < len; i++)
          ev.push({ k: "input", t: 20 + i * 200, tr: true, it: "insertCompositionText", len: 2 });
        notAgent(ev);
      }),
    );
  });
  it("no population's text input may count as ghost typing on its own, or a pointer signal could tip it over", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 15, max: 5000 }),
        fc.constantFrom("insertFromPaste", "insertFromDrop", "insertCompositionText", "insertReplacementText"),
        (len, it) => {
          const r = score(extract([{ k: "input", t: 900, tr: true, it, len }]));
          expect(r.signals).not.toContain("ghost-typing");
        },
      ),
    );
  });
  it("a screen reader user who pastes a prepared answer: both unusual, and still a person", () => {
    fc.assert(
      fc.property(fc.integer({ min: 2, max: 12 }), fc.integer({ min: 100, max: 3000 }), (n, len) => {
        const parts: RawEvent[][] = [];
        for (let i = 0; i < n; i++) {
          const t = 300 + i * 2500;
          parts.push([
            { k: "down", t, x: 0, y: 0, tr: true },
            { k: "up", t: t + 0.5, x: 0, y: 0, tr: true },
            { k: "click", t: t + 0.5, x: 0, y: 0, tr: true, off: 0, w: 400, h: 40, d: 1 },
            { k: "paste", t: t + 700, tr: true },
            { k: "input", t: t + 701, tr: true, it: "insertFromPaste", len },
          ]);
        }
        notAgent(seq(parts));
      }),
    );
  });
  it("touch users: taps have no path and no press time", () => {
    fc.assert(
      fc.property(fc.integer({ min: 2, max: 20 }), fc.double({ min: 0, max: 60, noNaN: true }), (n, off) => {
        const parts: RawEvent[][] = [];
        for (let i = 0; i < n; i++) {
          const t = 200 + i * 900;
          parts.push([
            { k: "touch", t, tr: true },
            { k: "down", t: t + 80, x: 0, y: 0, tr: true },
            { k: "up", t: t + 80, x: 0, y: 0, tr: true },
            { k: "click", t: t + 80, x: 0, y: 0, tr: true, off, w: 350, h: 44, d: 1 },
          ]);
        }
        notAgent(seq(parts));
      }),
    );
  });
  it("tap-to-click trackpads: zero press time alone is not enough", () => {
    fc.assert(
      fc.property(fc.integer({ min: 2, max: 20 }), fc.double({ min: 3, max: 120, noNaN: true }), (n, off) => {
        const parts: RawEvent[][] = [];
        for (let i = 0; i < n; i++) parts.push(pointerClick(1000 + i * 1500, off, 0));
        notAgent(seq(parts));
      }),
    );
  });
});

describe("keyboard and assistive-tech clicks carry no pointer signal", () => {
  it("clicks with detail=0 never count towards the pointer signals", () => {
    const ev: RawEvent[] = [];
    for (let i = 0; i < 6; i++)
      ev.push({ k: "click", t: 100 + i * 800, x: 0, y: 0, tr: true, off: 0, w: 400, h: 40, d: 0 });
    const f = extract(ev);
    expect(f.centreClicks).toBe(0);
    expect(f.teleportClicks).toBe(0);
  });
});

describe("agent behaviour stays detectable", () => {
  it("screenshot agents: one cursor jump per click, keys at a machine's pace", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 3, max: 12 }),
        fc.double({ min: 5, max: 200, noNaN: true }),
        fc.double({ min: 2, max: 25, noNaN: true }),
        (n, off, gap) => {
          const parts: RawEvent[][] = [];
          let t = 1000;
          for (let i = 0; i < n; i++) {
            parts.push([
              { k: "move", t, tr: true },
              { k: "down", t: t + 40, x: 0, y: 0, tr: true },
              { k: "up", t: t + 70, x: 0, y: 0, tr: true },
              { k: "click", t: t + 70, x: 0, y: 0, tr: true, off, w: 400, h: 40, d: 1 },
            ]);
            for (let c = 0; c < 20; c++) {
              const at = t + 2000 + c * gap;
              parts.push([
                { k: "kd", t: at, tr: true },
                { k: "input", t: at + 1, tr: true, it: "insertText", len: 1 },
              ]);
            }
            t += 5000;
          }
          const r = score(extract(seq(parts)));
          expect(r.signals).toContain("teleport-clicks");
          expect(r.verdict).toBe("agent");
        },
      ),
    );
  });
  it("DOM-driven agents (Playwright fill and click)", () => {
    fc.assert(
      fc.property(fc.integer({ min: 3, max: 12 }), fc.integer({ min: 15, max: 400 }), (n, len) => {
        const parts: RawEvent[][] = [];
        for (let i = 0; i < n; i++) {
          const t = 100 + i * 200;
          parts.push([{ k: "input", t, tr: true, it: "insertText", len }]);
        }
        parts.push([
          { k: "move", t: 5000, tr: true },
          { k: "down", t: 5001, x: 0, y: 0, tr: true },
          { k: "up", t: 5001.2, x: 0, y: 0, tr: true },
          { k: "click", t: 5001.2, x: 0, y: 0, tr: true, off: 0, w: 400, h: 40, d: 1 },
        ]);
        parts.push([
          { k: "move", t: 6000, tr: true },
          { k: "down", t: 6001, x: 0, y: 0, tr: true },
          { k: "up", t: 6001.2, x: 0, y: 0, tr: true },
          { k: "click", t: 6001.2, x: 0, y: 0, tr: true, off: 0, w: 120, h: 40, d: 1 },
        ]);
        expect(score(extract(seq(parts))).verdict).toBe("agent");
      }),
    );
  });
});
