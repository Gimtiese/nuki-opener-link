import type { ClientState, GlobalState, GuardStore } from '../guard'

/** In-memory GuardStore for tests. */
export class MemoryGuardStore implements GuardStore {
  clients = new Map<string, ClientState>()
  global: GlobalState = { windowStart: 0, fails: 0, lockedUntil: 0, lastOpen: 0 }

  getClient = (key: string) => this.clients.get(key) ?? null
  setClient = (key: string, s: ClientState) => void this.clients.set(key, { ...s })
  deleteClient = (key: string) => void this.clients.delete(key)
  prune = (before: number, now: number) => {
    for (const [key, s] of this.clients) if (s.updated < before && s.lockedUntil < now) this.clients.delete(key)
  }
  getGlobal = () => ({ ...this.global })
  setGlobal = (s: GlobalState) => void (this.global = { ...s })
}
