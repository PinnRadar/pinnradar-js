export declare const VERSION: string;

export declare class PinnRadarError extends Error {
  status?: number;
  body?: unknown;
  constructor(message: string, status?: number, body?: unknown);
}
export declare class AuthError extends PinnRadarError {}
export declare class RateLimitError extends PinnRadarError {
  retryAfter?: number;
}

export interface ClientOptions {
  /** Defaults to process.env.PINNRADAR_API_KEY. */
  apiKey?: string;
  baseUrl?: string;
  timeoutMs?: number;
  fetch?: typeof fetch;
}

export interface RequestOptions {
  signal?: AbortSignal;
}

export type Price = number | null;

export interface Period {
  money_line?: { home?: Price; away?: Price; draw?: Price } | null;
  spreads?: Record<string, { hdp: number; home?: Price; away?: Price }> | null;
  totals?: Record<string, { points: number; over?: Price; under?: Price }> | null;
  team_total?: unknown;
  meta?: Record<string, unknown>;
  [k: string]: unknown;
}

export interface Event {
  event_id: number;
  sport_id?: number;
  league_id?: number;
  league_name?: string;
  home: string;
  away: string;
  starts?: string;
  periods?: Record<string, Period>;
  [k: string]: unknown;
}

export interface Board {
  sport_id: number;
  sport_name?: string;
  last?: number;
  last_call?: number;
  events: Event[];
  [k: string]: unknown;
}

export interface DropRow {
  event_id: number;
  home: string;
  away: string;
  market: string;
  side: string;
  from: number;
  to: number;
  nvp?: number | null;
  drop_pct: number;
  [k: string]: unknown;
}

export interface StreamDrop {
  id: number;
  home: string;
  away: string;
  league: string;
  sport: string;
  sport_id: number;
  sect: "Moneyline" | "Spread" | "Total" | "TeamTotal" | string;
  outcome: string;
  point?: number | null;
  period: number;
  period_name?: string;
  from_price: number;
  to_price: number;
  nvp?: number | null;
  limit?: number;
  alerted_ms?: number;
  live?: {
    status?: string;
    minute?: number;
    score?: { home: number; away: number };
    [k: string]: unknown;
  };
  [k: string]: unknown;
}

export declare function parseSSE(chunks: AsyncIterable<string>): AsyncGenerator<string>;

export declare class PinnRadar {
  apiKey: string;
  baseUrl: string;
  timeoutMs: number;
  constructor(opts?: ClientOptions | string);
  get<T = unknown>(path: string, params?: Record<string, unknown>, opts?: RequestOptions): Promise<T>;
  markets(
    args: { sportId: number; eventType?: "live" | "prematch"; since?: number; includeSpecials?: boolean | "nested" },
    opts?: RequestOptions
  ): Promise<Board>;
  details(eventId: number, opts?: RequestOptions): Promise<Board>;
  prematchFixtures(args: { sportId: number; since?: number }, opts?: RequestOptions): Promise<Board>;
  prematchMarkets(eventId: number, opts?: RequestOptions): Promise<Board>;
  prematchLines(eventId: number, marketType?: "money_line" | "spreads" | "totals" | "team_total", opts?: RequestOptions): Promise<unknown>;
  drops(
    args?: {
      maxAgeSec?: number;
      mode?: "live" | "prematch";
      minDropPct?: number;
      maxDropPct?: number;
      sportId?: number;
      markets?: string | string[];
      periods?: string | number[];
      limit?: number;
    },
    opts?: RequestOptions
  ): Promise<DropRow[]>;
  ping(opts?: RequestOptions): Promise<boolean>;
  streamDrops(args?: {
    prematch?: boolean;
    minDrop?: number;
    recheck?: number;
    reconnect?: boolean;
    maxBackoffMs?: number;
    signal?: AbortSignal;
  }): AsyncGenerator<StreamDrop>;
}

export declare function implied(price: number): number;
export declare function margin(prices: number[]): number;
export declare function noVig(prices: number[], method?: "multiplicative" | "power"): number[];

export default PinnRadar;
