// Runs on the step-up page only, so that the main bundle stays small. Plays the noise frames the server rendered.
const el = document.currentScript as HTMLScriptElement;
// Remembered until the digits are solved, so that going back and submitting again meets the same step. If the answer
// is wrong the server sends this page again, and that sets it again.
const HELD = "__wf_held";
try {
  localStorage.setItem(HELD, String(Date.now() + Number(el.dataset.ttl ?? 600) * 1000));
  document.querySelector("form")?.addEventListener("submit", () => {
    try {
      localStorage.removeItem(HELD);
    } catch {}
  });
} catch {}
const canvas = document.getElementById("wf-canvas") as HTMLCanvasElement;
const raw = atob(el.dataset.frames!);
const cols = Number(el.dataset.cols),
  rows = Number(el.dataset.rows),
  cell = 3;
const stride = Math.ceil((cols * rows) / 8);
canvas.width = cols * cell;
canvas.height = rows * cell;
const g = canvas.getContext("2d")!;
const img = g.createImageData(canvas.width, canvas.height);
let frame = 0,
  last = 0,
  playing = false;
function paint() {
  const base = frame * stride;
  for (let y = 0; y < rows; y++)
    for (let x = 0; x < cols; x++) {
      const i = y * cols + x;
      const v = (raw.charCodeAt(base + (i >> 3)) >> (i & 7)) & 1 ? 235 : 40;
      for (let py = 0; py < cell; py++)
        for (let px = 0; px < cell; px++) {
          const p = ((y * cell + py) * canvas.width + x * cell + px) * 4;
          img.data[p] = img.data[p + 1] = img.data[p + 2] = v;
          img.data[p + 3] = 255;
        }
    }
  g.putImageData(img, 0, 0);
  frame = (frame + 1) % rows;
}
function loop(ts: number) {
  if (!playing) return;
  requestAnimationFrame(loop);
  if (ts - last < 30) return;
  last = ts;
  paint();
}
const play = () => {
  playing = true;
  requestAnimationFrame(loop);
};
paint();
// A visitor who asked for less motion chooses when it starts.
if (matchMedia("(prefers-reduced-motion: reduce)").matches) {
  const b = document.getElementById("wf-play") as HTMLButtonElement;
  b.hidden = false;
  b.onclick = () => {
    b.hidden = true;
    play();
  };
} else play();
