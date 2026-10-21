# Spray Wall

Personal spray wall app: photograph your wall, outline the holds, set climbs, browse and filter them, and keep lists. Everything stays on the device (IndexedDB); move between devices with Settings → Export / Import backup.

```bash
npm install
npm run dev      # http://localhost:5173 (also on your LAN, for testing on an iPad/phone)
npm test
npm run build    # static PWA in dist/
```

## How it fits together

- `src/types.ts`, `src/db.ts` — data model (Dexie/IndexedDB). A wall has numbered **versions** (photo + hold outlines). Climbs reference the version they were set on, so adding a new photo never changes old climbs. New versions can copy the previous version's outlines (same hold ids).
- `src/components/WallCanvas.tsx` — photo + SVG overlay with pinch/trackpad/wheel pan & zoom, tap and drag callbacks in image pixel coordinates.
- `src/pages/` — hold editor, climb editor, wall browser, climbing view, lists, heatmap, settings.
- `src/lib/transfer.ts` — zip export/import (`data.json` + photos; thumbnails are regenerated on import).

## Live site

Every push to `main` builds and deploys to GitHub Pages: **https://brianbrenner.github.io/spraywall/** (workflow in `.github/workflows/deploy.yml`).

## Installing on iPad / iPhone

Open https://brianbrenner.github.io/spraywall/ in Safari → Share → Add to Home Screen. This runs it full screen and protects its storage from Safari's automatic clean-up of unused sites. Export a backup now and then anyway.

## Hold detection

All on-device (onnxruntime-web), models in `public/models/` (see its README for sources and licences), loaded only when used:

- **Detect holds** — YOLOv8n spray-wall detector → ellipse per hold (`src/lib/detect.ts`).
- **Refine outlines** — SlimSAM turns each ellipse into a polygon that follows the hold, processing the photo in ~1024px tiles (`src/lib/sam.ts`, `src/lib/samCore.ts`, `src/lib/polygon.ts`).
- **Trace** tool — tap a hold to outline it with SlimSAM.

## Roadmap

- **To do: automatic cloud backup to S3.** Back up when the app opens (or after changes, at most every so often), keep history, and restore from a list of dates. Keep AWS credentials out of the app: a private, versioned, encrypted S3 bucket with a lifecycle rule for old versions, plus a small Lambda (function URL) that hands out short-lived presigned upload/download URLs only when the request carries a backup code entered once per device. Deploy it as one reviewable CloudFormation template. Optional: encrypt backups on-device with a passphrase before upload.
- Phase 3: wrap with Capacitor for the App Store / Play Store. The detector is AGPL-3.0, which needs resolving before a closed-source store release.
