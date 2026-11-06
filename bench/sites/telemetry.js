// Bench-only recorder. Posts raw interaction events so we can measure behaviour offline.
(() => {
  const t0 = performance.now(); const ev = [];
  const push = (e) => { if (ev.length < 20000) ev.push(e); };
  const now = () => Math.round((performance.now() - t0) * 10) / 10;
  const tgt = (e) => { const el = e.target; if (!el || !el.getBoundingClientRect) return null;
    const r = el.getBoundingClientRect();
    return { n: el.name || el.id || el.tagName, cx: r.left + r.width / 2, cy: r.top + r.height / 2, w: r.width, h: r.height }; };
  for (const k of ["mousemove", "pointermove"]) addEventListener(k, (e) => push({ k, t: now(), x: e.clientX, y: e.clientY, tr: e.isTrusted }), { capture: true, passive: true });
  for (const k of ["mousedown", "mouseup", "click"]) addEventListener(k, (e) => push({ k, t: now(), x: e.clientX, y: e.clientY, tr: e.isTrusted, el: tgt(e), d: e.detail }), { capture: true, passive: true });
  for (const k of ["keydown", "keyup"]) addEventListener(k, (e) => push({ k, t: now(), tr: e.isTrusted, key: e.key.length === 1 ? "c" : e.key }), { capture: true, passive: true });
  addEventListener("input", (e) => push({ k: "input", t: now(), tr: e.isTrusted, it: e.inputType, len: (e.data || "").length, el: tgt(e) }), { capture: true, passive: true });
  for (const k of ["focusin", "paste", "scroll", "wheel", "visibilitychange", "resize"]) addEventListener(k, (e) => push({ k, t: now(), tr: e.isTrusted, y: scrollY, el: k === "focusin" ? tgt(e) : undefined }), { capture: true, passive: true });
  const env = { webdriver: navigator.webdriver, w: innerWidth, h: innerHeight, sw: screen.width, sh: screen.height, dpr: devicePixelRatio, ua: navigator.userAgent, pw: "__playwright__binding__" in window || "__pwInitScripts" in window };
  let sent = 0;
  const flush = () => { if (ev.length === sent) return; const body = JSON.stringify({ env, ev: ev.slice(sent), at: now(), path: location.pathname }); sent = ev.length; navigator.sendBeacon("/__t", body); };
  setInterval(flush, 2000); addEventListener("pagehide", flush); addEventListener("submit", flush, true);
})();
