'use strict';
// Tests des quotas journaliers et de la facturation : quotas appliqués côté
// serveur (créations et applications), demande de paiement mobile money,
// validation par le Super Admin, activation de l'offre, idempotence de la
// validation et comptabilité brut / commission / net.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'novaforge-billing-test-'));
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

async function boot() {
  let last = null;
  for (let attempt = 0; attempt < 8; attempt++) {
    const port = await freePort();
    process.env.PORT = String(port);
    delete require.cache[require.resolve('../server/app.js')];
    const app = require('../server/app.js');
    try {
      await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Le serveur n’a pas démarré.')), 20000);
        if (timer.unref) timer.unref();
        app.server.once('listening', () => { clearTimeout(timer); resolve(); });
        app.server.once('error', (e) => { clearTimeout(timer); reject(e); });
      });
      return { app, base: 'http://127.0.0.1:' + port };
    } catch (e) {
      last = e;
      try { app.server.close(); } catch { /* ignore */ }
    }
  }
  throw last;
}

let base = '';
let adminCookie = '';
let server = null;

async function api(urlPath, { method = 'GET', body, cookie } = {}) {
  const res = await fetch(base + '/api/v1/' + urlPath, {
    method,
    headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = {};
  try { data = await res.json(); } catch { /* ignore */ }
  return { status: res.status, data };
}

/** Crée un compte utilisateur et renvoie sa session. */
async function register(email) {
  const res = await fetch(base + '/api/v1/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'MotDePasse1!' }),
  });
  const data = await res.json();
  return { status: res.status, data, cookie: (res.headers.get('set-cookie') || '').split(';')[0] };
}

/** Lance une création de projet via le pipeline réel. */
async function generate(cookie, description) {
  return api('projects/generate', { method: 'POST', cookie, body: { description } });
}

test.before(async () => {
  const started = await boot();
  base = started.base;
  server = started.app.server;
  const res = await fetch(base + '/api/v1/setup', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'proprietaire@novaforge.local', password: 'MotDePasse1!' }),
  });
  adminCookie = (res.headers.get('set-cookie') || '').split(';')[0];
  assert.ok(adminCookie, 'le setup doit ouvrir une session');
});

test.after(() => {
  try {
    if (server && server.closeAllConnections) server.closeAllConnections();
    if (server) server.close();
  } catch { /* ignore */ }
  fs.rmSync(dataDir, { recursive: true, force: true });
});

// ---------- Quotas ----------

test('les quotas journaliers sont appliqués côté serveur, creations et applications', async () => {
  // Le Super Admin fixe les quotas du plan gratuit : 3 créations, 1 application.
  const plan = await api('admin/plans/free', { method: 'POST', cookie: adminCookie, body: { price: 0, creations_per_day: 3, apps_per_day: 1 } });
  assert.equal(plan.status, 200);

  const user = await register('quota@example.com');
  assert.equal(user.status, 200);
  const cookie = user.cookie;

  // 1. Une API consomme une création, pas de quota d'application.
  const api1 = await generate(cookie, 'Une api REST de gestion de tâches');
  assert.equal(api1.status, 200, 'la première création passe');

  // 2. Une application consomme le quota d'application.
  const app1 = await generate(cookie, 'Une application web de gestion de tâches');
  assert.equal(app1.status, 200, 'la première application passe');

  // 3. Une seconde application est refusée : quota d'applications atteint.
  const app2 = await generate(cookie, 'Une autre application web de suivi');
  assert.equal(app2.status, 429);
  assert.match(app2.data.error, /Quota d.applications atteint/);

  // 4. Une API reste possible jusqu'au quota de créations.
  const api2 = await generate(cookie, 'Une autre api REST de gestion');
  assert.equal(api2.status, 200);

  // 5. Quota de créations atteint.
  const api3 = await generate(cookie, 'Une troisième api REST de gestion');
  assert.equal(api3.status, 429);
  assert.match(api3.data.error, /Quota de créations atteint/);

  // Les compteurs du tableau de bord reflètent exactement l'usage.
  const dash = await api('dashboard', { cookie });
  assert.equal(dash.status, 200);
  assert.equal(dash.data.counters.creations, 3);
  assert.equal(dash.data.counters.apps, 1);

  // Le Super Admin relève le quota : la création redevient possible.
  const relu = await api('admin/plans/free', { method: 'POST', cookie: adminCookie, body: { price: 0, creations_per_day: 10, apps_per_day: 5 } });
  assert.equal(relu.status, 200);
  const api4 = await generate(cookie, 'Une api après relève du quota');
  assert.equal(api4.status, 200, 'le quota relevé s\'applique immédiatement');
});

test('un compte sans session ne peut pas consommer de quota', async () => {
  const res = await generate('', 'Une api sans session');
  assert.equal(res.status, 401);
});

// ---------- Facturation ----------

test('une demande de paiement mobile money est enregistrée et reste en attente', async () => {
  const user = await register('facture@example.com');
  const cookie = user.cookie;

  const plans = await api('plans', { cookie });
  assert.equal(plans.status, 200);
  assert.ok(plans.data.plans.some((p) => p.id === 'premium'));
  assert.ok(plans.data.payment.mpesa, 'les moyens de paiement mobiles sont configurés');

  const demande = await api('billing/payment', {
    method: 'POST', cookie,
    body: { plan_id: 'premium', method: 'mpesa', reference: 'M-PESA-0001', note: 'Facture Test' },
  });
  assert.equal(demande.status, 200);
  assert.equal(demande.data.payment.status, 'pending');

  // Une seconde demande en attente est refusée.
  const doublon = await api('billing/payment', {
    method: 'POST', cookie,
    body: { plan_id: 'premium', method: 'orange', reference: 'ORANGE-0001', note: 'Facture Test' },
  });
  assert.equal(doublon.status, 409);

  // Annulation : une nouvelle demande redevient possible.
  const cancel = await api('billing/payment/' + demande.data.payment.id + '/cancel', { method: 'POST', cookie });
  assert.equal(cancel.status, 200);
  const apres = await api('billing/payment', {
    method: 'POST', cookie,
    body: { plan_id: 'premium', method: 'mpesa', reference: 'M-PESA-0002', note: 'Facture Test' },
  });
  assert.equal(apres.status, 200);
});

test('une demande de paiement mal renseignée est refusée', async () => {
  const user = await register('facture2@example.com');
  const cookie = user.cookie;
  const sansMethode = await api('billing/payment', { method: 'POST', cookie, body: { plan_id: 'premium', reference: 'X' } });
  assert.equal(sansMethode.status, 400);
  const methodeInconnue = await api('billing/payment', { method: 'POST', cookie, body: { plan_id: 'premium', method: 'bitcoin', reference: 'X' } });
  assert.equal(methodeInconnue.status, 400);
  const sansReference = await api('billing/payment', { method: 'POST', cookie, body: { plan_id: 'premium', method: 'mpesa' } });
  assert.equal(sansReference.status, 400);
  const offreGratuite = await api('billing/payment', { method: 'POST', cookie, body: { plan_id: 'free', method: 'mpesa', reference: 'X' } });
  assert.equal(offreGratuite.status, 400);
});

test('la validation par le Super Admin active l\'offre et la comptabilité 10 %', async () => {
  const user = await register('paiement@example.com');
  const cookie = user.cookie;

  const demande = await api('billing/payment', {
    method: 'POST', cookie,
    body: { plan_id: 'premium', method: 'mpesa', reference: 'M-PESA-7777', note: 'Aïcha M.' },
  });
  assert.equal(demande.status, 200);
  const id = demande.data.payment.id;

  // Le Super Admin voit la demande en attente.
  const liste = await api('admin/payments', { cookie: adminCookie });
  assert.equal(liste.status, 200);
  const ligne = liste.data.payments.find((p) => p.id === id);
  assert.ok(ligne, 'la demande doit figurer dans la liste d\'administration');
  assert.equal(ligne.status, 'pending');
  assert.equal(ligne.user_email, 'paiement@example.com');
  assert.equal(ligne.proof, false);

  // Aucun abonnement avant validation explicite.
  const avant = await api('auth/me', { cookie });
  assert.equal(avant.data.user.plan_id, 'free');

  // Validation.
  const valid = await api('admin/payments/' + id, { method: 'POST', cookie: adminCookie, body: { action: 'validate', note: 'Référence vérifiée' } });
  assert.equal(valid.status, 200);
  assert.match(valid.data.message, /30 jours/);

  // L'offre est active, l'abonnement expire dans 30 jours.
  const apres = await api('auth/me', { cookie });
  assert.equal(apres.data.user.plan_id, 'premium');
  assert.equal(apres.data.plan.id, 'premium');

  const moi = await api('billing/me', { cookie });
  assert.equal(moi.status, 200);
  assert.equal(moi.data.subscription.plan_id, 'premium');
  assert.equal(moi.data.subscription.status, 'active');
  const jours = Math.round((new Date(moi.data.subscription.expires_at) - Date.now()) / 864e5);
  assert.ok(jours >= 29 && jours <= 30, 'l\'abonnement doit durer 30 jours');

  // Comptabilité : brut 20, commission 10 % = 2, net 18.
  const pay = moi.data.payments.find((p) => p.id === id);
  assert.equal(pay.status, 'validated');
  assert.equal(pay.gross, 20);
  assert.equal(pay.commission, 2);
  assert.equal(pay.net, 18);

  // Validation idempotente : une seconde validation est refusée.
  const revalid = await api('admin/payments/' + id, { method: 'POST', cookie: adminCookie, body: { action: 'validate' } });
  assert.equal(revalid.status, 409);
  assert.match(revalid.data.error, /déjà été validé/);

  // Un rejet reste possible tant que la demande n'est pas validée.
  const autre = await api('billing/payment', {
    method: 'POST', cookie,
    body: { plan_id: 'premium_plus', method: 'airtel', reference: 'AIRTEL-1', note: 'Refus test' },
  });
  const rejet = await api('admin/payments/' + autre.data.payment.id, { method: 'POST', cookie: adminCookie, body: { action: 'reject', note: 'preuve illisible' } });
  assert.equal(rejet.status, 200);
  const apresRejet = await api('auth/me', { cookie });
  assert.equal(apresRejet.data.user.plan_id, 'premium', 'un rejet ne change pas l\'abonnement validé');
});

test('sans passerelle active, le tunnel de paiement automatique est refusé', async () => {
  const user = await register('gateway@example.com');
  const cookie = user.cookie;
  const infos = await api('billing/gateway', { cookie });
  assert.equal(infos.status, 200);
  assert.equal(infos.data.gateway.available, false, 'aucune passerelle n\'est configurée dans ce test');
  const checkout = await api('billing/gateway/checkout', { method: 'POST', cookie, body: { plan_id: 'premium' } });
  assert.equal(checkout.status, 409);
  assert.match(checkout.data.error, /Aucune passerelle de paiement automatique active/);
});
