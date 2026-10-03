#!/usr/bin/env node
// Lists the devices of your Nuki account with their IDs. Type 2 = Opener.
// Usage: npm run smartlocks        (asks for the token, input is hidden)
//    or: NUKI_API_TOKEN=... npm run smartlocks

import readline from 'node:readline'

/** Asks for the token without echoing it and without leaving it in the shell history. */
function askHidden(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true })
    rl._writeToOutput = (text) => {
      // Print the prompt, hide everything typed afterwards.
      if (text.startsWith(question)) process.stdout.write(question)
    }
    rl.question(question, (answer) => {
      rl.close()
      process.stdout.write('\n')
      resolve(answer)
    })
  })
}

let token = process.env.NUKI_API_TOKEN?.trim()
if (!token && process.stdin.isTTY) token = (await askHidden('Nuki API token: ')).trim()
if (!token) {
  console.error('Please set NUKI_API_TOKEN or run this in a terminal to be asked for it.')
  process.exit(1)
}

const TYPES = { 0: 'Smart Lock 1/2', 2: 'Opener', 3: 'Smart Door', 4: 'Smart Lock 3/4' }

const res = await fetch('https://api.nuki.io/smartlock', {
  headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
})

if (!res.ok) {
  const hint =
    res.status === 401 || res.status === 403
      ? '\nThe token is invalid, was revoked, or lacks the permission to read smartlocks.\n' +
        'Create a new token at https://web.nuki.io -> API and enable the smartlock and smartlock action permissions.'
      : ''
  console.error(`Nuki API answered with HTTP ${res.status}.${hint}`)
  process.exit(1)
}

const devices = await res.json()
if (!devices.length) console.log('The token is valid, but no devices were found in this account.')
for (const d of devices) {
  console.log(`${d.smartlockId}\t${TYPES[d.type] ?? `type ${d.type}`}\t${d.name}`)
}
