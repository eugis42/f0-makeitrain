# Ⓕ MAKE IT RAIN

Internal tool: crop a photo for **Portrait 1080×1350** + **Story 1080×1920**, then export silent rain MP4s (H.264, 10s @ 60fps).

## Run

```bash
cd make
npm install
npm run dev
```

Dev server: [http://127.0.0.1:43124/](http://127.0.0.1:43124/)

```bash
npm run build
npm run preview
```

## Flow

Upload → Crop (both formats) → Generate (preview encode) → Download (final export + randomise).

Needs **WebGL2** + **WebCodecs H.264** (recent Chrome / Safari).

## Notes

- Client-only. Max upload 20MB JPEG/PNG/WebP.
- Rain engine forked from `launch-microsite/droplets.js` into `src/engine/` (RGB photo, seed, fixed-timestep export).
- Microsite untouched.
