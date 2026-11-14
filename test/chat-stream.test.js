'use strict';
// Tests de bout en bout des points d'entrée de chat :
//  • le mode JSON historique reste disponible (aucune régression) ;
//  • le mode streaming SSE diffuse la réponse par fragments puis la réponse finale ;
//  • le moteur local NovaCore reste utilisable sans fournisseur IA.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'novaforge-chat-test-'));
process.env.NOVAFORGE_DATA_DIR = dataDir;
process.env.NODE_ENV = 'test';

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const port = srv.address().port;
      srv.close(() => resolve(port));
    });
  });
}

/** Lit un flux SSE et renvoie la liste des trames {event, data}. */
async function readEvents(res) {
  const out = [];
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let idx;
    while ((idx = buf.indexOf('\n\n')) !== -1) {
      const frame = buf.slice(0, idx);
      buf = buf.slice(idx + 2);
      let event = '';
      const data = [];
      for (const line of frame.split('\n')) {
        if (line.startsWith('event:')) event = line.slice(6).trim();
        else if (line.startsWith('data:')) data.push(line.slice(5).replace(/^ /, ''));
      }
      if (!data.length) continue;
      let parsed = null;
      try { parsed = JSON.parse(data.join('\n')); } catch { parsed = data.join('\n'); }
      out.push({ event: event || 'message', data: parsed });
    }
  }
  return out;
}

let base = '';
let cookie = '';

test.before(async () => {
  let rejectBoot;
  const port = await freePort();
  process.env.PORT = String(port);
  const app = require('../server/app.js');
  const timer = setTimeout(() => rejectBoot(new Error('Le serveur n’a pas démarré.')), 20000);
  if (timer.unref) timer.unref();
  await new Promise((resolve, reject) => {
    rejectBoot = reject;
    if (app.server.listening) return resolve();
    app.server.once('listening', resolve);
    app.server.once('error', reject);
  });
  clearTimeout(timer);
  base = 'http://127.0.0.1:' + port;

  const res = await fetch(base + '/api/v1/setup', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'test@novaforge.local', password: 'MotDePasse1' }),
  });
  assert.equal(res.status, 200);
  cookie = (res.headers.get('set-cookie') || '').split(';')[0];
  assert.ok(cookie, 'une session doit être créée');
});

test.after(() => {
  try {
    const app = require('../server/app.js');
    if (app.server.closeAllConnections) app.server.closeAllConnections();
    app.server.close();
    if (app.server.unref) app.server.unref();
  } catch { /* ignore */ }
  fs.rmSync(dataDir, { recursive: true, force: true });
});

test('POST /api/v1/assistant/chat conserve le mode JSON classique', async () => {
  const res = await fetch(base + '/api/v1/assistant/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({ message: 'Bonjour' }),
  });
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /application\/json/);
  const d = await res.json();
  assert.equal(typeof d.reply, 'string');
  assert.ok(d.reply.length > 0);
  assert.ok(Array.isArray(d.actions));
  assert.equal(typeof d.conversation_id, 'number');
  assert.equal(d.provider, false); // aucun fournisseur IA : moteur local NovaCore
});

test('POST /api/v1/assistant/chat en streaming SSE diffuse les fragments puis la réponse finale', async () => {
  const res = await fetch(base + '/api/v1/assistant/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream', Cookie: cookie },
    body: JSON.stringify({ message: 'Bonjour', stream: true }),
  });
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /text\/event-stream/);

  const events = await readEvents(res);
  const deltas = events.filter((e) => e.event === 'delta');
  assert.ok(deltas.length > 1, 'la réponse doit arriver par fragments');
  assert.ok(deltas.every((e) => typeof e.data.text === 'string'));

  const done = events.find((e) => e.event === 'done');
  assert.ok(done, 'un événement « done » doit clore le flux');
  assert.equal(typeof done.data.reply, 'string');
  assert.ok(done.data.reply.length > 0);
  assert.equal(typeof done.data.conversation_id, 'number');
  assert.ok(events.every((e) => e.event !== 'error'), 'aucune erreur ne doit être émise');
});

test('un flux interrompu par le client se termine proprement', async () => {
  const ctrl = new AbortController();
  const res = await fetch(base + '/api/v1/assistant/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream', Cookie: cookie },
    body: JSON.stringify({ message: 'Explique-moi NovaForge en détail', stream: true }),
    signal: ctrl.signal,
  });
  assert.equal(res.status, 200);
  const reader = res.body.getReader();
  await reader.read();
  ctrl.abort();
  await reader.cancel().catch(() => {});
  // Le serveur ne doit pas planter : une nouvelle requête fonctionne toujours.
  const again = await fetch(base + '/api/v1/assistant/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({ message: 'Bonjour' }),
  });
  assert.equal(again.status, 200);
});
