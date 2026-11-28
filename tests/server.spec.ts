import { randomBytes } from 'node:crypto'
import { afterEach, describe, expect, it } from 'vitest'
import { startServer } from '../src/worker/server.ts'

/** Servers opened by one test, closed afterwards so a failure cannot leak a listener. */
const opened: { close: () => void }[] = []

afterEach(() => {
  for (const server of opened.splice(0)) server.close()
})

/**
 * Open a worker listener that answers nothing.
 * @returns the port it bound.
 */
async function open(): Promise<number> {
  const { server, port } = await startServer(randomBytes(32).toString('hex'), 1024, () => ({
    text: '',
    blocks: 0,
    audioSeconds: 0,
    speechSeconds: 0,
    inferenceSeconds: 0,
  }))
  opened.push(server)
  return port
}

describe('worker listener', () => {
  it('binds above the band everyday services occupy', async () => {
    const port = await open()
    // 3000, 5432, 6379, 8000, 8080, 8888 and the 20 000s all sit below the floor.
    expect(port).toBeGreaterThanOrEqual(30_000)
  })

  it('never leaves a listener behind when a port is rejected', async () => {
    // Two listeners coexist because each binds a distinct port; neither may fall back to the other.
    const ports = new Set([await open(), await open(), await open()])
    expect(ports.size).toBe(3)
    for (const port of ports) expect(port).toBeGreaterThanOrEqual(30_000)
  })

  it('gives each worker its own port, so two models never share a listener', async () => {
    const first = await open()
    const second = await open()
    expect(first).not.toBe(second)
  })

  it('listens on loopback only', async () => {
    const { server, port } = await startServer(randomBytes(32).toString('hex'), 1024, () => ({
      text: '',
      blocks: 0,
      audioSeconds: 0,
      speechSeconds: 0,
      inferenceSeconds: 0,
    }))
    opened.push(server)
    const address = server.address()
    expect(typeof address).not.toBe('string')
    if (address === null || typeof address === 'string') throw new Error('listener has no address')
    expect(address.address).toBe('127.0.0.1')
    expect(address.port).toBe(port)
  })
})
