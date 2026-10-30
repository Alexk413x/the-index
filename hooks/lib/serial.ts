export type Serial = { running: Promise<void> | null; again: boolean }

export function serial(): Serial {
  return { running: null, again: false }
}

// One run at a time: overlapping runs could land out of order and leave older figures on the band.
// A request during a run queues one more run, however many requests arrive, and waits for it.
export function runSerial(state: Serial, run: () => Promise<void>): Promise<void> {
  if (state.running) {
    state.again = true
    return state.running
  }
  state.running = (async () => {
    try {
      do {
        state.again = false
        await run()
      } while (state.again)
    } finally {
      state.running = null
    }
  })()
  return state.running
}

export function same(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}
