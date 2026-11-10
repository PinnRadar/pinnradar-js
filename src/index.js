// PinnRadar API client for Node.js 18+ and modern browsers. No dependencies.
// Docs: https://pinnradar.com/docs

export const VERSION = "0.1.0";
const DEFAULT_BASE_URL = "https://pinnradar.com";

export class PinnRadarError extends Error {
  constructor(message, status, body) {
    super(message);
    this.name = "PinnRadarError";
    this.status = status;
    this.body = body;
  }
}

/** 401/403: the key is missing, wrong, expired, or the plan lacks this feature. */
export class AuthError extends PinnRadarError {
  constructor(message, status, body) {
    super(message, status, body);
    this.name = "AuthError";
  }
}

/** 429: slow down. `retryAfter` is the number of seconds the server asked for. */
export class RateLimitError extends PinnRadarError {
  constructor(message, retryAfter, body) {
    super(message, 429, body);
    this.name = "RateLimitError";
    this.retryAfter = retryAfter;
  }
}

function query(params = {}) {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null) continue;
    q.set(k, Array.isArray(v) ? v.join(",") : typeof v === "boolean" ? String(Number(v)) : String(v));
  }
  const s = q.toString();
  return s ? `?${s}` : "";
}

function env(name) {
  try {
    return typeof process !== "undefined" && process.env ? process.env[name] : undefined;
  } catch {
    return undefined;
  }
}

const sleep = (ms, signal) =>
  new Promise((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(t);
      reject(signal.reason);
    }, { once: true });
  });

/**
 * Split a stream of text chunks into Server-Sent Event `data` payloads.
 * @param {AsyncIterable<string>} chunks
 */
export async function* parseSSE(chunks) {
  let buf = "";
  let data = [];
  for await (const chunk of chunks) {
    buf += chunk;
    let nl;
    while ((nl = buf.indexOf("\n")) !== -1) {
      const line = buf.slice(0, nl).replace(/\r$/, "");
      buf = buf.slice(nl + 1);
      if (line === "") {
        if (data.length) yield data.join("\n");
        data = [];
        continue;
      }
      if (line.startsWith(":")) continue;
      const i = line.indexOf(":");
      const field = i === -1 ? line : line.slice(0, i);
      let value = i === -1 ? "" : line.slice(i + 1);
      if (value.startsWith(" ")) value = value.slice(1);
      if (field === "data") data.push(value);
    }
  }
  if (data.length) yield data.join("\n");
}

async function* textChunks(body) {
  const decoder = new TextDecoder();
  if (body && typeof body.getReader === "function") {
    const reader = body.getReader();
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        yield decoder.decode(value, { stream: true });
      }
    } finally {
      reader.releaseLock?.();
    }
  } else if (body && Symbol.asyncIterator in body) {
    for await (const value of body) yield typeof value === "string" ? value : decoder.decode(value, { stream: true });
  }
}

export class PinnRadar {
  /**
   * @param {object} [opts]
   * @param {string} [opts.apiKey]  Defaults to process.env.PINNRADAR_API_KEY.
   * @param {string} [opts.baseUrl]
   * @param {number} [opts.timeoutMs]
   * @param {typeof fetch} [opts.fetch]
   */
  constructor(opts = {}) {
    if (typeof opts === "string") opts = { apiKey: opts };
    this.apiKey = opts.apiKey || env("PINNRADAR_API_KEY") || env("PINNRADAR_KEY");
    if (!this.apiKey) {
      throw new AuthError("No API key. Pass { apiKey } or set PINNRADAR_API_KEY. Free keys: https://pinnradar.com/panel");
    }
    this.baseUrl = (opts.baseUrl || DEFAULT_BASE_URL).replace(/\/$/, "");
    this.timeoutMs = opts.timeoutMs ?? 20_000;
    this._fetch = opts.fetch || globalThis.fetch?.bind(globalThis);
    if (!this._fetch) throw new PinnRadarError("No fetch available: use Node 18+ or pass { fetch }.");
  }

  async _send(path, params, { auth = true, stream = false, signal } = {}) {
    const headers = { accept: stream ? "text/event-stream" : "application/json" };
    if (auth) headers["x-api-key"] = this.apiKey;
    let timer;
    let sig = signal;
    if (!stream && this.timeoutMs) {
      const ctrl = new AbortController();
      timer = setTimeout(() => ctrl.abort(new PinnRadarError(`Timed out after ${this.timeoutMs} ms`)), this.timeoutMs);
      signal?.addEventListener("abort", () => ctrl.abort(signal.reason), { once: true });
      sig = ctrl.signal;
    }
    let res;
    try {
      res = await this._fetch(this.baseUrl + path + query(params), { headers, signal: sig });
    } catch (e) {
      clearTimeout(timer);
      if (e instanceof PinnRadarError) throw e;
      if (sig?.aborted && sig.reason instanceof PinnRadarError) throw sig.reason;
      throw new PinnRadarError(`Connection failed: ${e?.message || e}`);
    }
    clearTimeout(timer);
    if (!res.ok) {
      const raw = await res.text().catch(() => "");
      let body = raw;
      try {
        body = JSON.parse(raw);
      } catch {}
      const msg = `HTTP ${res.status}${body && body.error ? `: ${body.error}` : ""}`;
      if (res.status === 429) {
        const ra = Number(res.headers.get("retry-after"));
        throw new RateLimitError(msg, Number.isFinite(ra) ? ra : undefined, body);
      }
      if (res.status === 401 || res.status === 403) throw new AuthError(msg, res.status, body);
      throw new PinnRadarError(msg, res.status, body);
    }
    return res;
  }

  /** Call any GET endpoint and return the decoded JSON. */
  async get(path, params, opts) {
    const res = await this._send(path, params, opts);
    return res.json();
  }

  /**
   * Full board for one sport. `eventType` is "live" (default) or "prematch".
   * Pass the previous answer's `last` as `since` to receive only what changed.
   */
  markets({ sportId, eventType = "live", since, includeSpecials } = {}, opts) {
    const inc = includeSpecials === true ? 1 : includeSpecials || undefined;
    return this.get("/kit/v1/markets", { sport_id: sportId, event_type: eventType, since, include_specials: inc }, opts);
  }

  /** Every market of one live event. */
  details(eventId, opts) {
    return this.get("/kit/v1/details", { event_id: eventId }, opts);
  }

  /** Upcoming fixtures of one sport with their main prices. */
  prematchFixtures({ sportId, since } = {}, opts) {
    return this.get("/kit/v1/prematch/fixtures", { sport_id: sportId, since }, opts);
  }

  /** Complete market set of one prematch event. */
  prematchMarkets(eventId, opts) {
    return this.get("/kit/v1/prematch/markets", { event_id: eventId }, opts);
  }

  /** Lines of one prematch event; `marketType` is money_line, spreads, totals or team_total. */
  prematchLines(eventId, marketType, opts) {
    return this.get("/kit/v1/prematch/lines", { event_id: eventId, market_type: marketType }, opts);
  }

  /** Recent price drops from the server-side buffer (about 3 hours deep). Returns the rows. */
  async drops({ maxAgeSec = 600, mode = "live", minDropPct, maxDropPct, sportId, markets, periods, limit } = {}, opts) {
    const page = await this.get(
      "/api/drops",
      {
        mode,
        max_age_sec: maxAgeSec,
        min_drop_pct: minDropPct,
        max_drop_pct: maxDropPct,
        sport_id: sportId,
        markets,
        periods,
        limit,
      },
      opts
    );
    return Array.isArray(page) ? page : page?.drops ?? [];
  }

  /** True when the API answers. Needs no key. */
  async ping(opts) {
    try {
      const res = await this._send("/ping", undefined, { ...opts, auth: false });
      return res.ok;
    } catch {
      return false;
    }
  }

  /**
   * Follow drop alerts over Server-Sent Events. Yields one object per drop:
   * home, away, league, sport, sect, outcome, point, period, from_price,
   * to_price, nvp, limit and, in play, live (score, clock, cards, corners).
   * Reconnects with backoff unless `reconnect: false`. Stop it with an AbortSignal
   * or by breaking out of the loop. Needs a plan with SSE (Drops, Edge, Scale).
   */
  async *streamDrops({ prematch = false, minDrop, recheck, reconnect = true, maxBackoffMs = 30_000, signal } = {}) {
    const path = prematch ? "/odds-drop-prematch" : "/odds-drop";
    let backoff = 1000;
    for (;;) {
      try {
        const res = await this._send(path, { min_drop: minDrop, recheck }, { stream: true, signal });
        backoff = 1000;
        for await (const payload of parseSSE(textChunks(res.body))) {
          let frame;
          try {
            frame = JSON.parse(payload);
          } catch {
            continue;
          }
          if (Array.isArray(frame)) {
            for (const d of frame) yield d;
          } else if (frame && frame.type === "error") {
            throw new PinnRadarError(String(frame.error || "stream error"), undefined, frame);
          } else if (frame && ("to_price" in frame || "to" in frame)) {
            yield frame;
          }
        }
      } catch (e) {
        if (signal?.aborted) return;
        if (!reconnect || e instanceof AuthError || e instanceof RateLimitError) throw e;
      }
      if (!reconnect || signal?.aborted) return;
      try {
        await sleep(backoff, signal);
      } catch {
        return;
      }
      backoff = Math.min(maxBackoffMs, backoff * 2);
    }
  }
}

/* ------------------------------------------------------------ odds helpers */

/** Implied probability of a decimal price. */
export function implied(price) {
  if (!(price > 1)) throw new RangeError("decimal odds must be greater than 1");
  return 1 / price;
}

/** Bookmaker margin of a complete market (sum of implied probabilities − 1). */
export function margin(prices) {
  return prices.reduce((a, p) => a + implied(p), 0) - 1;
}

/**
 * Fair (no-vig) decimal prices for a complete market.
 * @param {number[]} prices every outcome of the market
 * @param {"multiplicative"|"power"} [method]
 */
export function noVig(prices, method = "multiplicative") {
  if (!Array.isArray(prices) || prices.length < 2) throw new RangeError("need every outcome of the market (at least two prices)");
  const q = prices.map(implied);
  let probs;
  if (method === "multiplicative") {
    const s = q.reduce((a, b) => a + b, 0);
    probs = q.map((x) => x / s);
  } else if (method === "power") {
    let lo = 0.05;
    let hi = 50;
    for (let i = 0; i < 200; i++) {
      const k = (lo + hi) / 2;
      if (q.reduce((a, x) => a + x ** k, 0) > 1) lo = k;
      else hi = k;
    }
    const k = (lo + hi) / 2;
    probs = q.map((x) => x ** k);
    const t = probs.reduce((a, b) => a + b, 0);
    probs = probs.map((p) => p / t);
  } else {
    throw new RangeError('method must be "multiplicative" or "power"');
  }
  return probs.map((p) => 1 / p);
}

export default PinnRadar;
