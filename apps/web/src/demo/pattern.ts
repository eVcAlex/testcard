import type { Channel } from "./data.ts";

const W = 320;
const H = 180;
const BARS = ["#c9c9c4", "#c2bf84", "#84b8b8", "#84b88a", "#b484b1", "#b48484", "#8484b4"];

const hash = (s: string) => [...s].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7);
/** A small seeded generator, so the same channel and frame always draw the same static. */
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function drawPattern(x: CanvasRenderingContext2D, ch: Channel) {
  const hue = ch.hue * 30;
  x.setTransform(2, 0, 0, 2, 0, 0);
  x.fillStyle = `hsl(${hue} 28% 24%)`;
  x.fillRect(0, 0, W, H);
  x.strokeStyle = `hsl(${hue} 25% 36%)`;
  x.lineWidth = 1;
  x.beginPath();
  for (let i = 0; i <= W; i += 20) { x.moveTo(i + 0.5, 0); x.lineTo(i + 0.5, H); }
  for (let j = 0; j <= H; j += 20) { x.moveTo(0, j + 0.5); x.lineTo(W, j + 0.5); }
  x.stroke();
  x.strokeStyle = "#d8d4cc";
  x.lineWidth = 2;
  x.beginPath();
  x.arc(160, 76, 58, 0, Math.PI * 2);
  x.moveTo(160, 18); x.lineTo(160, 134);
  x.moveTo(102, 76); x.lineTo(218, 76);
  x.stroke();
  BARS.forEach((b, i) => { x.fillStyle = b; x.fillRect(Math.round((i * W) / 7), 140, Math.ceil(W / 7), 40); });
  x.fillStyle = "#0a0d11";
  x.fillRect(84, 60, 152, 32);
  x.fillStyle = "#f2eee7";
  x.font = "600 14px 'Inter Variable', system-ui, sans-serif";
  x.textAlign = "center";
  x.textBaseline = "middle";
  x.fillText(ch.name, 160, 76, 140);
}

export function drawNoise(x: CanvasRenderingContext2D, seed: string, frame: number) {
  const rnd = mulberry32(hash(seed) + frame * 7919);
  const cell = 4;
  x.setTransform(2, 0, 0, 2, 0, 0);
  for (let j = 0; j < H; j += cell) {
    for (let i = 0; i < W; i += cell) {
      const v = Math.floor(rnd() * 190);
      x.fillStyle = `rgb(${v} ${v} ${v})`;
      x.fillRect(i, j, cell, cell);
    }
  }
}
