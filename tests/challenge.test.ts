import { describe, it, expect } from "vitest";
import { maskFor, MotionField } from "../packages/whofills/src/challenge.ts";

function lcg(seed: number) {
  let s = seed >>> 0;
  return () => (s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32;
}

describe("motion-defined digits", () => {
  const cols = 120,
    rows = 36;
  const mask = maskFor("48215", cols, rows);
  it("draws every digit", () => {
    expect(mask.reduce((a, b) => a + b, 0)).toBeGreaterThan(300);
  });
  it("a single frame carries no glyph signal: inside and outside the mask have the same statistics", () => {
    const f = new MotionField(cols, rows, mask, lcg(7));
    const buf = new Uint8Array(cols * rows);
    let worst = 0;
    for (let frame = 0; frame < 40; frame++) {
      f.sample(buf);
      f.step();
      let inside = 0,
        inN = 0,
        outside = 0,
        outN = 0,
        edgeSame = 0,
        edgeN = 0;
      for (let i = 0; i < buf.length; i++) {
        if (mask[i]) {
          inside += buf[i];
          inN++;
        } else {
          outside += buf[i];
          outN++;
        }
      }
      for (let y = 0; y < rows; y++)
        for (let x = 1; x < cols; x++) {
          const i = y * cols + x;
          if (mask[i] !== mask[i - 1]) {
            edgeSame += buf[i] === buf[i - 1] ? 1 : 0;
            edgeN++;
          }
        }
      const gap = Math.abs(inside / inN - outside / outN);
      worst = Math.max(worst, gap);
      expect(Math.abs(edgeSame / edgeN - 0.5)).toBeLessThan(0.12); // the glyph edge is not a visible contour
    }
    expect(worst).toBeLessThan(0.08);
  });
  it("motion does carry the signal: temporal correlation at the right shift separates glyph from ground", () => {
    const f = new MotionField(cols, rows, mask, lcg(9));
    const a = new Uint8Array(cols * rows),
      b = new Uint8Array(cols * rows);
    f.sample(a);
    f.step();
    f.sample(b);
    let correct = 0;
    let total = 0;
    for (let y = 2; y < rows - 2; y++)
      for (let x = 0; x < cols; x++) {
        const i = y * cols + x;
        const down = a[((y - 1 + rows) % rows) * cols + x] === b[i];
        const up = a[((y + 1) % rows) * cols + x] === b[i];
        if (down === up) continue;
        total++;
        if ((down ? 1 : 0) === mask[i]) correct++;
      }
    expect(correct / total).toBeGreaterThan(0.9);
  });
});
