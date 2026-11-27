/**
 * Authenticated loopback transport for one serial recognizer.
 *
 * The worker binds an ephemeral port, publishes it on stdout, and accepts one request at a
 * time. The bearer secret arrives through the environment and never appears in argv.
 */
import { timingSafeEqual } from 'node:crypto';
import { createServer } from 'node:http';
/**
 * Start the loopback listener.
 * @param token - per-process bearer secret.
 * @param maxAudioBytes - largest accepted request body.
 * @param handle - synchronous decode owned by this process.
 * @returns the listening server and its port.
 */
export async function startServer(token, maxAudioBytes, handle) {
    const expected = Buffer.from(`Bearer ${token}`);
    const server = createServer((request, response) => {
        const reply = (status, value) => {
            response.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(value));
        };
        const authorization = Buffer.from(request.headers.authorization ?? '');
        if (authorization.length !== expected.length || !timingSafeEqual(authorization, expected)) {
            request.resume();
            reply(401, { error: 'Unauthorized' });
            return;
        }
        const url = new URL(request.url ?? '/', 'http://127.0.0.1');
        if (request.method !== 'POST' || url.pathname !== '/transcribe') {
            request.resume();
            reply(404, { error: 'Unknown endpoint' });
            return;
        }
        const length = Number(request.headers['content-length']);
        if (!Number.isSafeInteger(length) || length < 46 || length > maxAudioBytes) {
            request.resume();
            reply(413, { error: 'Invalid speech audio size', code: 'invalid-input' });
            return;
        }
        void (async () => {
            try {
                const chunks = [];
                for await (const chunk of request)
                    chunks.push(chunk);
                reply(200, await handle(Buffer.concat(chunks)));
            }
            catch (error) {
                reply(400, {
                    error: error instanceof Error ? error.message : String(error),
                    code: 'invalid-input',
                });
            }
        })();
    });
    await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', () => {
            server.off('error', reject);
            resolve();
        });
    });
    const address = server.address();
    if (address === null || typeof address === 'string')
        throw new Error('speech-multi worker could not bind a loopback port');
    return { server, port: address.port };
}
//# sourceMappingURL=server.js.map