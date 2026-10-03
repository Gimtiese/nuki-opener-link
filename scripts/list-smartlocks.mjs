#!/usr/bin/env node
// Lists the devices of your Nuki account with their IDs. Type 2 = Opener.
// Usage: npm run smartlocks        (asks for the token, input is hidden)
//    or: NUKI_API_TOKEN=... npm run smartlocks

import { askHidden, deviceLabel, fetchSmartlocks } from './lib.mjs'

let token = process.env.NUKI_API_TOKEN?.trim()
if (!token && process.stdin.isTTY) token = await askHidden('Nuki API token')
if (!token) {
  console.error('Please set NUKI_API_TOKEN or run this in a terminal to be asked for it.')
  process.exit(1)
}

const result = await fetchSmartlocks(token)
if (!result.ok) {
  const hint =
    result.status === 401 || result.status === 403
      ? '\nThe token is invalid, was revoked, or lacks the permission to read smartlocks.\n' +
        'Create a new token at https://web.nuki.io -> API and enable the smartlock and smartlock action permissions.'
      : ''
  console.error(`Nuki API answered with HTTP ${result.status}.${hint}`)
  process.exit(1)
}

if (!result.devices.length) console.log('The token is valid, but no devices were found in this account.')
for (const d of result.devices) console.log(`${d.smartlockId}\t${deviceLabel(d)}\t${d.name}`)
