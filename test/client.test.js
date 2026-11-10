import { test } from "node:test";
import assert from "node:assert/strict";
import { PinnRadar, AuthError, RateLimitError, noVig, margin, parseSSE } from "../src/index.js";

function fakeFetch(handler) {
  const calls = [];
  const fn = async (url, init) => {
    calls.push({ url, headers: init.headers });
    return handler(url, init);
  };
  fn.calls = calls;
  return fn;
}

const json = (obj, status = 200, headers = {}) => new Response(JSON.stringify(obj), { status, headers });

test("requires a key", () => {
  const saved = process.env.PINNRADAR_API_KEY;
  delete process.env.PINNRADAR_API_KEY;
  delete process.env.PINNRADAR_KEY;
  assert.throws(() => new PinnRadar(), AuthError);
  if (saved) process.env.PINNRADAR_API_KEY = saved;
});

test("markets builds the url and sends the key", async () => {
  const f = fakeFetch(() => json({ sport_id: 1, events: [] }));
  const pr = new PinnRadar({ apiKey: "k", fetch: f });
  const b = await pr.markets({ sportId: 1, includeSpecials: true });
  assert.equal(b.sport_id, 1);
  assert.equal(f.calls[0].url, "https://pinnradar.com/kit/v1/markets?sport_id=1&event_type=live&include_specials=1");
  assert.equal(f.calls[0].headers["x-api-key"], "k");
});

test("drops joins lists and unwraps rows", async () => {
  const f = fakeFetch(() => json({ drops: [{ from: 2, to: 1.8 }] }));
  const rows = await new PinnRadar({ apiKey: "k", fetch: f }).drops({ markets: ["total", "spread"], periods: [0, 1] });
  assert.deepEqual(rows, [{ from: 2, to: 1.8 }]);
  assert.match(f.calls[0].url, /markets=total%2Cspread/);
  assert.match(f.calls[0].url, /periods=0%2C1/);
});

test("429 becomes RateLimitError with retryAfter", async () => {
  const f = fakeFetch(() => json({ error: "rate_limited" }, 429, { "retry-after": "3" }));
  await assert.rejects(new PinnRadar({ apiKey: "k", fetch: f }).markets({ sportId: 1 }), (e) => e instanceof RateLimitError && e.retryAfter === 3);
});

test("401 becomes AuthError", async () => {
  const f = fakeFetch(() => json({ error: "invalid_key" }, 401));
  await assert.rejects(new PinnRadar({ apiKey: "k", fetch: f }).details(1), (e) => e instanceof AuthError && /invalid_key/.test(e.message));
});

test("parseSSE splits events", async () => {
  async function* chunks() {
    yield ": ping\n\ndata: [1,";
    yield "2]\n\nevent: x\ndata: a\ndata: b\n\n";
  }
  const out = [];
  for await (const d of parseSSE(chunks())) out.push(d);
  assert.deepEqual(out, ["[1,2]", "a\nb"]);
});

test("streamDrops yields drops and skips the connected frame", async () => {
  const body = 'data: {"type":"connected","id":"x"}\n\ndata: [{"from_price":2,"to_price":1.8},{"from_price":3,"to_price":2.5}]\n\n';
  const f = fakeFetch(() => new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } }));
  const got = [];
  for await (const d of new PinnRadar({ apiKey: "k", fetch: f }).streamDrops({ minDrop: 3, reconnect: false })) got.push(d.to_price);
  assert.deepEqual(got, [1.8, 2.5]);
  assert.match(f.calls[0].url, /\/odds-drop\?min_drop=3$/);
});

test("noVig and margin", () => {
  assert.deepEqual(noVig([1.952, 1.952]).map((x) => +x.toFixed(3)), [2, 2]);
  const fair = noVig([2.1, 3.45, 3.7], "power");
  assert.ok(Math.abs(fair.reduce((a, x) => a + 1 / x, 0) - 1) < 1e-9);
  assert.ok(Math.abs(margin([1.952, 1.952]) - (2 / 1.952 - 1)) < 1e-12);
});
