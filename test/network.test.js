'use strict';
// Tests du durcissement SSRF : épinglage d'IP (anti-DNS-rebinding),
// re-validation des redirections, IPv6 et IPv4 mappées, conservation de la
// vérification TLS du nom d'hôte.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const https = require('node:https');
const dnsPromises = require('dns').promises;
const { execFileSync } = require('node:child_process');

process.env.NODE_ENV = 'test';

const network = require('../server/lib/network');
const LLM = require('../server/lib/llm');

/** Remplace temporairement la résolution DNS (rebinding simulé). */
function patchLookup(fn) {
  const original = dnsPromises.lookup;
  dnsPromises.lookup = fn;
  return () => { dnsPromises.lookup = original; };
}

function startServer(handler, host) {
  return new Promise((resolve, reject) => {
    const srv = http.createServer(handler);
    srv.on('error', reject);
    srv.listen(0, host || '127.0.0.1', () => resolve({
      srv,
      port: srv.address().port,
      close: () => new Promise((r) => srv.close(r)),
    }));
  });
}

test('la cible est résolue UNE seule fois et la connexion part vers l\'adresse validée', async () => {
  let calls = 0;
  const restore = patchLookup(async (hostname, opts) => {
    calls += 1;
    const list = [{ address: '127.0.0.1', family: 4 }];
    if (opts && opts.all) return list;
    return list[0];
  });
  const srv = await startServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('hôte=' + req.headers.host);
  });
  try {
    const r = await network.requestOutbound('http://rebinding.test:' + srv.port + '/', { timeoutMs: 5000 });
    const body = await network.readLimited(r.body, 4096);
    assert.equal(r.status, 200);
    assert.match(body, /hôte=rebinding\.test/, 'le nom d\'hôte est conservé dans l\'en-tête Host');
    assert.equal(calls, 1, 'une seule résolution DNS par requête');
  } finally {
    restore();
    await srv.close();
  }
});

test('le rebinding DNS ne peut pas rediriger la requête vers une IP privée', async () => {
  // Première résolution : adresse publique. Résolutions suivantes (rebinding) :
  // adresse privée (métadonnées cloud). Le client ne doit jamais les utiliser.
  let calls = 0;
  const restore = patchLookup(async (hostname, opts) => {
    calls += 1;
    const list = calls === 1 ? [{ address: '127.0.0.1', family: 4 }] : [{ address: '169.254.169.254', family: 4 }];
    if (opts && opts.all) return list;
    return list[0];
  });
  const srv = await startServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('cible-sure');
  });
  try {
    const r = await network.requestOutbound('http://rebinding.test:' + srv.port + '/', { timeoutMs: 5000 });
    const body = await network.readLimited(r.body, 4096);
    assert.equal(body, 'cible-sure', 'la requête atteint la cible validée');
    assert.equal(calls, 1, 'aucune seconde résolution n\'a lieu (pas de fenêtre TOCTOU)');
  } finally {
    restore();
    await srv.close();
  }
});

test('TOUTES les adresses résolues sont validées : une seule adresse privée suffit à rejeter', async () => {
  const restore = patchLookup(async (hostname, opts) => {
    const list = [{ address: '93.184.216.34', family: 4 }, { address: '127.0.0.1', family: 4 }];
    if (opts && opts.all) return list;
    return list[0];
  });
  try {
    await assert.rejects(
      network.requestOutbound('http://mixte.test/', { timeoutMs: 3000 }),
      /privée ou réservée/,
    );
  } finally {
    restore();
  }
});

test('une redirection est re-validée avant d\'être suivie', async () => {
  const srv = await startServer((req, res) => {
    if (req.url === '/vers-interne') { res.writeHead(302, { Location: 'http://169.254.169.254/latest/meta-data' }); res.end(); return; }
    if (req.url === '/depart') { res.writeHead(302, { Location: '/final' }); res.end(); return; }
    if (req.url === '/boucle') { res.writeHead(302, { Location: '/boucle' }); res.end(); return; }
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('final:' + req.url);
  });
  try {
    // Redirection vers une adresse privée : refusée.
    await assert.rejects(
      network.requestOutbound('http://127.0.0.1:' + srv.port + '/vers-interne', { timeoutMs: 3000 }),
      /privée ou réservée/,
    );
    // Redirection légitime : suivie, la cible est re-résolue et re-validée.
    const r = await network.requestOutbound('http://127.0.0.1:' + srv.port + '/depart', { timeoutMs: 3000 });
    const body = await network.readLimited(r.body, 4096);
    assert.equal(body, 'final:/final');
    assert.equal(r.redirects, 1);
    // Boucle de redirections : arrêtée.
    await assert.rejects(
      network.requestOutbound('http://127.0.0.1:' + srv.port + '/boucle', { timeoutMs: 3000, maxRedirects: 2 }),
      /redirections/,
    );
  } finally {
    await srv.close();
  }
});

test('une adresse IPv6 est épinglée comme une IPv4', async () => {
  const srv = await startServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('v6:' + req.headers.host);
  }, '::1');
  const restore = patchLookup(async (hostname, opts) => {
    const list = [{ address: '::1', family: 6 }];
    if (opts && opts.all) return list;
    return list[0];
  });
  try {
    const r = await network.requestOutbound('http://ipv6.test:' + srv.port + '/', { timeoutMs: 5000 });
    const body = await network.readLimited(r.body, 4096);
    assert.equal(r.status, 200);
    assert.match(body, /v6:/);
    assert.match(body, /ipv6\.test/, 'le nom d\'hôte reste inchangé');
  } finally {
    restore();
    await srv.close();
  }
});

test('les adresses IPv4 mappées sont traitées comme des IPv4', () => {
  // Privées ou réservées : refusées, y compris en notation hexadécimale.
  assert.equal(network.isPrivateAddress('::ffff:127.0.0.1'), true);
  assert.equal(network.isPrivateAddress('::ffff:7f00:1'), true);
  assert.equal(network.isPrivateAddress('::ffff:169.254.169.254'), true);
  assert.equal(network.isPrivateAddress('::ffff:a9fe:a9fe'), true);
  // Publiques : autorisées (une IPv4 mappée n\'est pas une IPv6 distante).
  assert.equal(network.isPrivateAddress('::ffff:8.8.8.8'), false);
  assert.equal(network.isPrivateAddress('64:ff9b::7f00:1'), true, 'NAT64 : l\'IPv4 embarquée est privée');
  assert.equal(network.isPrivateAddress('64:ff9b::808:808'), false);
});

test('le nom d\'hôte est conservé pour TLS : SNI et certificat vérifiés', (t) => {
  let openssl = true;
  try { execFileSync('openssl', ['version'], { stdio: 'ignore' }); }
  catch { openssl = false; }
  if (!openssl) { t.skip('openssl indisponible : certificat de test impossible à générer'); return; }

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'novaforge-tls-'));
  const keyFile = path.join(dir, 'key.pem');
  const certFile = path.join(dir, 'cert.pem');
  execFileSync('openssl', [
    'req', '-x509', '-newkey', 'rsa:2048', '-nodes',
    '-keyout', keyFile, '-out', certFile, '-days', '2',
    '-subj', '/CN=localhost', '-addext', 'subjectAltName=DNS:localhost',
  ], { stdio: 'ignore' });

  // NODE_EXTRA_CA_CERTS doit être défini AVANT le démarrage du processus :
  // on lance donc un sous-processus dédié.
  const script = `
    const dns = require('dns').promises;
    const original = dns.lookup;
    dns.lookup = async (host, opts) => {
      const list = [{ address: '127.0.0.1', family: 4 }];
      if (opts && opts.all) return list;
      return list[0];
    };
    const network = require(process.env.NFX_NETWORK);
    const https = require('https');
    const fs = require('fs');
    const srv = https.createServer(
      { key: fs.readFileSync(process.env.NFX_KEY), cert: fs.readFileSync(process.env.NFX_CERT) },
      (q, s) => s.end('tls:' + q.headers.host)
    );
    srv.listen(0, '127.0.0.1', async () => {
      const port = srv.address().port;
      const out = {};
      try {
        const r = await network.requestOutbound('https://localhost:' + port + '/', { allowLoopback: true, timeoutMs: 5000 });
        out.pinned = { status: r.status, body: (await network.readLimited(r.body, 4096)).trim() };
      } catch (e) { out.pinned = { error: e.code || e.message }; }
      try {
        const r = await network.requestOutbound('https://127.0.0.1:' + port + '/', { allowLoopback: true, timeoutMs: 5000 });
        out.byIp = { status: r.status };
      } catch (e) { out.byIp = { error: e.code || e.message }; }
      srv.close();
      process.stdout.write(JSON.stringify(out));
    });
  `;
  const out = JSON.parse(execFileSync(process.execPath, ['-e', script], {
    env: Object.assign({}, process.env, {
      NODE_EXTRA_CA_CERTS: certFile,
      NFX_NETWORK: path.join(__dirname, '..', 'server', 'lib', 'network.js'),
      NFX_KEY: keyFile,
      NFX_CERT: certFile,
    }),
    encoding: 'utf8',
  }));

  // 1) Nom d'hôte conservé : la connexion va à l'IP épinglée, mais le
  //    certificat est vérifié au nom « localhost » → succès.
  assert.equal(out.pinned.status, 200, 'la connexion épinglée conserve le nom d\'hôte : ' + JSON.stringify(out.pinned));
  assert.match(out.pinned.body, /tls:localhost/, 'l\'en-tête Host reste le nom d\'hôte');

  // 2) Certificat non valide pour l'IP : la vérification n\'est PAS désactivée.
  assert.ok(out.byIp.error, 'le certificat doit être refusé pour une adresse IP : ' + JSON.stringify(out.byIp));
  assert.match(out.byIp.error, /CERT|ALTNAME|UNABLE/i);

  fs.rmSync(dir, { recursive: true, force: true });
});

test('readLimited borne la taille de la réponse (flux Node)', async () => {
  const srv = await startServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('x'.repeat(5000));
  });
  try {
    const r = await network.requestOutbound('http://127.0.0.1:' + srv.port + '/', { timeoutMs: 5000 });
    await assert.rejects(network.readLimited(r.body, 1000), /trop volumineuse/);
  } finally {
    await srv.close();
  }
});

test('le streaming SSE passe par le client épinglé', async () => {
  const srv = await startServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    res.write('data: {"choices":[{"delta":{"content":"Bon"}}]}\n\n');
    res.write('data: {"choices":[{"delta":{"content":"jour"}}]}\n\n');
    res.write('data: [DONE]\n\n');
    res.end();
  });
  try {
    const provider = { name: 'local', type: 'custom', base_url: 'http://127.0.0.1:' + srv.port + '/v1', api_key: 'k', models: ['m'] };
    const deltas = [];
    const res = await LLM.streamChat(provider, {
      messages: [{ role: 'user', content: 'salut' }],
      onDelta: (t) => deltas.push(t),
    });
    assert.equal(res.ok, true, res.error || '');
    assert.equal(res.content, 'Bonjour');
    assert.deepEqual(deltas, ['Bon', 'jour'], 'les fragments arrivent dans l\'ordre');
  } finally {
    await srv.close();
  }
});

test('le délai d\'attente couvre aussi la lecture du corps', async () => {
  const srv = await startServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.write('début');
    // ...et jamais de fin : le corps reste ouvert.
  });
  try {
    const r = await network.requestOutbound('http://127.0.0.1:' + srv.port + '/', { timeoutMs: 400 });
    await assert.rejects(network.readLimited(r.body, 1024 * 1024));
  } finally {
    await srv.close();
  }
});
