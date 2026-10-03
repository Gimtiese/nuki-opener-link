/**
 * Brute-force protection. One global Durable Object instance sees every attempt worldwide,
 * so limits cannot be bypassed by spreading requests over many IPs or Cloudflare locations.
 *
 * - Per client (IPv4 address or IPv6 /64 network): after 5 wrong PINs the client is locked
 *   for 1 minute, doubling with every further wrong PIN up to 1 hour.
 * - Globally: 30 wrong PINs within an hour lock the door for everyone for 1 hour.
 * - After the door was actually opened, further openings wait 5 seconds.
 *
 * While locked, even the correct PIN is refused, so a lock never reveals whether a PIN was right.
 */

import { DurableObject } from 'cloudflare:workers'

export const LIMITS = {
  clientFreeFails: 5,
  clientBaseLockMs: 60_000,
  clientMaxLockMs: 60 * 60_000,
  /** Failures of a client are forgotten after a day without new failures. */
  clientForgetMs: 24 * 60 * 60_000,
  globalWindowMs: 60 * 60_000,
  globalMaxFails: 30,
  globalLockMs: 60 * 60_000,
  cooldownMs: 5_000,
}

export type Limits = typeof LIMITS

export type Decision =
  | { result: 'open' }
  | { result: 'wrong_pin' }
  | { result: 'locked'; retryAfter: number }
  | { result: 'cooldown'; retryAfter: number }

export interface ClientState {
  fails: number
  lockedUntil: number
  updated: number
}

export interface GlobalState {
  windowStart: number
  fails: number
  lockedUntil: number
  lastOpen: number
}

export interface GuardStore {
  getClient(key: string): ClientState | null
  setClient(key: string, state: ClientState): void
  deleteClient(key: string): void
  /** Removes clients without failures since `before` that are no longer locked at `now`. */
  prune(before: number, now: number): void
  getGlobal(): GlobalState
  setGlobal(state: GlobalState): void
}

const seconds = (ms: number) => Math.max(1, Math.ceil(ms / 1000))

/** Decides one attempt atomically. `pinOk` is computed by the caller before. */
export function decide(store: GuardStore, client: string, pinOk: boolean, now: number, limits: Limits = LIMITS): Decision {
  store.prune(now - limits.clientForgetMs, now)
  const global = store.getGlobal()
  const state = store.getClient(client)

  const lockedUntil = Math.max(global.lockedUntil, state?.lockedUntil ?? 0)
  if (lockedUntil > now) return { result: 'locked', retryAfter: seconds(lockedUntil - now) }

  if (!pinOk) {
    const fails = (state?.fails ?? 0) + 1
    const over = fails - limits.clientFreeFails
    const clientLock = over >= 0 ? now + Math.min(limits.clientBaseLockMs * 2 ** over, limits.clientMaxLockMs) : 0
    store.setClient(client, { fails, lockedUntil: clientLock, updated: now })

    const windowExpired = now - global.windowStart >= limits.globalWindowMs
    const globalFails = (windowExpired ? 0 : global.fails) + 1
    if (globalFails >= limits.globalMaxFails) {
      console.warn(`Global lock: ${globalFails} wrong PINs within an hour, door locked for ${limits.globalLockMs / 60_000} minutes.`)
      store.setGlobal({ ...global, windowStart: now, fails: 0, lockedUntil: now + limits.globalLockMs })
    } else {
      store.setGlobal({ ...global, windowStart: windowExpired ? now : global.windowStart, fails: globalFails })
    }
    return { result: 'wrong_pin' }
  }

  const sinceOpen = now - global.lastOpen
  if (global.lastOpen > 0 && sinceOpen < limits.cooldownMs) return { result: 'cooldown', retryAfter: seconds(limits.cooldownMs - sinceOpen) }

  store.deleteClient(client)
  return { result: 'open' }
}

/** Starts the cooldown. Called only after Nuki accepted the command, so a failed attempt can be retried at once. */
export function recordOpen(store: GuardStore, now: number): void {
  store.setGlobal({ ...store.getGlobal(), lastOpen: now })
}

/** GuardStore on the Durable Object's built-in SQLite database. */
class SqlGuardStore implements GuardStore {
  constructor(private readonly sql: SqlStorage) {
    sql.exec(`CREATE TABLE IF NOT EXISTS clients (
      key TEXT PRIMARY KEY, fails INTEGER NOT NULL, locked_until INTEGER NOT NULL, updated INTEGER NOT NULL)`)
    sql.exec(`CREATE TABLE IF NOT EXISTS global (
      id INTEGER PRIMARY KEY CHECK (id = 1), window_start INTEGER NOT NULL, fails INTEGER NOT NULL,
      locked_until INTEGER NOT NULL, last_open INTEGER NOT NULL)`)
  }

  getClient(key: string): ClientState | null {
    const row = this.sql.exec('SELECT fails, locked_until, updated FROM clients WHERE key = ?', key).toArray()[0]
    return row ? { fails: Number(row.fails), lockedUntil: Number(row.locked_until), updated: Number(row.updated) } : null
  }

  setClient(key: string, s: ClientState): void {
    this.sql.exec(
      `INSERT INTO clients (key, fails, locked_until, updated) VALUES (?, ?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET fails = excluded.fails, locked_until = excluded.locked_until, updated = excluded.updated`,
      key, s.fails, s.lockedUntil, s.updated,
    )
  }

  deleteClient(key: string): void {
    this.sql.exec('DELETE FROM clients WHERE key = ?', key)
  }

  prune(before: number, now: number): void {
    this.sql.exec('DELETE FROM clients WHERE updated < ? AND locked_until < ?', before, now)
  }

  getGlobal(): GlobalState {
    const row = this.sql.exec('SELECT window_start, fails, locked_until, last_open FROM global WHERE id = 1').toArray()[0]
    return row
      ? { windowStart: Number(row.window_start), fails: Number(row.fails), lockedUntil: Number(row.locked_until), lastOpen: Number(row.last_open) }
      : { windowStart: 0, fails: 0, lockedUntil: 0, lastOpen: 0 }
  }

  setGlobal(s: GlobalState): void {
    this.sql.exec(
      'INSERT OR REPLACE INTO global (id, window_start, fails, locked_until, last_open) VALUES (1, ?, ?, ?, ?)',
      s.windowStart, s.fails, s.lockedUntil, s.lastOpen,
    )
  }
}

export class Guard extends DurableObject {
  private readonly store: GuardStore

  constructor(ctx: DurableObjectState, env: unknown) {
    super(ctx, env as never)
    this.store = new SqlGuardStore(ctx.storage.sql)
  }

  /** RPC entry point. Runs without interleaving, so check and update are atomic. */
  attempt(client: string, pinOk: boolean): Decision {
    return decide(this.store, client, pinOk, Date.now())
  }

  opened(): void {
    recordOpen(this.store, Date.now())
  }
}
