<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { openDoor, type OpenResult } from './api'
import { contacts, PIN_STORAGE_KEY, siteTitle, turnstileSiteKey } from './config'
import { fill, formatDuration, getMessages, resolveLocale } from './i18n'
import { createTurnstile, type Turnstile } from './turnstile'

type State = 'idle' | 'loading' | 'success' | 'error'

const locale = resolveLocale(import.meta.env.VITE_LOCALE, navigator.languages ?? [navigator.language])
const t = getMessages(locale)
const title = siteTitle ?? t.title

const pin = ref('')
const hasSavedPin = ref(false)
const state = ref<State>('idle')
const message = ref('')
const captchaBox = ref<HTMLElement | null>(null)
let turnstile: Turnstile | undefined
let resetTimer: ReturnType<typeof setTimeout> | undefined

function readSavedPin(): string {
  try {
    return localStorage.getItem(PIN_STORAGE_KEY) ?? ''
  } catch {
    return ''
  }
}

function savePin(value: string) {
  try {
    if (value) localStorage.setItem(PIN_STORAGE_KEY, value)
    else localStorage.removeItem(PIN_STORAGE_KEY)
  } catch {
    /* storage unavailable (e.g. private mode): the PIN just has to be typed again */
  }
}

onMounted(() => {
  document.title = title
  if (turnstileSiteKey && captchaBox.value) turnstile = createTurnstile(turnstileSiteKey, captchaBox.value, locale)

  // A link like https://door.example.com/#pin=123456 pre-fills the PIN.
  // The fragment is never sent to a server; it is removed from the address bar right away.
  const fromLink = new URLSearchParams(location.hash.slice(1)).get('pin')?.trim()
  if (fromLink) {
    savePin(fromLink)
    history.replaceState(null, '', location.pathname + location.search)
  }

  const saved = readSavedPin()
  if (saved) {
    pin.value = saved
    hasSavedPin.value = true
  }
})

onBeforeUnmount(() => clearTimeout(resetTimer))

const canOpen = computed(() => state.value !== 'loading' && pin.value.trim().length > 0)

function forgetPin() {
  savePin('')
  hasSavedPin.value = false
  pin.value = ''
}

function messageFor(result: OpenResult): string {
  switch (result.status) {
    case 'ok':
      return t.success
    case 'wrong_pin':
      return t.wrongPin
    case 'locked':
      return fill(t.locked, { time: formatDuration(t, result.retryAfter) })
    case 'cooldown':
      return t.cooldown
    case 'rate_limited':
      return fill(t.rateLimited, { time: formatDuration(t, result.retryAfter) })
    case 'closed':
      return fill(t.closed, { hours: result.openHours })
    case 'captcha_failed':
      return t.captchaFailed
    default:
      return t.failed
  }
}

async function open() {
  if (!canOpen.value) return
  const value = pin.value.trim()
  clearTimeout(resetTimer)
  state.value = 'loading'
  message.value = ''

  let result: OpenResult
  if (turnstile) {
    const token = await turnstile.token()
    result = token ? await openDoor(value, token) : { status: 'captcha_failed' }
    turnstile.reset() // tokens are single-use
  } else {
    result = await openDoor(value)
  }

  message.value = messageFor(result)
  state.value = result.status === 'ok' ? 'success' : 'error'
  if (result.status === 'ok') {
    savePin(value)
    hasSavedPin.value = true
    resetTimer = setTimeout(() => {
      state.value = 'idle'
      message.value = ''
    }, 8000)
  } else if (result.status === 'wrong_pin') {
    forgetPin()
  }
}

function changePin() {
  forgetPin()
  state.value = 'idle'
  message.value = ''
}
</script>

<template>
  <main>
    <header>
      <h1>{{ title }}</h1>
      <p class="lead">{{ t.lead }}</p>
    </header>

    <form @submit.prevent="open">
      <div v-if="!hasSavedPin" class="field">
        <label for="pin">{{ t.pin }}</label>
        <input
          id="pin"
          v-model="pin"
          type="password"
          inputmode="numeric"
          autocomplete="off"
          autocapitalize="off"
          :placeholder="t.pinPlaceholder"
        />
      </div>

      <div ref="captchaBox" class="captcha"></div>

      <button type="submit" class="open" :class="state" :disabled="!canOpen">
        <template v-if="state === 'loading'">{{ t.opening }}</template>
        <template v-else-if="state === 'success'">{{ t.opened }}</template>
        <template v-else>{{ t.open }}</template>
      </button>

      <p v-if="message" class="message" :class="state" role="status">{{ message }}</p>

      <button v-if="hasSavedPin" type="button" class="link" @click="changePin">{{ t.changePin }}</button>
    </form>

    <footer v-if="contacts.length">
      <p>{{ t.problems }}</p>
      <ul>
        <li v-for="c in contacts" :key="c.href">
          <a :href="c.href">📞 {{ c.label ? `${c.label}: ` : '' }}{{ c.phone }}</a>
        </li>
      </ul>
    </footer>
  </main>
</template>
