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

## Shared server (optional)

Without a server the app is local-only: everything stays on one device. With the AWS backend in `infra/`, everyone shares the same walls and climbs:

| | Anyone | Friend (signed in) | Owner |
|---|---|---|---|
| Browse walls, climbs, lists | ✓ | ✓ | ✓ |
| Set climbs; edit/delete their own | | ✓ | ✓ |
| Tick (grade opinion, 1–3 stars, note) | | ✓ | ✓ |
| Walls, photos, holds, lists, benchmarks, grades/foot rules/tags | | | ✓ |
| Invite code, remove members, any climb | | | ✓ |

Friends make an account (name, email, password) with the **invite code**; the Cognito pre sign-up hook rejects anything else and confirms valid sign-ups on the spot. The owner is whoever signs up with the owner email given at deploy time. Access rules live in `infra/lambda/core.ts` (tested in `core.test.ts`).

**Rate limits:** API Gateway caps the API at 10 requests/second (bursts of 25), and each friend can create at most 50 climbs and 200 ticks in any 24 hours (edits don't count; the owner is exempt). Limits live in `infra/lib/stack.ts` and `infra/lambda/core.ts`.

**AWS pieces** (`infra/lib/stack.ts`, one CloudFormation stack in us-east-1): Cognito user pool, API Gateway HTTP API (verifies sign-in tokens) → one Lambda → DynamoDB (on-demand, point-in-time recovery), and an S3 bucket behind CloudFront for wall photos. Data and photos are kept if the stack is deleted.

### Deploying (from a computer with your personal AWS profile)

Needs Git, Node.js 22+ and the AWS CLI with a profile named `spraywall` (`aws configure --profile spraywall`).

```bash
git clone https://github.com/BrianBrenner/spraywall.git && cd spraywall
./infra/deploy.sh
git add src/aws-config.json && git commit -m "Point app at AWS" && git push
```

The script shows which AWS account it will use and waits for `yes`, asks for the owner email and starting invite code the first time, deploys, and writes `src/aws-config.json` (IDs and URLs only). Pushing that file makes the live site use the server. Rerun the script whenever `infra/` changes.

Then open the site → **Profile** → **Create an account** with the owner email and invite code. To move walls made before the server existed: on the old device, Settings → Export backup; on the server version, Settings → Import.

### Trying the server version locally

```bash
cd infra && npm install && npm run dev     # stand-in backend on :8787 (real API rules, in-memory data)
npm run dev:server                          # app pointed at it, from the repo root
```

Sign up as `owner@example.com` with invite code `crimp` to be the owner; any other email is a friend. Password reset codes print in the backend's terminal (always `123456`).

## Roadmap

- Not planned: an App Store / Play Store app. The Home Screen web app covers it. If that changes, wrapping with Capacitor is the route, and the AGPL-3.0 hold detector would need replacing before a closed-source store release.
