/**
 * Authenticated loopback transport for one serial recognizer.
 *
 * The worker binds an ephemeral port, publishes it on stdout, and accepts one request at a
 * time. The bearer secret arrives through the environment and never appears in argv.
 */
import { timingSafeEqual } from 'node:crypto'
import { createServer, type Server } from 'node:http'

/** Reply shape returned by the worker. */
export interface WorkerReply {
  readonly text: string
  readonly blocks: number
  readonly audioSeconds: number
  readonly speechSeconds?: number
  readonly inferenceSeconds: number
}

/** Handler the server delegates to. */
export type WorkerHandler = (audio: Buffer) => WorkerReply | Promise<WorkerReply>

/**
 * Lowest port the worker accepts.
 *
 * Everyday services cluster far below this: 3000, 5173, 5432, 6379, 8000, 8080, 8888, 9000, and
 * transient clients usually draw from the 20 000s as well. Starting the worker above 30 000 keeps it
 * clear of both bands, which costs nothing because the kernel still chooses the exact port.
 */
const MIN_WORKER_PORT = 30_000

/**
 * Times to ask the kernel for a port before giving up.
 *
 * The bind asks for port 0, so the kernel answers with a free one and a collision cannot happen.
 * The retry exists for the other case: a system whose ephemeral range starts below
 * {@link MIN_WORKER_PORT} would otherwise leave the worker holding a port in the crowded band.
 */
const MAX_PORT_ATTEMPTS = 8

/**
 * Start the loopback listener.
 * @param token - per-process bearer secret.
 * @param maxAudioBytes - largest accepted request body.
 * @param handle - synchronous decode owned by this process.
 * @returns the listening server and its port.
 */
export async function startServer(token: string, maxAudioBytes: number, handle: WorkerHandler): Promise<{ server: Server; port: number }> {
  const expected = Buffer.from(`Bearer ${token}`)
  const server = createServer((request, response) => {
    const reply = (status: number, value: object): void => {
      response.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(value))
    }
    const authorization = Buffer.from(request.headers.authorization ?? '')
    if (authorization.length !== expected.length || !timingSafeEqual(authorization, expected)) {
      request.resume()
      reply(401, { error: 'Unauthorized' })
      return
    }
    const url = new URL(request.url ?? '/', 'http://127.0.0.1')
    if (request.method !== 'POST' || url.pathname !== '/transcribe') {
      request.resume()
      reply(404, { error: 'Unknown endpoint' })
      return
    }
    const length = Number(request.headers['content-length'])
    if (!Number.isSafeInteger(length) || length < 46 || length > maxAudioBytes) {
      request.resume()
      reply(413, { error: 'Invalid speech audio size', code: 'invalid-input' })
      return
    }
    void (async () => {
      try {
        const chunks: Buffer[] = []
        for await (const chunk of request) chunks.push(chunk as Buffer)
        reply(200, await handle(Buffer.concat(chunks)))
      } catch (error) {
        reply(400, {
          error: error instanceof Error ? error.message : String(error),
          code: 'invalid-input',
        })
      }
    })()
  })
  const port = await bindAbove(server, MIN_WORKER_PORT)
  return { server, port }
}

/**
 * Bind the server to a free loopback port above a floor.
 *
 * Port 0 hands the choice to the kernel, which is the only way to be certain the port is free at
 * the moment of binding. If the kernel answers with something inside the crowded band, the socket is
 * released and the request is repeated, so the result is both free and out of the way.
 * @param server - the listener to bind.
 * @param floor - lowest acceptable port.
 * @returns the bound port.
 * @throws when no acceptable port could be obtained.
 */
async function bindAbove(server: Server, floor: number): Promise<number> {
  for (let attempt = 1; attempt <= MAX_PORT_ATTEMPTS; attempt += 1) {
    await new Promise<void>((resolve, reject) => {
      const failed = (error: Error): void => {
        server.off('listening', listening)
        server.off('error', failed)
        reject(error)
      }
      const listening = (): void => {
        server.off('error', failed)
        server.off('listening', listening)
        resolve()
      }
      server.once('error', failed)
      server.once('listening', listening)
      server.listen(0, '127.0.0.1')
    }).catch((error: unknown) => {
      // A port that was taken between the kernel's answer and the bind is retried, not surfaced.
      if (attempt === MAX_PORT_ATTEMPTS) throw error
    })
    if (!server.listening) continue
    const address = server.address()
    if (address === null || typeof address === 'string') {
      server.close()
      throw new Error('speech-multi worker could not bind a loopback port')
    }
    if (address.port >= floor) return address.port
    await new Promise<void>((resolve) => {
      server.close(() => {
        resolve()
      })
    })
  }
  throw new Error(`speech-multi worker could not obtain a loopback port at or above ${floor}`)
}
