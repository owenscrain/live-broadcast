# Chicago Live

A Chicago live cam, full screen on a landscape TV, with a dark blue **CHICAGO LIVE** bar along the
bottom: a pulsing Chicago-flag star, the cam's short name, and the time.

The video streams from YouTube straight to the screen, so it costs no Vercel bandwidth. The only
server work is `/api/live-cams`, a lookup of a channel's current stream, CDN-cached for 10 minutes.

## Using it

| URL | Shows |
|---|---|
| `/` | The first cam switched on in `lib/cams.ts` |
| `/?cam=midway` | That cam (any `id` in the list) |
| `/?debug=1` | A diagnostics panel: stream ID, player state, recent failures, browser |

To add, remove or reframe a cam, edit `CAMS` in `lib/cams.ts` and push. Only embed streams whose
owners allow embedding.

## The pieces

| File | Job |
|---|---|
| `lib/cams.ts` | The cam list, framing math (`camFrame`), player settings |
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
