/**
 * Browser smoke: tiny encode (10 frames) to verify WebGL + WebCodecs path.
 * Open /smoke.html while Vite is running.
 */
import { createDroplets } from "./engine/droplets";
import { encodeMp4 } from "./encode/mp4";
import { paintCroppedPhoto, defaultCrop } from "./app/crop";

const out = document.getElementById("out")!;

async function run() {
  out.textContent = "starting…";
  const photo = document.createElement("canvas");
  photo.width = 800;
  photo.height = 1000;
  const pctx = photo.getContext("2d")!;
  const g = pctx.createLinearGradient(0, 0, 800, 1000);
  g.addColorStop(0, "#c45c26");
  g.addColorStop(1, "#1a1a2e");
  pctx.fillStyle = g;
  pctx.fillRect(0, 0, 800, 1000);
  pctx.fillStyle = "#fff";
  pctx.font = "48px sans-serif";
  pctx.fillText("FEELNOTHING", 80, 200);
  const image = await createImageBitmap(photo);

  const width = 270;
  const height = 338;
  const source = document.createElement("canvas");
  const output = document.createElement("canvas");
  const crop = defaultCrop();

  const paintContent = (canvas: HTMLCanvasElement) => {
    const ctx = canvas.getContext("2d")!;
    paintCroppedPhoto(ctx, image, crop, canvas.width, canvas.height);
  };

  const droplets = createDroplets(
    { source, output, paintContent },
    { width, height, seed: 0xabc123, interactive: false, keep: 1 },
  );
  if (!droplets) throw new Error("WebGL2 failed");

  const fps = 30;
  const frameCount = 10;
  const blob = await encodeMp4({
    width,
    height,
    fps,
    frameCount,
    canvas: output,
    renderFrame: (i) => droplets.renderFrame(i, fps),
    onProgress: (d, t) => {
      out.textContent = `encoding ${d}/${t}`;
    },
  });

  droplets.destroy();
  image.close();

  const url = URL.createObjectURL(blob);
  const v = document.createElement("video");
  v.src = url;
  v.controls = true;
  v.muted = true;
  v.playsInline = true;
  document.body.appendChild(v);
  out.textContent = `OK ${blob.size} bytes type=${blob.type}`;
}

run().catch((err) => {
  out.textContent = `FAIL: ${err instanceof Error ? err.message : String(err)}`;
  console.error(err);
});
