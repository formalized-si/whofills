import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { join } from "node:path";
import { complementaryPair } from "../packages/whofills/src/attest.ts";

const dir = "packages/whofills/src";
const src = readdirSync(dir)
  .filter((f) => /\.tsx?$/.test(f))
  .map((f) => ({ f, s: readFileSync(join(dir, f), "utf8") }));

describe("rules we publish", () => {
  it("the browser code never branches on user agent or IP: crawlers get what people get", () => {
    for (const { f, s } of src) {
      expect(s, f).not.toMatch(/userAgent|\bappVersion\b|Googlebot|bingbot|navigator\.platform/i);
    }
  });
  it("the browser code never probes extensions or assistive technology", () => {
    for (const { f, s } of src) expect(s, f).not.toMatch(/chrome-extension:|speechSynthesis|moz-extension:/);
  });
  it("key identities are never recorded", () => {
    const sensor = src.find((x) => x.f === "sensor.ts")!.s;
    expect(sensor).not.toMatch(/\.key\b|\.code\b|\.value\b|keyCode/);
  });
  it("the sensor listens passively, so it cannot delay input", () => {
    const sensor = src.find((x) => x.f === "sensor.ts")!.s;
    expect(sensor).toContain("passive: true");
    expect(sensor).not.toMatch(/preventDefault|stopPropagation/);
  });
  it("bundle stays small", () => {
    const b = readFileSync("packages/whofills/dist/whofills.js");
    expect(gzipSync(b).length).toBeLessThan(6000);
  });
});

describe("complementary frames", () => {
  const lin = (v: number) => {
    const c = v / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  it("average to the surface in linear light, within one code value", () => {
    for (const surface of [
      [239, 238, 234],
      [200, 200, 200],
      [122, 80, 90],
    ])
      for (const d of [8, 12, 16, 20]) {
        const { hi, lo } = complementaryPair(surface, d);
        surface.forEach((v, i) => {
          const mean = (lin(hi[i]) + lin(lo[i])) / 2;
          const oneUp = lin(Math.min(255, v + 1)) - lin(v);
          expect(Math.abs(mean - lin(v))).toBeLessThanOrEqual(oneUp * 1.01);
        });
      }
  });
  it("the default row leaves enough head room", () => {
    const { hi, lo } = complementaryPair([239, 238, 234], 20);
    expect(hi.every((v) => v <= 255)).toBe(true);
    expect(hi[0] - lo[0]).toBeGreaterThanOrEqual(30);
  });
});
