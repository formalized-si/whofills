import type { RawEvent } from "./features.ts";

const MAX = 4000;

/** Passive capture-phase listeners. Never touches the page or its layout. */
export function startSensor(root: Document = document) {
  const ev: RawEvent[] = [];
  const t0 = performance.now();
  const now = () => Math.round((performance.now() - t0) * 10) / 10;
  const opts = { capture: true, passive: true } as const;
  const push = (e: RawEvent) => {
    if (ev.length < MAX) ev.push(e);
  };
  let lastMove = 0;
  const on = <K extends keyof DocumentEventMap>(type: K, fn: (e: DocumentEventMap[K]) => void) =>
    root.addEventListener(type, fn as EventListener, opts);

  on("mousemove", (e) => {
    const t = now();
    if (t - lastMove >= 16) {
      lastMove = t;
      push({ k: "move", t, tr: e.isTrusted });
    }
  });
  on("mousedown", (e) => push({ k: "down", t: now(), x: 0, y: 0, tr: e.isTrusted }));
  on("mouseup", (e) => push({ k: "up", t: now(), x: 0, y: 0, tr: e.isTrusted }));
  on("click", (e) => {
    const el = e.target as Element | null;
    const r = el?.getBoundingClientRect?.();
    const off = r ? Math.hypot(e.clientX - (r.left + r.width / 2), e.clientY - (r.top + r.height / 2)) : undefined;
    push({ k: "click", t: now(), x: 0, y: 0, tr: e.isTrusted, off, w: r?.width, h: r?.height, d: e.detail });
  });
  on("keydown", (e) => {
    if (!e.repeat) push({ k: "kd", t: now(), tr: e.isTrusted });
  });
  on("input", (e) => {
    const i = e as InputEvent;
    push({ k: "input", t: now(), tr: e.isTrusted, it: i.inputType ?? "", len: i.data?.length ?? 0 });
  });
  on("wheel", (e) => push({ k: "wheel", t: now(), tr: e.isTrusted }));
  on("touchstart", (e) => push({ k: "touch", t: now(), tr: e.isTrusted }));
  on("compositionstart", (e) => push({ k: "compose", t: now(), tr: e.isTrusted }));
  on("paste", (e) => push({ k: "paste", t: now(), tr: e.isTrusted }));
  return { events: () => ev };
}
