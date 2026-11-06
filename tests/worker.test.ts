// Checks the Worker's request flow with fetch and HTMLRewriter stubbed, since the example has to keep working as written.
import { describe, it, expect, vi, beforeEach } from "vitest";
vi.mock("whofills/server", async () => await import("../packages/whofills/src/server/index.ts"));
vi.mock("whofills/whofills.js", () => ({ default: "client-bundle" }));
vi.mock("whofills/hold.js", () => ({ default: "hold-bundle" }));

const env = { WHOFILLS_SECRET: "s".repeat(32), WHOFILLS_MODE: "hold" };
const agent = Buffer.from(
  JSON.stringify({
    v: 1,
    wd: false,
    f: {
      n: { clicks: 4, moves: 4, keys: 0, inputs: 8, touches: 0 },
      centreClicks: 4,
      teleportClicks: 4,
      pressMs: 0.3,
      ghostChars: 300,
      totalChars: 300,
      pasteChars: 0,
      keyGapMs: null,
      keyGapCv: null,
      actionGapS: 1,
      untrusted: 0,
      durationS: 9,
    },
  }),
).toString("base64url");
let upstream: Request[] = [];
beforeEach(() => {
  upstream = [];
  vi.stubGlobal("fetch", async (r: Request) => {
    upstream.push(r);
    return new Response("<html><body>ok</body></html>", { headers: { "content-type": "text/html" } });
  });
  vi.stubGlobal(
    "HTMLRewriter",
    class {
      on() {
        return this;
      }
      transform(r: Response) {
        return r;
      }
    },
  );
});

describe("cloudflare worker example", () => {
  it("serves the bundles", async () => {
    const { default: w } = await import("../examples/cloudflare-worker/worker.js");
    expect(await (await w.fetch(new Request("https://x.example/whofills.js"), env)).text()).toBe("client-bundle");
    expect(await (await w.fetch(new Request("https://x.example/__wf/hold.js"), env)).text()).toBe("hold-bundle");
  });
  it("holds an agent POST and never reaches the origin", async () => {
    const { default: w } = await import("../examples/cloudflare-worker/worker.js");
    const res = await w.fetch(
      new Request("https://x.example/apply", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ name: "a", __wf: agent }),
      }),
      env,
    );
    expect(await res.text()).toContain("One more step");
    expect(upstream.length).toBe(0);
  });
  it("forwards a clean POST with the verdict in a header", async () => {
    const { default: w } = await import("../examples/cloudflare-worker/worker.js");
    await w.fetch(
      new Request("https://x.example/apply", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ name: "a" }),
      }),
      env,
    );
    expect(upstream.length).toBe(1);
    expect(upstream[0].headers.get("x-agent-verdict")).toBe("none");
    expect(await upstream[0].text()).toBe("name=a");
  });
  it("leaves unprotected paths alone", async () => {
    const { default: w } = await import("../examples/cloudflare-worker/worker.js");
    const res = await w.fetch(new Request("https://x.example/about"), env);
    expect(await res.text()).toContain("ok");
  });
});
