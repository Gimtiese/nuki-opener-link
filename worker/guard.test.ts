import { describe, expect, it } from 'vitest'
import { decide, LIMITS, recordOpen } from './guard'
import { MemoryGuardStore } from './test/memory-store'

const MIN = 60_000

describe('per-client lock', () => {
  it('allows 4 wrong PINs, locks on the 5th and doubles the lock afterwards', () => {
    const store = new MemoryGuardStore()
    let now = 1_000_000
    for (let i = 0; i < 4; i++) expect(decide(store, 'a', false, now).result).toBe('wrong_pin')
    expect(decide(store, 'a', false, now).result).toBe('wrong_pin') // 5th: counted, then locked
    expect(decide(store, 'a', true, now)).toEqual({ result: 'locked', retryAfter: 60 })

    now += MIN // lock over, 6th wrong PIN locks for 2 minutes
    expect(decide(store, 'a', false, now).result).toBe('wrong_pin')
    expect(decide(store, 'a', true, now + MIN)).toEqual({ result: 'locked', retryAfter: 60 })
    expect(decide(store, 'a', true, now + 2 * MIN).result).toBe('open')
  })

  it('caps the lock at one hour', () => {
    const store = new MemoryGuardStore()
    store.setClient('a', { fails: 40, lockedUntil: 0, updated: 0 })
    decide(store, 'a', false, 10)
    expect(store.getClient('a')?.lockedUntil).toBe(10 + LIMITS.clientMaxLockMs)
  })

  it('does not affect other clients and resets on success', () => {
    const store = new MemoryGuardStore()
    for (let i = 0; i < 5; i++) decide(store, 'a', false, 0)
    expect(decide(store, 'b', true, 0).result).toBe('open')
    decide(store, 'c', false, 10_000)
    expect(decide(store, 'c', true, 20_000).result).toBe('open')
    expect(store.getClient('c')).toBeNull()
  })

  it('forgets old failures after a day', () => {
    const store = new MemoryGuardStore()
    for (let i = 0; i < 4; i++) decide(store, 'a', false, 0)
    decide(store, 'a', false, LIMITS.clientForgetMs + 1)
    expect(store.getClient('a')?.fails).toBe(1)
  })
})

describe('global lock', () => {
  it('locks everyone after 30 wrong PINs within an hour, even with the right PIN', () => {
    const store = new MemoryGuardStore()
    for (let i = 0; i < LIMITS.globalMaxFails; i++) decide(store, `ip${i}`, false, 1000 + i)
    expect(decide(store, 'someone-else', true, 2000)).toMatchObject({ result: 'locked' })
    expect(decide(store, 'someone-else', true, 1029 + LIMITS.globalLockMs).result).toBe('open')
  })

  it('starts a new window after an hour', () => {
    const store = new MemoryGuardStore()
    for (let i = 0; i < LIMITS.globalMaxFails - 1; i++) decide(store, `ip${i}`, false, 0)
    decide(store, 'x', false, LIMITS.globalWindowMs)
    expect(store.getGlobal().fails).toBe(1)
    expect(decide(store, 'y', true, LIMITS.globalWindowMs + 1).result).toBe('open')
  })
})

describe('cooldown', () => {
  it('waits 5 seconds after the door was opened', () => {
    const store = new MemoryGuardStore()
    expect(decide(store, 'a', true, 100_000).result).toBe('open')
    recordOpen(store, 100_000)
    expect(decide(store, 'b', true, 102_000)).toEqual({ result: 'cooldown', retryAfter: 3 })
    expect(decide(store, 'b', true, 105_000).result).toBe('open')
  })

  it('allows an immediate retry when opening failed (no recordOpen)', () => {
    const store = new MemoryGuardStore()
    expect(decide(store, 'a', true, 100_000).result).toBe('open')
    expect(decide(store, 'a', true, 100_500).result).toBe('open')
  })
})
