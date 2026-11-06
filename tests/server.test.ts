import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { createGuard, parseToken, stripGuardFields } from "../packages/whofills/src/server/index.ts";
import type { Features } from "../packages/whofills/src/features.ts";

const f = (over: Partial<Features> = {}): Features => ({
  n: { clicks: 0, moves: 0, keys: 0, inputs: 0, touches: 0 },
  centreClicks: 0,
  teleportClicks: 0,
  pressMs: null,
  ghostChars: 0,
  totalChars: 0,
  pasteChars: 0,
  keyGapMs: null,
  keyGapCv: null,
  actionGapS: null,
  untrusted: 0,
  durationS: 10,
  ...over,
});
const tok = (fe: Features, wd = false) => Buffer.from(JSON.stringify({ v: 1, f: fe, wd })).toString("base64url");
const agentF = f({
  n: { clicks: 4, moves: 4, keys: 0, inputs: 8, touches: 0 },
  centreClicks: 4,
  teleportClicks: 4,
  pressMs: 0.3,
  ghostChars: 300,
  totalChars: 300,
});
const humanF = f({
  n: { clicks: 4, moves: 200, keys: 300, inputs: 300, touches: 0 },
  centreClicks: 0,
  teleportClicks: 0,
  pressMs: 90,
  totalChars: 300,
  keyGapMs: 180,
  keyGapCv: 0.7,
});
const guard = createGuard({ secret: "s".repeat(32), mode: "hold" });

describe("guard", () => {
  it("passes people and holds agents", () => {
    expect(guard.check("/a", { __wf: tok(humanF) }).action).toBe("pass");
    expect(guard.check("/a", { __wf: tok(agentF) }).action).toBe("hold");
  });
  it("tag mode, the default, never holds", () => {
    const g = createGuard({ secret: "s".repeat(32) });
    const d = g.check("/a", { __wf: tok(agentF) });
    expect(d.action).toBe("pass");
    expect(d.verdict?.verdict).toBe("agent");
  });
  it("fails open when the script did not load, unless the owner asks otherwise", () => {
    expect(guard.check("/a", {}).action).toBe("pass");
    expect(guard.check("/a", { __wf: "garbage" }).action).toBe("pass");
    const strict = createGuard({ secret: "s".repeat(32), mode: "hold", holdMissing: true });
    expect(strict.check("/a", {}).action).toBe("hold");
  });
  it("a retry after a hold stays held, however clean its signals look", () => {
    const retry = Buffer.from(JSON.stringify({ v: 1, f: humanF, wd: false, h: true })).toString("base64url");
    expect(guard.check("/a", { __wf: retry }).action).toBe("hold");
    expect(createGuard({ secret: "s".repeat(32) }).check("/a", { __wf: retry }).action).toBe("pass");
  });
  it("declaration: an agent that says it is one is held, a person passes, and the answer is reported", () => {
    const decl = Buffer.from(JSON.stringify({ v: 1, f: humanF, wd: false, d: true })).toString("base64url");
    const agent = guard.check("/a", { __wf: decl, wf_declared: "agent" });
    expect(agent).toMatchObject({ action: "hold", declared: "agent" });
    if (agent.action === "hold") expect(agent.html).toMatch(/marked as filled in by an AI agent/);
    expect(guard.check("/a", { __wf: decl, wf_declared: "self" })).toMatchObject({ action: "pass", declared: "self" });
    expect(guard.check("/a", { __wf: decl }).action).toBe("hold");
    expect(createGuard({ secret: "s".repeat(32) }).check("/a", { __wf: decl, wf_declared: "agent" })).toMatchObject({
      action: "pass",
      declared: "agent",
    });
    expect(stripGuardFields({ a: 1, wf_declared: "agent" })).toEqual({ a: 1 });
  });
  it("a form set up with the attestation does not pass without it", () => {
    const owed = Buffer.from(JSON.stringify({ v: 1, f: humanF, wd: false, a: true })).toString("base64url");
    expect(guard.check("/a", { __wf: owed }).action).toBe("hold");
    expect(guard.check("/a", { __wf: owed, wf_attest: "1" })).toMatchObject({ action: "pass", attested: true });
  });
  it("a wrong answer or a forged ticket does not pass", () => {
    const c = guard.issue();
    expect(guard.solved(c.ticket, c.code === "00000" ? "11111" : "00000")).toBe(false);
    expect(guard.solved("1.2.3", c.code)).toBe(false);
    expect(guard.solved(undefined, c.code)).toBe(false);
    expect(guard.check("/a", { __wf: tok(agentF), __wf_ticket: c.ticket, __wf_answer: "00000" }).action).toBe("hold");
  });
  it("the right answer passes the same submission, once", () => {
    const g = createGuard({ secret: "s".repeat(32), mode: "hold" });
    const fields = { name: "Ada", __wf: tok(agentF) };
    const c = g.issue("/a", { name: "Ada", __wf: fields.__wf });
    const replay = { ...fields, __wf_ticket: c.ticket, __wf_answer: c.code };
    expect(g.check("/a", replay).action).toBe("pass");
    expect(g.check("/a", replay).action).toBe("hold");
  });
  it("a solve does not transfer to other answers or another path", () => {
    const g = createGuard({ secret: "s".repeat(32), mode: "hold" });
    const c = g.issue("/a", { name: "Ada" });
    expect(g.check("/a", { name: "Eve", __wf_ticket: c.ticket, __wf_answer: c.code }).action).toBe("hold");
    expect(g.check("/b", { name: "Ada", __wf_ticket: c.ticket, __wf_answer: c.code }).action).toBe("hold");
    expect(g.check("/a", { name: "Ada", __wf_ticket: c.ticket, __wf_answer: c.code }).action).toBe("pass");
  });
  it("an expired ticket does not pass, even with the right answer", () => {
    const g = createGuard({ secret: "x".repeat(32), ttl: -1, mode: "hold" });
    const c = g.issue();
    expect(g.solved(c.ticket, c.code)).toBe(false);
  });
  it("tickets do not transfer between secrets", () => {
    const a = createGuard({ secret: "a".repeat(32) }),
      b = createGuard({ secret: "b".repeat(32) });
    const c = a.issue();
    expect(b.solved(c.ticket, c.code)).toBe(false);
  });
  it("refuses to start without a real secret, instead of failing at the first hold", () => {
    expect(() => createGuard({} as any)).toThrow(/secret/);
    expect(() => createGuard({ secret: "short" })).toThrow(/secret/);
  });
  it("the hold page carries noise frames and neither the digits nor their mask", async () => {
    const { maskFor } = await import("../packages/whofills/src/challenge.ts");
    const c = guard.issue();
    const html = guard.holdPage("/a", { a: "1" }, false);
    expect(html).not.toContain("data-mask");
    const raw = Buffer.from(c.frames, "base64");
    const cells = c.cols * c.rows;
    const stride = Math.ceil(cells / 8);
    expect(raw.length).toBe(stride * c.rows);
    const mask = maskFor(c.code, c.cols, c.rows);
    for (let f = 0; f < c.rows; f++) {
      let inside = 0,
        inN = 0,
        outside = 0,
        outN = 0;
      for (let i = 0; i < cells; i++) {
        const b = (raw[f * stride + (i >> 3)] >> (i & 7)) & 1;
        if (mask[i]) {
          inside += b;
          inN++;
        } else {
          outside += b;
          outN++;
        }
      }
      expect(Math.abs(inside / inN - outside / outN)).toBeLessThan(0.1);
    }
  });
  it("holds with any field type, without throwing", () => {
    for (const a of [["1", "2"], 5, true, null, { x: 1 }])
      expect(guard.check("/a", { a, __wf: tok(agentF) }).action).toBe("hold");
  });
  it("repeated fields survive, as a list", async () => {
    const r = await guard.fetch(
      new Request("https://x.example/a", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: "c=1&c=2&c=3",
      }),
    );
    expect("fields" in r && r.fields.c).toEqual(["1", "2", "3"]);
    expect(guard.holdPage("/a", { c: ["1", "2"] }, false).match(/name="c"/g)?.length).toBe(2);
  });
  it("JSON bodies are checked, and a held one gets a 428 the client can show", async () => {
    const r = await guard.fetch(
      new Request("https://x.example/a", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ a: "1", __wf: tok(agentF) }),
      }),
    );
    expect("response" in r && r.response.status).toBe(428);
    const body = "response" in r ? await r.response.json() : null;
    expect(body.whofills).toBe("hold");
    expect(body.html).toContain("One more step");
  });
  it("multipart: checked without a file, and with a file passes marked unheld", async () => {
    const fd = new FormData();
    fd.set("a", "1");
    fd.set("__wf", tok(agentF));
    const held = await guard.fetch(new Request("https://x.example/a", { method: "POST", body: fd }));
    expect("response" in held).toBe(true);
    fd.set("cv", new File(["x"], "cv.pdf"));
    const pass = await guard.fetch(new Request("https://x.example/a", { method: "POST", body: fd }));
    expect("fields" in pass && pass.unheld).toBe(true);
    expect("fields" in pass && pass.verdict?.verdict).toBe("agent");
  });
  it("the attestation is reported, on the plain path and after a solved hold", () => {
    expect(guard.check("/a", { wf_attest: "1" })).toMatchObject({ action: "pass", attested: true });
    expect(guard.check("/a", {})).toMatchObject({ action: "pass", attested: false });
    const g = createGuard({ secret: "s".repeat(32), mode: "hold" });
    const f = { wf_attest: "1", a: "1" };
    const c = g.issue("/a", f);
    expect(g.check("/a", { ...f, __wf_ticket: c.ticket, __wf_answer: c.code })).toMatchObject({
      action: "pass",
      attested: true,
      passed: true,
    });
  });
  it("the hold page keeps every field, escaped, and never leaks the answer", () => {
    fc.assert(
      fc.property(
        fc.dictionary(
          fc.string({ minLength: 1, maxLength: 8 }).filter((k) => /^[a-z]+$/.test(k) && !k.startsWith("__wf")),
          fc.string({ maxLength: 40 }),
        ),
        (fields) => {
          const html = guard.holdPage("/a", fields, false);
          for (const [k] of Object.entries(fields)) expect(html).toContain(`name="${k}"`);
          expect(/<script[^>]*>[^<]*alert/.test(html)).toBe(false);
        },
      ),
    );
    const html = guard.holdPage("/a", { name: `"><script>alert(1)</script>` }, false);
    expect(html).not.toContain("<script>alert");
  });
  it("token parsing never throws on hostile input", () => {
    fc.assert(
      fc.property(fc.string(), (s) => {
        parseToken(s);
        parseToken(Buffer.from(s).toString("base64url"));
      }),
    );
  });
  it("guard fields never reach the application", () => {
    expect(stripGuardFields({ a: "1", __wf: "x", __wf_ticket: "y", __wf_answer: "z", wf_attest: "1" })).toEqual({
      a: "1",
    });
  });
  it("web-standard handler returns fields or a held Response", async () => {
    const pass = await guard.fetch(
      new Request("https://x.example/a", { method: "POST", body: new URLSearchParams({ a: "1", __wf: tok(humanF) }) }),
    );
    expect("fields" in pass && pass.fields).toEqual({ a: "1" });
    const held = await guard.fetch(
      new Request("https://x.example/a", { method: "POST", body: new URLSearchParams({ __wf: tok(agentF) }) }),
    );
    expect("response" in held && (await held.response.text()).includes("One more step")).toBe(true);
  });
  it("express middleware passes clean bodies on and answers holds itself", () => {
    const mw = guard.express();
    let nexted = false;
    const req: any = { body: { a: "1", __wf: tok(humanF) }, url: "/a" };
    mw(req, {}, () => {
      nexted = true;
    });
    expect(nexted).toBe(true);
    expect(req.body).toEqual({ a: "1" });
    expect(req.whofills.verdict.verdict).toBe("human");
    let sent = "";
    const res: any = {
      status() {
        return this;
      },
      type() {
        return this;
      },
      send(b: string) {
        sent = b;
      },
    };
    nexted = false;
    mw({ body: { __wf: tok(agentF) }, url: "/a" }, res, () => {
      nexted = true;
    });
    expect(nexted).toBe(false);
    expect(sent).toContain("One more step");
  });
});
