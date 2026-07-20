const net = require('net');
const { importUrls } = require('./importUrls');

const DEFAULT_PORT = 28430;
const MAX_URLS = 50;

let server = null;

const VALIDATORS = {
  'drop-url': (msg) => {
    if (!Array.isArray(msg.urls)) return 'urls must be an array';
    if (msg.urls.length === 0) return 'urls must not be empty';
    if (msg.urls.length > MAX_URLS) return `urls exceeds maximum batch size of ${MAX_URLS}`;
    for (const u of msg.urls) {
      if (typeof u !== 'string') return 'each URL must be a string';
      if (!/^https?:\/\//i.test(u)) return `rejected non-http URL: ${u}`;
    }
    return null;
  },
};

const HANDLERS = {
  'drop-url': async (msg) => {
    const result = await importUrls(msg.urls);
    return { ok: true, count: result.records.length, records: result.records, errors: result.errors };
  },
};

function start(port) {
  if (server) return;
  const actualPort = port || DEFAULT_PORT;

  server = net.createServer((socket) => {
    let buffer = '';

    socket.on('data', async (chunk) => {
      buffer += chunk.toString('utf8');
      const lines = buffer.split('\n');
      buffer = lines.pop();

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;

        const startTime = Date.now();
        let msg = null;
        let response;

        try {
          msg = JSON.parse(trimmed);
          const handler = HANDLERS[msg.type];
          if (!handler) {
            response = { ok: false, error: `unknown command: ${msg.type}` };
          } else {
            const validationError = VALIDATORS[msg.type] ? VALIDATORS[msg.type](msg) : null;
            if (validationError) {
              response = { ok: false, error: validationError };
            } else {
              try {
                response = await handler(msg);
              } catch (err) {
                response = { ok: false, error: err.message || String(err) };
              }
            }
          }
        } catch (err) {
          response = { ok: false, error: `invalid JSON: ${err.message}` };
        }

        const duration = Date.now() - startTime;
        console.log(`[nativeBridge] type=${msg ? msg.type : '?'} duration=${duration}ms ok=${response.ok}`);
        socket.write(JSON.stringify(response) + '\n');
      }
    });

    socket.on('error', (err) => {
      console.error('[nativeBridge] socket error:', err.message);
    });
  });

  server.on('error', (err) => {
    console.error('[nativeBridge] server error:', err.message);
  });

  server.listen(actualPort, '127.0.0.1', () => {
    console.log(`[nativeBridge] listening on 127.0.0.1:${actualPort}`);
  });
}

function stop() {
  if (server) {
    server.close();
    server = null;
    console.log('[nativeBridge] stopped');
  }
}

module.exports = { start, stop };
