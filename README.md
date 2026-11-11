# pinnradar: Pinnacle odds API client for Node.js

Node.js client for the [PinnRadar API](https://pinnradar.com): real-time **Pinnacle odds** as JSON. Live and prematch markets (moneyline, spreads, totals, team totals, every period), dropping-odds alerts over Server-Sent Events, and no-vig helpers.

Pinnacle closed its public API to most users in July 2025. PinnRadar is an independent service (not affiliated with Pinnacle) that serves Pinnacle's live and prematch prices over a simple REST API and push streams, with a free tier.

- Zero dependencies, Node 18+ (uses the built-in `fetch`), works in modern browsers too
- TypeScript types included
- Clear errors (`AuthError`, `RateLimitError`), streams reconnect with backoff

```bash
npm install pinnradar
```

Get a free key at [pinnradar.com](https://pinnradar.com/panel#signup) (email only, no card, no Pinnacle account).

## Quick start

```js
import { PinnRadar } from "pinnradar";

const pr = new PinnRadar({ apiKey: "YOUR_KEY" }); // or set PINNRADAR_API_KEY

// Live soccer board (sport_id 1)
const board = await pr.markets({ sportId: 1 });
for (const ev of board.events) {
  const ml = ev.periods?.num_0?.money_line ?? {};
  console.log(ev.home, "v", ev.away, ml.home, ml.draw, ml.away);
}

// Only what changed since the last call
const delta = await pr.markets({ sportId: 1, since: board.last });
```

## Prematch

```js
const fixtures = await pr.prematchFixtures({ sportId: 3 }); // basketball
const eventId = fixtures.events[0].event_id;
const markets = await pr.prematchMarkets(eventId);           // every period and line
const totals = await pr.prematchLines(eventId, "totals");
```

## Dropping odds

Recent drops from the server-side buffer:

```js
const rows = await pr.drops({ mode: "live", sportId: 1, minDropPct: 7, maxAgeSec: 600 });
for (const d of rows) console.log(d.home, d.market, d.side, d.from, "->", d.to, `${d.drop_pct.toFixed(1)}%`);
```

Or follow them live over SSE (plans with SSE: Drops, Edge, Scale):

```js
const ac = new AbortController();
for await (const drop of pr.streamDrops({ minDrop: 5, signal: ac.signal })) {
  console.log(drop.home, drop.sect, drop.outcome, drop.from_price, "->", drop.to_price, "fair", drop.nvp);
}
// prematch: pr.streamDrops({ prematch: true })
```

## No-vig (fair) odds

```js
import { noVig, margin } from "pinnradar";

margin([1.952, 1.952]);               // 0.0246 -> 2.5 % margin
noVig([2.1, 3.45, 3.7]);              // fair 1X2 prices
noVig([1.25, 4.2], "power");          // takes more margin from the longshot
```

There is also an online [no-vig calculator](https://pinnradar.com/tools/no-vig-calculator).

## Sport ids

| id | sport | id | sport |
|---|---|---|---|
| 1 | Soccer | 5 | American football |
| 2 | Tennis | 6 | Baseball |
| 3 | Basketball | 11 | Esports |
| 4 | Hockey | | |

## Errors and limits

```js
import { AuthError, RateLimitError } from "pinnradar";

try {
  await pr.markets({ sportId: 1 });
} catch (e) {
  if (e instanceof RateLimitError) console.log("slow down for", e.retryAfter, "s");
  else if (e instanceof AuthError) console.log("check your key or plan");
  else throw e;
}
```

Rate limits depend on the plan; see [pricing](https://pinnradar.com/pinnacle-api-pricing). Any other endpoint: `pr.get("/path", { ...params })`.

## Links

- API docs: https://pinnradar.com/docs
- WebSocket feed and MCP server: https://pinnradar.com/docs
- Python client: https://pypi.org/project/pinnradar/

PinnRadar is an independent data service, not affiliated with Pinnacle. MIT licensed.
