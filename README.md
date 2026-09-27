# Ⓕ MAKE IT RAIN

Crop a photo for **Portrait 1080×1350** + **Story 1080×1920**, then export silent rain MP4s (H.264, 10s @ 60fps).

**Production:** [https://rain.feelnoth.ing](https://rain.feelnoth.ing)

## Run locally

```bash
npm install
npm run dev
```

Dev server: [http://127.0.0.1:43124/](http://127.0.0.1:43124/)

```bash
npm run build
npm run preview
```

## Flow

Upload → Crop → Generate (preview encode) → Download (final export + randomise).

Needs **WebGL2** + **WebCodecs H.264** (recent Chrome / Safari).

## Deploy (Hetzner / feelnoth.ing)

Same VPS as apex (`2.28.53.230`). Wildcard DNS at Hover already covers `rain.feelnoth.ing`.

```bash
npm run build
rsync -av --delete dist/ root@2.28.53.230:/var/www/rain/
```

Nginx site: `/etc/nginx/sites-available/rain` → `/var/www/rain`. Certbot cert: `rain.feelnoth.ing`.

## Notes

- Client-only. Max upload 20MB JPEG/PNG/WebP.
- Rain engine forked from FEELNOTHING launch microsite droplets into `src/engine/`.
