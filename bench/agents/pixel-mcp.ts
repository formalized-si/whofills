/**
 * A vision-only "computer use" tool: the model only ever gets downscaled screenshots
 * and acts through coordinates, the way Anthropic's computer tool and OpenAI's CUA do.
 * No DOM, no accessibility tree, no JS evaluation.
 */
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { chromium, type Page } from "playwright";
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const VIEW = { width: 1280, height: Number(process.env.VIEW_H ?? 800) };
const PERCEPTION = process.env.PERCEPTION ?? "image"; // image, text or both
const NO_SEE_LINE = process.env.NO_SEE_LINE === "1";
const SCALE = 1024 / 1280; // what the model sees; matches the documented downscale to WXGA-sized images
const hostRules = process.env.HOST_RULES ?? "";
const shotDir = process.env.SHOT_DIR ?? "";
const JPEG = process.env.SHOT_JPEG === "1";
if (shotDir) mkdirSync(shotDir, { recursive: true });

let page: Page | undefined;
let n = 0;
async function getPage() {
  if (page) return page;
  const browser = await chromium.launch({
    channel: "chrome",
    headless: true,
    args: [`--host-resolver-rules=${hostRules}`, "--ignore-certificate-errors"],
  });
  const ctx = await browser.newContext({ viewport: VIEW, ignoreHTTPSErrors: true, deviceScaleFactor: 1 });
  page = await ctx.newPage();
  return page;
}
async function shot() {
  const p = await getPage();
  await p.waitForTimeout(350);
  const png = await p.screenshot({ type: "png" });
  // Downscale through the browser's own canvas so that it behaves like the provider-side resample.
  const small = await p.context().newPage();
  const b64 = png.toString("base64");
  const out = await small.evaluate(
    async ({ b64, w, h, jpeg }) => {
      const img = new Image();
      img.src = "data:image/png;base64," + b64;
      await img.decode();
      const c = document.createElement("canvas");
      c.width = w;
      c.height = h;
      const g = c.getContext("2d")!;
      g.imageSmoothingQuality = "high";
      g.drawImage(img, 0, 0, w, h);
      // Claude in Chrome sends JPEG at quality 0.75; the computer tool sends PNG.
      return c.toDataURL(jpeg ? "image/jpeg" : "image/png", 0.75).split(",")[1];
    },
    { jpeg: JPEG, b64, w: Math.round(VIEW.width * SCALE), h: Math.round(VIEW.height * SCALE) },
  );
  await small.close();
  await p.bringToFront();
  if (shotDir)
    writeFileSync(
      join(shotDir, `s${String(n++).padStart(3, "0")}.${JPEG ? "jpg" : "png"}`),
      Buffer.from(out, "base64"),
    );
  return out;
}
const sc = (v: number) => Math.round(v / SCALE);

/** The page as text with screen coordinates: same actions as the image arm, different perception. */
async function describePage(p: Page) {
  return p.evaluate((scale) => {
    const out: string[] = [];
    const seen = new Set<Element>();
    for (const el of document.querySelectorAll("h1,h2,h3,p,label,legend,input,select,textarea,button,a")) {
      if (seen.has(el)) continue;
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height || r.bottom < 0 || r.top > innerHeight) continue;
      const i = el as HTMLInputElement;
      if (i.type === "hidden") continue;
      const tag = el.tagName.toLowerCase();
      if (tag === "label") el.querySelectorAll("input,select,textarea").forEach((c) => seen.add(c));
      const box = tag === "label" ? (el.querySelector("input") as HTMLInputElement | null) : null;
      const target = box ?? el;
      const t = target.getBoundingClientRect();
      const name = (el.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 240);
      const state =
        tag === "input" || tag === "textarea"
          ? ` value="${i.type === "checkbox" ? (i.checked ? "checked" : "unchecked") : i.value}"`
          : box
            ? ` ${box.checked ? "checked" : "unchecked"}`
            : "";
      out.push(
        `${tag}${box ? " with checkbox" : ""}${tag === "input" ? `[${i.type}]` : ""} "${name}"${state} at (${Math.round((t.left + t.width / 2) * scale)}, ${Math.round((t.top + t.height / 2) * scale)})`,
      );
    }
    return out.join("\n");
  }, SCALE);
}

const server = new Server({ name: "computer", version: "1.0.0" }, { capabilities: { tools: {} } });
server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "computer",
      description: `Use a mouse and keyboard to interact with a computer running a web browser, and take screenshots. The screen is ${Math.round(VIEW.width * SCALE)}x${Math.round(VIEW.height * SCALE)} pixels. Actions: screenshot, left_click(coordinate), double_click(coordinate), mouse_move(coordinate), type(text), key(text, e.g. "Return", "Tab", "ctrl+a"), scroll(coordinate, scroll_direction, scroll_amount), wait(duration), navigate(text=url; equivalent to typing a URL in the address bar). Each action returns ${PERCEPTION === "text" ? "a text description of the page with the screen coordinates of each element" : PERCEPTION === "both" ? "a new screenshot and a text description of the page with coordinates" : "a new screenshot"}. ${NO_SEE_LINE || PERCEPTION !== "image" ? "" : "You can only see what is in the screenshot."}`,
      inputSchema: {
        type: "object",
        properties: {
          action: {
            type: "string",
            enum: [
              "screenshot",
              "left_click",
              "double_click",
              "triple_click",
              "mouse_move",
              "type",
              "key",
              "scroll",
              "wait",
              "navigate",
            ],
          },
          coordinate: { type: "array", items: { type: "number" }, minItems: 2, maxItems: 2 },
          text: { type: "string" },
          scroll_direction: { type: "string", enum: ["up", "down"] },
          scroll_amount: { type: "number" },
          duration: { type: "number" },
        },
        required: ["action"],
      },
    },
  ],
}));
server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const a = (req.params.arguments ?? {}) as any;
  const p = await getPage();
  const c = a.coordinate as number[] | undefined;
  try {
    switch (a.action) {
      case "navigate":
        await p.goto(a.text, { waitUntil: "load", timeout: 20000 });
        break;
      case "left_click":
        await p.mouse.move(sc(c![0]), sc(c![1]));
        await p.waitForTimeout(40);
        await p.mouse.down();
        await p.waitForTimeout(30);
        await p.mouse.up();
        break;
      case "triple_click":
        await p.mouse.click(sc(c![0]), sc(c![1]), { clickCount: 3 });
        break;
      case "double_click":
        await p.mouse.move(sc(c![0]), sc(c![1]));
        await p.mouse.dblclick(sc(c![0]), sc(c![1]));
        break;
      case "mouse_move":
        await p.mouse.move(sc(c![0]), sc(c![1]));
        break;
      case "type":
        // A tab or newline in typed text acts as the key, as it would on a real keyboard.
        for (const part of String(a.text).split(/(\t|\n)/)) {
          if (part === "\t") await p.keyboard.press("Tab");
          else if (part === "\n") await p.keyboard.press("Enter");
          else if (part) await p.keyboard.type(part, { delay: 12 });
        }
        break; // xdotool's default per-key delay in the reference implementation
      case "key": {
        const m: Record<string, string> = {
          Return: "Enter",
          return: "Enter",
          tab: "Tab",
          ctrl: "Control",
          cmd: "Meta",
          super: "Meta",
        };
        const parts = String(a.text)
          .split("+")
          .map((k) => m[k] ?? (k.length === 1 ? k : k[0].toUpperCase() + k.slice(1)));
        for (const k of parts.slice(0, -1)) await p.keyboard.down(k);
        await p.keyboard.press(parts.at(-1)!);
        for (const k of parts.slice(0, -1).reverse()) await p.keyboard.up(k);
        break;
      }
      case "scroll":
        if (c) await p.mouse.move(sc(c[0]), sc(c[1]));
        await p.mouse.wheel(0, (a.scroll_direction === "up" ? -1 : 1) * (a.scroll_amount ?? 3) * 100);
        break;
      case "wait":
        await p.waitForTimeout(Math.min((a.duration ?? 1) * 1000, 10000));
        break;
    }
  } catch (e) {
    return { content: [{ type: "text", text: `error: ${(e as Error).message.slice(0, 300)}` }], isError: true };
  }
  const described = PERCEPTION === "image" ? "" : await describePage(p);
  const image = PERCEPTION === "text" ? "" : await shot();
  // Browser chrome (title and address bar) is on a real screen; the plain page screenshot lacks it, so state it as text.
  return {
    content: [
      ...(PERCEPTION === "text" ? [] : [{ type: "image", data: image, mimeType: JPEG ? "image/jpeg" : "image/png" }]),
      { type: "text", text: `Window: ${await p.title()} — ${p.url()}${described ? `\n${described}` : ""}` },
    ],
  };
});
await server.connect(new StdioServerTransport());
