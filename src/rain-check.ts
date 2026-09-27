/**
 * Visual rain check at microsite defaults on both Make formats.
 */
import { createDroplets, DEFAULTS } from "./engine/droplets";

const host = document.getElementById("host")!;
const meta = document.getElementById("meta")!;

function paintBusy(canvas: HTMLCanvasElement) {
  const ctx = canvas.getContext("2d")!;
  const { width: w, height: h } = canvas;
  ctx.fillStyle = "#c8c8c8";
  ctx.fillRect(0, 0, w, h);
  for (let y = 0; y < h; y += 24) {
    ctx.fillStyle = y % 48 === 0 ? "#f2f2f2" : "#a0a0a0";
    ctx.fillRect(0, y, w, 12);
  }
  ctx.fillStyle = "#111";
  ctx.font = `bold ${Math.round(w * 0.08)}px sans-serif`;
  ctx.fillText("FEELNOTHING", w * 0.08, h * 0.2);
}

function makePane(label: string, width: number, height: number, seed: number) {
  const wrap = document.createElement("div");
  const title = document.createElement("p");
  title.textContent = label;
  const output = document.createElement("canvas");
  const cssW = 220;
  output.style.width = `${cssW}px`;
  output.style.height = `${(cssW * height) / width}px`;
  output.style.border = "1px solid #000";
  wrap.append(title, output);

  const source = document.createElement("canvas");
  const drops = createDroplets(
    { source, output, paintContent: paintBusy },
    { ...DEFAULTS, width, height, seed, interactive: false, keep: 1 },
  );
  if (!drops) {
    title.textContent += " (WebGL fail)";
    return wrap;
  }
  drops.renderAt(2.5 * DEFAULTS.speed);
  return wrap;
}

host.style.display = "flex";
host.style.gap = "1.5rem";
host.style.alignItems = "flex-start";
host.append(
  makePane("Portrait 4:5", 540, 674, 0xfee10001),
  makePane("Story 9:16", 540, 960, 0),
);

meta.textContent = `DEFAULTS intensity=${DEFAULTS.intensity} scale=${DEFAULTS.scale} keep=1 · unit seed · rainAspect≥1.35`;
