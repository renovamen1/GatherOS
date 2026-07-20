#!/usr/bin/env node

const net = require('net');

const BRIDGE_HOST = process.env.GATHEROS_BRIDGE_HOST || '127.0.0.1';
const BRIDGE_PORT = parseInt(process.env.GATHEROS_BRIDGE_PORT || '28430', 10);

let client = null;
let messageBuffer = '';

function connect() {
  if (client && !client.destroyed) return;

  client = new net.Socket();

  client.connect(BRIDGE_PORT, BRIDGE_HOST, () => {
    console.error('[native-host] connected to GatherOS bridge');
  });

  client.on('data', (data) => {
    messageBuffer += data.toString('utf8');
    const lines = messageBuffer.split('\n');
    messageBuffer = lines.pop();

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const parsed = JSON.parse(trimmed);
        writeToChrome(parsed);
      } catch (err) {
        writeToChrome({ ok: false, error: `bridge response parse failed: ${err.message}` });
      }
    }
  });

  client.on('error', (err) => {
    console.error('[native-host] bridge connection error:', err.message);
    client.destroy();
    client = null;
  });

  client.on('close', () => {
    console.error('[native-host] bridge connection closed');
    client = null;
    setTimeout(connect, 2000);
  });
}

function writeToChrome(obj) {
  const json = JSON.stringify(obj);
  const buf = Buffer.from(json, 'utf8');
  const header = Buffer.alloc(4);
  header.writeUInt32LE(buf.length, 0);
  process.stdout.write(header);
  process.stdout.write(buf);
}

function writeError(code, detail) {
  writeToChrome({ ok: false, error: `${code}: ${detail}` });
}

process.stdin.on('readable', () => {
  let header = null;
  while ((header = process.stdin.read(4)) !== null) {
    const length = header.readUInt32LE(0);
    if (length === 0) continue;
    const body = process.stdin.read(length);
    if (body) {
      let msg;
      try {
        msg = JSON.parse(body.toString('utf8'));
      } catch (err) {
        writeError('PARSE_ERROR', err.message);
        continue;
      }

      if (!client || client.destroyed) {
        writeError('NOT_CONNECTED', 'GatherOS is not running');
        connect();
        continue;
      }

      client.write(JSON.stringify(msg) + '\n');
    }
  }
});

process.stdin.on('end', () => {
  if (client) client.end();
  process.exit(0);
});

process.stdin.on('error', (err) => {
  console.error('[native-host] stdin error:', err.message);
  if (client) client.end();
  process.exit(1);
});

connect();
