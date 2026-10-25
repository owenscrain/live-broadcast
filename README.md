# Chicago Live

A Chicago live cam, full screen on a landscape TV, with a dark blue **CHICAGO LIVE** bar along the
bottom: a pulsing Chicago-flag star, the cam's short name, and the time.

The video streams from YouTube straight to the screen, so it costs no Vercel bandwidth. The only
server work is `/api/live-cams`, a lookup of a channel's current stream, CDN-cached for 10 minutes.

## Using it

| URL | Shows |
|---|---|
| `/` | The screen: the cams switched on in the controller, taking turns when there are several |
| `/?cam=midway` | That cam only (any cam's ID) |
| `/?debug=1` | A diagnostics panel: stream ID, player state, recent failures, browser |
| `/controller` | The controller: switch streams on and off, set their order and turn length, add one by YouTube link, remove one. No passcode: anyone with the link can use it. |

Changes on the controller stay there until **Save**. The screen checks every minute. With several
cams on, they take turns by the clock, so every screen shows the same one. Only streams whose
owners allow embedding can be added. A cam's framing (`crop`) is set in `lib/cams.ts`.

## Saving settings (Global Config)

The settings are one item, `liveCams`, in the Global Config store the CTA board already uses
(Hobby allows one store; the board's own `board` item isn't touched). Hobby includes 100,000 reads
and 100 writes a month across both projects:

- each **Save** is one write, and the controller shows how many have been used this month;
- the screen never reads Global Config itself: it gets a cached copy that a save refreshes.

To set it up, in the `live-broadcast` project on Vercel:

1. **Storage**: connect the existing Global Config store. This adds its connection string
   (`GLOBAL_CONFIG` or `EDGE_CONFIG`; either works).
2. **Settings → Environment Variables**: add `GLOBAL_CONFIG_WRITE_TOKEN`, a Vercel access token
   (vercel.com/account/tokens) scoped to the team that owns the store. Don't name it starting with
   `VERCEL_`: Vercel rejects those.
3. Redeploy.

Until then, the controller warns that saves don't last, and the screen plays the built-in cams.
Locally, settings are saved to `.live-cams.local.json`.

## The pieces

| File | Job |
|---|---|
| `lib/cams.ts` | The built-in cams, framing math (`camFrame`), YouTube link parsing, player settings |
| `lib/settings.ts` | The settings, checking them, and whose turn it is (`camAt`) |
| `lib/settings-store.ts` | Server-side: reading and saving the settings in Global Config |
| `app/api/settings/route.ts` | `GET` the settings, `PUT` new ones (one write) |
| `app/api/streams/route.ts` | `POST` a YouTube link: checks it can be embedded and finds its channel (no write) |
| `app/controller/` | The controller page |
| `lib/youtube-player.ts` | Loads YouTube's IFrame Player API once |
| `lib/youtube-lookup.ts` | Server-side: a channel's current live video ID, from its /live and /streams pages |
| `app/api/live-cams/route.ts` | `GET ?channels=UC…`: each channel's current video ID |
| `components/LiveCams.tsx` | The player, health checks, retry, CHICAGO LIVE bar, diagnostics |

The player is muted (so it autoplays), hidden until it's playing, checked every 3 seconds, and
replaced with a fresh one 2 minutes after a failure (not playing within 30 s, frozen for 15 s, or a
YouTube error). It's sized with plain width/height/left/top, never CSS transforms, since the Fire TV
web view ignores transforms on video.

## Development

```bash
npm install
npm run dev
npm test
```
