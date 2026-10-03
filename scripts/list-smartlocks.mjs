#!/usr/bin/env node
// Lists the devices of your Nuki account with their IDs. Type 2 = Opener.
// Usage: NUKI_API_TOKEN=your-token npm run smartlocks

const token = process.env.NUKI_API_TOKEN
if (!token) {
  console.error('Please set NUKI_API_TOKEN, e.g.\n  NUKI_API_TOKEN=your-token npm run smartlocks')
  process.exit(1)
}

const TYPES = { 0: 'Smart Lock 1/2', 2: 'Opener', 3: 'Smart Door', 4: 'Smart Lock 3/4' }

const res = await fetch('https://api.nuki.io/smartlock', {
  headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
})

if (!res.ok) {
  const hint =
    res.status === 401 || res.status === 403
      ? ' (token invalid, or missing the permission to read smartlocks)'
      : ''
  console.error(`Nuki API answered with HTTP ${res.status}${hint}`)
  process.exit(1)
}

const devices = await res.json()
if (!devices.length) console.log('No devices found for this token.')
for (const d of devices) {
  console.log(`${d.smartlockId}\t${TYPES[d.type] ?? `type ${d.type}`}\t${d.name}`)
}
