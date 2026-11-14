'use strict';
// Tests de la passerelle de paiement automatisée (server/lib/payments.js).
// Couvre : signature des webhooks, test de connexion réel, initialisation de
// paiement, idempotence, activation automatique de l'offre, comptabilité
// brut / commission / net, et non-divulgation des secrets.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const crypto = require('node:crypto');

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'novaforge-pay-test-'));
process.env.NOVAFORGE_DATA_DIR = dataDir;
process.env.NODE_ENV = 'test';

const PAY = require('../server/lib/payments');
const db = require('../server/lib/db');
const A = require('../server/lib/auth');

/** Petit serveur HTTP local qui tient lieu de passerelle pendant les tests. */
function startServer(handler) {
  return new Promise((resolve) => {
    const srv = http.createServer(handler);
    srv.listen(0, '127.0.0.1', () => resolve({
      srv,
      base: 'http://127.0.0.1:' + srv.address().port,
      close: () => new Promise((r) => srv.close(r)),
    }));
  });
}

function makeUser(email) {
  return A.users().insert({
    email, password: A.hashPassword('MotDePasse1!'), role: 'user',
    plan_id: 'free', display_name: email.split('@')[0], blocked: false,
  });
}

function makePlan(id, price) {
  return db.table('plans').insert({
    id, name: id, price, period: 'month',
    creations_per_day: 10, apps_per_day: 2, priority: 1, features: [],
  });
}

/** Paiement « en cours » enregistré directement (sans appel à la passerelle). */
function makePayment(gw, user, plan, over) {
  const tx = 'nfx_' + Math.random().toString(36).slice(2, 10);
  return PAY.payments().insert(Object.assign({
    user_id: user.id, plan_id: plan.id, method: 'gateway',
    gateway_id: gw.id, gateway_type: gw.type,
    reference: tx, tx_ref: tx, gateway_payment_id: '4242',
    checkout_url: 'https://checkout.test/' + tx,
    amount: 20, currency: 'USD', gross: 20, commission: 2, net: 18,
    idempotency_key: gw.id + ':' + user.id + ':' + plan.id,
    status: 'pending', admin_note: '',
  }, over || {}));
}

test('la signature HMAC du webhook est vérifiée sur le corps brut', () => {
  const cfg = { webhook_scheme: 'hmac_sha256', webhook_header: 'x-signature', webhook_encoding: 'hex', webhook_prefix: '' };
  const gw = { secret: 'sec', webhook_secret: 'hook' };
  const body = Buffer.from('{"event":"charge.completed"}');
  const sig = crypto.createHmac('sha256', 'hook').update(body).digest('hex');

  assert.equal(PAY.verifySignature(cfg, gw, body, sig), true, 'la bonne signature doit passer');
  assert.equal(PAY.verifySignature(cfg, gw, body, sig.slice(0, -1) + '0'), false, 'une signature altérée doit échouer');
  assert.equal(PAY.verifySignature(cfg, gw, body, ''), false, 'une signature absente doit échouer');
  assert.equal(PAY.verifySignature(cfg, gw, Buffer.from('autre corps'), sig), false, 'la signature ne vaut pas pour un autre corps');
});

test('la signature HMAC accepte l\'encodage base64 et un préfixe', () => {
  const cfg = { webhook_scheme: 'hmac_sha256', webhook_header: 'x-signature', webhook_encoding: 'base64', webhook_prefix: 'sha256=' };
  const gw = { secret: 'sec', webhook_secret: 'hook' };
  const body = Buffer.from('{"a":1}');
  const sig = 'sha256=' + crypto.createHmac('sha256', 'hook').update(body).digest('base64');
  assert.equal(PAY.verifySignature(cfg, gw, body, sig), true);
});

test('l\'en-tête verif-hash de Flutterwave est comparé au secret configuré', () => {
  const cfg = { webhook_scheme: 'plain', webhook_header: 'verif-hash' };
  const gw = { secret: 'FLWSECK_TEST-1', webhook_secret: 'hash-value' };
  const body = Buffer.from('{"event":"charge.completed"}');

  assert.equal(PAY.verifySignature(cfg, gw, body, 'hash-value'), true);
  assert.equal(PAY.verifySignature(cfg, gw, body, 'hash-valuf'), false);
  assert.equal(PAY.verifySignature(cfg, gw, body, ''), false);
});

test('aucun webhook n\'est accepté sans secret de signature', () => {
  const cfg = { webhook_scheme: 'hmac_sha256', webhook_header: 'x-signature', webhook_encoding: 'hex' };
  assert.equal(PAY.verifySignature(cfg, { secret: '', webhook_secret: '' }, Buffer.from('{}'), 'abc'), false);
});

test('la comptabilité brut / commission / net applique le taux de 10 %', () => {
  const s = PAY.computeSplit(20);
  assert.equal(s.gross, 20);
  assert.equal(s.commission, 2);
  assert.equal(s.net, 18);

  const r = PAY.computeSplit(19.99);
  assert.equal(r.commission, 2, 'arrondi au centime comme la saisie manuelle');
  assert.equal(r.net, 17.99);
});

test('les secrets ne sont jamais renvoyés en clair', () => {
  const res = PAY.createGateway({
    name: 'Passerelle de test', type: 'flutterwave',
    secret: 'FLWSECK_TEST-super-secret', base_url: 'https://api.flutterwave.com/v3',
  });
  assert.equal(res.ok, true);

  const dump = JSON.stringify(PAY.listGateways());
  assert.equal(dump.includes('super-secret'), false, 'la clé secrète ne doit pas figurer dans la liste');
  assert.equal(dump.includes('FLWSECK_TEST-super-secret'), false);

  const g = PAY.listGateways()[0];
  assert.equal(g.has_secret, true);
  assert.ok(g.secret_hint.length < 'FLWSECK_TEST-super-secret'.length, 'seule une empreinte tronquée est exposée');
  assert.equal(g.status, 'unconfigured', 'une passerelle est « non configurée » tant qu\'elle n\'est pas testée');
});

test('l\'adaptateur générique refuse de démarrer sans contrat décrit', () => {
  const res = PAY.createGateway({ name: 'Candy', type: 'candy', secret: 's', base_url: 'https://gateway.example' });
  assert.equal(res.ok, false);
  assert.match(res.error, /chemin de création/i);

  const res2 = PAY.createGateway({
    name: 'Candy', type: 'candy', secret: 's', base_url: 'https://gateway.example',
    config: { create_path: '/payments', test_path: '/health' },
  });
  assert.equal(res2.ok, true, 'un contrat complet est accepté');
});

test('le test de connexion exige un appel réel et ne déclare « active » qu\'au succès', async () => {
  const calls = [];
  const srv = await startServer((req, res) => {
    calls.push(req.url);
    if (req.url.includes('/unauthorized')) { res.writeHead(401); res.end('{"status":"error","message":"Invalid auth key"}'); return; }
    res.writeHead(404); res.end('{"status":"error","message":"No transaction was found for this id"}');
  });
  try {
    const bad = PAY.createGateway({ name: 'Bad', type: 'flutterwave', secret: 'wrong', base_url: srv.base + '/v3', config: { test_path: '/unauthorized' } });
    const r1 = await PAY.testGateway(bad.gateway.id);
    assert.equal(r1.ok, false, 'une clé refusée ne passe pas');
    assert.equal(PAY.getGateway(bad.gateway.id).status, 'error');

    const good = PAY.createGateway({ name: 'Good', type: 'flutterwave', secret: 'FLWSECK_TEST-ok', base_url: srv.base + '/v3', config: { test_path: '/transactions/0/verify' } });
    const r2 = await PAY.testGateway(good.gateway.id);
    assert.equal(r2.ok, true, 'un appel réussi (transaction absente = 404 attendu) passe le test');
    assert.equal(PAY.getGateway(good.gateway.id).status, 'active');

    // Sans identifiants marchands : aucune requête, statut « non configurée ».
    const none = PAY.createGateway({ name: 'None', type: 'flutterwave', secret: 'k', base_url: srv.base + '/v3' });
    PAY.gateways().update(none.gateway.id, { secret: '' });
    const before = calls.length;
    const r3 = await PAY.testGateway(none.gateway.id);
    assert.equal(r3.ok, false);
    assert.equal(PAY.getGateway(none.gateway.id).status, 'unconfigured');
    assert.equal(calls.length, before, 'aucun appel ne part sans identifiants marchands');
  } finally {
    await srv.close();
  }
});

test('l\'initialisation de paiement envoie le contrat officiel et calcule la comptabilité', async () => {
  let received = null;
  const srv = await startServer((req, res) => {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      received = { url: req.url, auth: req.headers.authorization, body: JSON.parse(raw || '{}') };
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        status: 'success',
        data: { id: 987654, link: 'https://checkout.flutterwave.test/pay/987654', tx_ref: received.body.tx_ref, amount: received.body.amount },
      }));
    });
  });
  try {
    const gw = PAY.createGateway({ name: 'FW', type: 'flutterwave', secret: 'FLWSECK_TEST-x', base_url: srv.base + '/v3', currency: 'USD' }).gateway;
    const user = makeUser('client@example.com');
    const plan = makePlan('premium_test', 20);

    const res = await PAY.createCheckout({
      user, plan, gateway: gw, baseUrl: 'https://novaforge.test',
      callbackUrl: 'https://novaforge.test/api/v1/payments/webhook/' + gw.id,
    });
    assert.equal(res.ok, true, res.error || '');
    assert.equal(res.payment.checkout_url, 'https://checkout.flutterwave.test/pay/987654');
    assert.equal(res.payment.amount, 20);
    assert.equal(res.payment.currency, 'USD');
    assert.equal(res.payment.gross, 20);
    assert.equal(res.payment.commission, 2, 'commission de 10 %');
    assert.equal(res.payment.net, 18);
    assert.equal(res.payment.status, 'pending');

    // Contrat officiel : POST sur /v3/payments, Bearer, tx_ref / amount / devise…
    assert.equal(received.url, '/v3/payments');
    assert.equal(received.auth, 'Bearer FLWSECK_TEST-x');
    assert.ok(received.body.tx_ref, 'tx_ref obligatoire');
    assert.equal(received.body.amount, 20);
    assert.equal(received.body.currency, 'USD');
    assert.equal(received.body.customer.email, 'client@example.com');
    assert.equal(received.body.callback_url, 'https://novaforge.test/api/v1/payments/webhook/' + gw.id);
  } finally {
    await srv.close();
  }
});

test('le multiplicateur de conversion change le montant facturé sans toucher au brut', async () => {
  const srv = await startServer((req, res) => {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      const b = JSON.parse(raw || '{}');
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'success', data: { id: 1, link: 'https://checkout.test/1', amount: b.amount } }));
    });
  });
  try {
    const gw = PAY.createGateway({ name: 'FW', type: 'flutterwave', secret: 'k', base_url: srv.base + '/v3', currency: 'XOF', price_multiplier: 1500 }).gateway;
    const user = makeUser('multi@example.com');
    const plan = makePlan('premium_multi', 20);
    const res = await PAY.createCheckout({ user, plan, gateway: gw, baseUrl: 'https://novaforge.test' });
    assert.equal(res.ok, true);
    assert.equal(res.payment.amount, 30000, 'montant facturé dans la devise du gateway');
    assert.equal(res.payment.gross, 20, 'brut en devise plateforme');
    assert.equal(res.payment.commission, 2);
    assert.equal(res.payment.net, 18);
  } finally {
    await srv.close();
  }
});

test('un paiement « en cours » n\'est jamais dupliqué (idempotence)', () => {
  const user = makeUser('idem@example.com');
  const plan = makePlan('premium_idem', 20);
  const gw = PAY.createGateway({ name: 'FW', type: 'flutterwave', secret: 'k', base_url: 'https://api.flutterwave.com/v3' }).gateway;
  const first = PAY.payments().insert({
    user_id: user.id, plan_id: plan.id, method: 'gateway', gateway_id: gw.id, gateway_type: 'flutterwave',
    reference: 'nfx_1', tx_ref: 'nfx_1', checkout_url: 'https://checkout.test/1', amount: 20, currency: 'USD',
    status: 'pending', idempotency_key: gw.id + ':' + user.id + ':' + plan.id,
  });
  const found = PAY.findLiveCheckout({ userId: user.id, planId: plan.id, gatewayId: gw.id, idempotencyKey: null });
  assert.equal(found.id, first.id, 'le paiement existant est réutilisé');
  assert.equal(PAY.payments().where((p) => p.user_id === user.id && p.status === 'pending').length, 1);
});

test('le webhook signé active l\'offre une seule fois', async () => {
  const srv = await startServer((req, res) => {
    if (req.url.startsWith('/v3/transactions/')) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'success', message: 'Transaction fetched successfully', data: { id: 4242, tx_ref: 'nfx_ok', amount: 20, currency: 'USD', status: 'successful' } }));
      return;
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'success', data: { id: 4242, link: 'https://checkout.test/4242' } }));
  });
  try {
    const gw = PAY.createGateway({ name: 'FW', type: 'flutterwave', secret: 'FLWSECK_TEST-x', webhook_secret: 'hook-secret', base_url: srv.base + '/v3', currency: 'USD' }).gateway;
    const user = makeUser('webhook@example.com');
    const plan = makePlan('premium_hook', 20);
    const created = await PAY.createCheckout({ user, plan, gateway: gw, baseUrl: 'https://novaforge.test' });
    assert.equal(created.ok, true);

    const payload = JSON.stringify({
      event: 'charge.completed',
      data: { id: 4242, tx_ref: created.payment.tx_ref, amount: 20, currency: 'USD', status: 'successful' },
    });
    const headers = { 'verif-hash': 'hook-secret' };

    const r1 = await PAY.handleWebhook({ gateway: gw, rawBody: Buffer.from(payload), headers });
    assert.equal(r1.status, 200);
    assert.equal(r1.action, 'activated');
    assert.equal(A.users().get(user.id).plan_id, 'premium_hook', 'l\'abonnement est activé');
    assert.equal(A.users().get(user.id).subscription.status, 'active');

    // Rejeu du même webhook : aucun double effet.
    const r2 = await PAY.handleWebhook({ gateway: gw, rawBody: Buffer.from(payload), headers });
    assert.equal(r2.status, 200);
    assert.equal(r2.action, 'idempotent', 'le rejeu est idempotent');
    assert.equal(PAY.payments().where((p) => p.user_id === user.id && p.status === 'validated').length, 1);
  } finally {
    await srv.close();
  }
});

test('un webhook mal signé n\'active jamais l\'offre', async () => {
  const gw = PAY.createGateway({ name: 'FW', type: 'flutterwave', secret: 'k', webhook_secret: 'hook-secret', base_url: 'https://api.flutterwave.com/v3', currency: 'USD' }).gateway;
  const user = makeUser('badhook@example.com');
  const plan = makePlan('premium_bad', 20);
  const created = makePayment(gw, user, plan);

  const payload = JSON.stringify({ event: 'charge.completed', data: { id: 1, tx_ref: created.tx_ref, amount: 20, currency: 'USD', status: 'successful' } });
  const res = await PAY.handleWebhook({ gateway: gw, rawBody: Buffer.from(payload), headers: { 'verif-hash': 'mauvais-secret' } });
  assert.equal(res.status, 401);
  assert.equal(res.action, 'rejected');
  assert.equal(A.users().get(user.id).plan_id, 'free', 'l\'abonnement reste inactif');
  assert.equal(PAY.payments().get(created.id).status, 'pending');
});

test('un montant divergent n\'active pas l\'offre', async () => {
  const gw = PAY.createGateway({ name: 'FW', type: 'flutterwave', secret: 'k', webhook_secret: 'hook-secret', base_url: 'https://api.flutterwave.com/v3', currency: 'USD' }).gateway;
  const user = makeUser('mismatch@example.com');
  const plan = makePlan('premium_mismatch', 20);
  const created = makePayment(gw, user, plan);

  const payload = JSON.stringify({ event: 'charge.completed', data: { id: 1, tx_ref: created.tx_ref, amount: 1, currency: 'USD', status: 'successful' } });
  const res = await PAY.handleWebhook({ gateway: gw, rawBody: Buffer.from(payload), headers: { 'verif-hash': 'hook-secret' } });
  assert.equal(res.status, 200);
  assert.equal(res.action, 'mismatch');
  assert.equal(A.users().get(user.id).plan_id, 'free', 'un paiement partiel n\'active rien');
  assert.equal(PAY.payments().get(created.id).status, 'mismatch');
});

test('un webhook en échec laisse le paiement en échec et n\'active rien', async () => {
  const gw = PAY.createGateway({ name: 'FW', type: 'flutterwave', secret: 'k', webhook_secret: 'hook-secret', base_url: 'https://api.flutterwave.com/v3', currency: 'USD' }).gateway;
  const user = makeUser('failed@example.com');
  const plan = makePlan('premium_failed', 20);
  const created = makePayment(gw, user, plan);

  const payload = JSON.stringify({ event: 'charge.completed', data: { id: 1, tx_ref: created.tx_ref, amount: 20, currency: 'USD', status: 'failed' } });
  const res = await PAY.handleWebhook({ gateway: gw, rawBody: Buffer.from(payload), headers: { 'verif-hash': 'hook-secret' } });
  assert.equal(res.status, 200);
  assert.equal(res.action, 'failed');
  assert.equal(A.users().get(user.id).plan_id, 'free');
});

test('le webhook de l\'adaptateur générique utilise HMAC-SHA256 par défaut', async () => {
  const gw = PAY.createGateway({
    name: 'Candy', type: 'candy', secret: 'sk_candy', base_url: 'https://gateway.example',
    config: { create_path: '/payments', test_path: '/health', webhook_scheme: 'hmac_sha256', webhook_header: 'x-signature', checkout_url_path: 'data.checkout_url', ref_path: 'data.reference', amount_path: 'data.amount', currency_path: 'data.currency', status_path: 'data.state' },
  }).gateway;
  const user = makeUser('candy@example.com');
  const plan = makePlan('premium_candy', 20);
  const created = makePayment(gw, user, plan);

  const payload = JSON.stringify({ data: { reference: created.tx_ref, amount: 20, currency: 'USD', state: 'paid' } });
  const sig = crypto.createHmac('sha256', 'sk_candy').update(Buffer.from(payload)).digest('hex');

  const bad = await PAY.handleWebhook({ gateway: gw, rawBody: Buffer.from(payload), headers: { 'x-signature': '00' } });
  assert.equal(bad.status, 401);

  const good = await PAY.handleWebhook({ gateway: gw, rawBody: Buffer.from(payload), headers: { 'x-signature': sig } });
  assert.equal(good.status, 200);
  assert.equal(good.action, 'activated');
  assert.equal(A.users().get(user.id).plan_id, 'premium_candy');
});

test('le webhook d\'une référence inconnue est ignoré sans erreur', async () => {
  const gw = PAY.createGateway({ name: 'FW', type: 'flutterwave', secret: 'k', webhook_secret: 'hook-secret', base_url: 'https://api.flutterwave.com/v3' }).gateway;
  const payload = JSON.stringify({ event: 'charge.completed', data: { id: 9, tx_ref: 'inconnue', amount: 20, currency: 'USD', status: 'successful' } });
  const res = await PAY.handleWebhook({ gateway: gw, rawBody: Buffer.from(payload), headers: { 'verif-hash': 'hook-secret' } });
  assert.equal(res.status, 200);
  assert.equal(res.action, 'ignored');
});

test.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));
