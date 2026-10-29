import { describe, expect, test } from 'claude-code/testing'

import { runSerial, same, serial } from '../hooks/lib/serial'

function gate() {
  let open = () => {}
  const opened = new Promise<void>(resolve => {
    open = resolve
  })
  return { opened, open }
}

describe('runSerial', () => {
  test('requests during a run queue one more run, however many arrive', async () => {
    const state = serial()
    const first = gate()
    let runs = 0
    let atOnce = 0
    let most = 0
    const run = async () => {
      runs += 1
      atOnce += 1
      most = Math.max(most, atOnce)
      if (runs === 1) await first.opened
      atOnce -= 1
    }
    const started = runSerial(state, run)
    const queued = [runSerial(state, run), runSerial(state, run), runSerial(state, run)]
    first.open()
    await Promise.all([started, ...queued])
    expect(runs).toBe(2)
    expect(most).toBe(1)
  })

  test('a caller that arrives during a run waits until the queued run ends', async () => {
    const state = serial()
    const first = gate()
    const order: string[] = []
    let runs = 0
    const run = async () => {
      runs += 1
      if (runs === 1) await first.opened
      order.push(`run ${runs}`)
    }
    void runSerial(state, run)
    const waiting = runSerial(state, run).then(() => order.push('caller'))
    first.open()
    await waiting
    expect(order).toEqual(['run 1', 'run 2', 'caller'])
  })

  test('a run that throws frees the state for the next request', async () => {
    const state = serial()
    await expect(
      runSerial(state, async () => {
        throw new Error('git failed')
      }),
    ).rejects.toThrow('git failed')
    let ran = false
    await runSerial(state, async () => {
      ran = true
    })
    expect(ran).toBe(true)
  })
})

describe('same', () => {
  test('compares plain data by value', () => {
    expect(same({ a: [1, 2] }, { a: [1, 2] })).toBe(true)
    expect(same({ a: [1, 2] }, { a: [2, 1] })).toBe(false)
    expect(same(null, null)).toBe(true)
  })
})
