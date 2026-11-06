/**
 * Motion-defined digits. Every frame on its own is uniform binary noise, so a screenshot holds no
 * glyph at all: inside the glyph mask the noise drifts one way, outside it drifts the other way, and
 * human motion perception separates the two instantly. The DOM holds only a canvas.
 */
export const GLYPH_W = 5,
  GLYPH_H = 7;
const FONT: Record<string, string> = {
  "0": "01110100011001110101110011000101110",
  "1": "00100011000010000100001000010001110",
  "2": "01110100010000100010001000100011111",
  "3": "11111000100010000010000011000101110",
  "4": "00010001100101010010111110001000010",
  "5": "11111100001111000001000011000101110",
  "6": "00110010001000011110100011000101110",
  "7": "11111000010001000100010000100001000",
  "8": "01110100011000101110100011000101110",
  "9": "01110100011000101111000010001001100",
};

export function maskFor(code: string, cols: number, rows: number): Uint8Array {
  const mask = new Uint8Array(cols * rows);
  const gap = 1;
  const unitW = code.length * GLYPH_W + (code.length - 1) * gap;
  const scale = Math.floor(Math.min(cols / (unitW + 2), rows / (GLYPH_H + 2)));
  const ox = Math.floor((cols - unitW * scale) / 2),
    oy = Math.floor((rows - GLYPH_H * scale) / 2);
  [...code].forEach((ch, i) => {
    const bits = FONT[ch];
    if (!bits) return;
    for (let y = 0; y < GLYPH_H; y++)
      for (let x = 0; x < GLYPH_W; x++) {
        if (bits[y * GLYPH_W + x] !== "1") continue;
        const gx = ox + (i * (GLYPH_W + gap) + x) * scale,
          gy = oy + y * scale;
        for (let dy = 0; dy < scale; dy++) for (let dx = 0; dx < scale; dx++) mask[(gy + dy) * cols + gx + dx] = 1;
      }
  });
  return mask;
}

/** One deterministic frame step, separate from the DOM so that its statistics can be tested. */
export class MotionField {
  fg: Uint8Array;
  bg: Uint8Array;
  frame = 0;
  constructor(
    public cols: number,
    public rows: number,
    public mask: Uint8Array,
    private rng: () => number = Math.random,
  ) {
    this.fg = this.noise();
    this.bg = this.noise();
  }
  private noise() {
    const a = new Uint8Array(this.cols * this.rows);
    for (let i = 0; i < a.length; i++) a[i] = this.rng() < 0.5 ? 1 : 0;
    return a;
  }
  /** The value of one cell in the current frame. */
  sample(out: Uint8Array) {
    const { cols, rows, mask, fg, bg, frame } = this;
    for (let y = 0; y < rows; y++) {
      const fy = (y - (frame % rows) + rows) % rows,
        by = (y + frame) % rows;
      for (let x = 0; x < cols; x++) {
        const i = y * cols + x;
        out[i] = mask[i] ? fg[fy * cols + x] : bg[by * cols + x];
      }
    }
  }
  step() {
    this.frame++;
  }
}

export interface ChallengeOptions {
  mask: Uint8Array;
  cols: number;
  rows: number;
  cell?: number;
  reduceMotion?: boolean;
}

export function mountCanvas(canvas: HTMLCanvasElement, o: ChallengeOptions) {
  const cell = o.cell ?? 3;
  const { cols, rows } = o;
  canvas.width = cols * cell;
  canvas.height = rows * cell;
  canvas.style.width = `${cols * cell}px`;
  canvas.style.height = `${rows * cell}px`;
  const g = canvas.getContext("2d")!;
  const field = new MotionField(cols, rows, o.mask);
  const buf = new Uint8Array(cols * rows);
  const img = g.createImageData(canvas.width, canvas.height);
  let raf = 0;
  let stopped = false;
  let last = 0;
  const draw = (ts: number) => {
    if (stopped) return;
    raf = requestAnimationFrame(draw);
    if (ts - last < 30) return; // about 30 steps a second on any display
    last = ts;
    field.sample(buf);
    field.step();
    for (let y = 0; y < canvas.height; y++)
      for (let x = 0; x < canvas.width; x++) {
        const v = buf[((y / cell) | 0) * cols + ((x / cell) | 0)] ? 235 : 40;
        const p = (y * canvas.width + x) * 4;
        img.data[p] = v;
        img.data[p + 1] = v;
        img.data[p + 2] = v;
        img.data[p + 3] = 255;
      }
    g.putImageData(img, 0, 0);
  };
  raf = requestAnimationFrame(draw);
  return () => {
    stopped = true;
    cancelAnimationFrame(raf);
  };
}
