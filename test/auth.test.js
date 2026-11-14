'use strict';
// Tests de l'authentification : inscription, connexion, sessions, rôles,
// permissions et compte bloqué — au niveau du module (server/lib/auth.js) et
// au niveau HTTP (les règles sont appliquées côté serveur, jamais côté client).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'novaforge-auth-test-'));
process.env.NOVAFORGE_DATA_DIR = dataDir;
process.env.NODE_ENV = 'test';

const A = require('../server/lib/auth');

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

/** Démarre le serveur sur un port libre (nouvel essai si le port est pris). */
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

/** Appel HTTP JSON vers l'API. */
async function api(urlPath, { method = 'GET', body, cookie } = {}) {
  const res = await fetch(base + '/api/v1/' + urlPath, {
    method,
    headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = {};
  try { data = await res.json(); } catch { /* ignore */ }
  return { status: res.status, data, cookie: (res.headers.get('set-cookie') || '').split(';')[0] };
}

test.before(async () => {
  const started = await boot();
  base = started.base;
  server = started.app.server;
  const res = await api('setup', { method: 'POST', body: { email: 'proprietaire@novaforge.local', password: 'MotDePasse1!' } });
  assert.equal(res.status, 200, 'le setup doit créer le compte propriétaire');
  adminCookie = res.cookie;
  assert.ok(adminCookie, 'le setup doit ouvrir une session');
});

test.after(() => {
  try {
    if (server && server.closeAllConnections) server.closeAllConnections();
    if (server) server.close();
  } catch { /* ignore */ }
  fs.rmSync(dataDir, { recursive: true, force: true });
});

// ---------- Module d'authentification ----------

test('le mot de passe est haché (scrypt + sel) et ne se vérifie qu\'avec le bon mot de passe', () => {
  const hash = A.hashPassword('MotDePasse1!');
  assert.match(hash, /^scrypt\$/);
  assert.equal(hash.includes('MotDePasse1!'), false, 'le mot de passe ne doit pas figurer dans le hachage');
  assert.equal(A.verifyPassword('MotDePasse1!', hash), true);
  assert.equal(A.verifyPassword('mauvais-mot-de-passe', hash), false);
  assert.equal(A.verifyPassword('x', 'hachage-corrompu'), false);
  assert.notEqual(A.hashPassword('MotDePasse1!'), hash, 'le sel rend chaque hachage unique');
});

test('la robustesse du mot de passe est mesurée avant inscription', () => {
  assert.ok(A.pwStrength('MotDePasse1!') >= 3, 'un mot de passe solide est accepté');
  assert.ok(A.pwStrength('court') < 3, 'un mot de passe faible est refusé');
});

test('les rôles et les permissions sont vérifiés côté serveur', () => {
  const superAdmin = { role: 'super_admin', permissions: [] };
  const sousAdmin = { role: 'sub_admin', permissions: ['providers.manage'] };
  const sousAdminSansPermission = { role: 'sub_admin', permissions: [] };
  const utilisateur = { role: 'user', permissions: [] };
  assert.equal(A.hasPerm(superAdmin, 'providers.manage'), true);
  assert.equal(A.hasPerm(superAdmin, 'permission.inconnue'), true, 'le Super Admin a toutes les permissions');
  assert.equal(A.hasPerm(sousAdmin, 'providers.manage'), true);
  assert.equal(A.hasPerm(sousAdmin, 'billing.manage'), false, 'une permission non accordée est refusée');
  assert.equal(A.hasPerm(sousAdminSansPermission, 'providers.manage'), false);
  assert.equal(A.hasPerm(utilisateur, 'providers.manage'), false);
  assert.equal(A.hasPerm(null, 'providers.manage'), false);
});

test('une session expire, se détruit, et un compte bloqué ne peut plus l\'utiliser', () => {
  const u = A.users().insert({
    email: 'session@example.com', password: A.hashPassword('MotDePasse1!'),
    role: 'user', plan_id: 'free', blocked: false,
  });
  const token = A.createSession(u.id, { ip: '127.0.0.1', ua: 'test' });
  const req = { cookies: { nfx_session: token } };
  assert.equal(A.getSessionUser(req).id, u.id, 'une session valide donne l\'utilisateur');

  const s = A.sessions().find((x) => x.user_id === u.id);
  A.sessions().update(s.id, { expires_at: new Date(Date.now() - 1000).toISOString() });
  assert.equal(A.getSessionUser(req), null, 'une session expirée est refusée');

  const token2 = A.createSession(u.id, {});
  A.users().update(u.id, { blocked: true });
  assert.equal(A.getSessionUser({ cookies: { nfx_session: token2 } }), null, 'un compte bloqué perd l\'accès');
  A.users().update(u.id, { blocked: false });

  const token3 = A.createSession(u.id, {});
  A.destroySession({ cookies: { nfx_session: token3 } });
  assert.equal(A.getSessionUser({ cookies: { nfx_session: token3 } }), null, 'la déconnexion détruit la session');
});

test('la vue publique d\'un utilisateur ne contient jamais le hachage du mot de passe', () => {
  const u = A.users().insert({
    email: 'public@example.com', password: A.hashPassword('MotDePasse1!'),
    role: 'user', plan_id: 'free', blocked: false,
  });
  const view = A.publicUser(u);
  assert.equal(view.password, undefined);
  assert.equal(JSON.stringify(view).includes('scrypt'), false);
  assert.equal(view.email, 'public@example.com');
});

// ---------- HTTP ----------

test('l\'inscription crée un compte, ouvre une session et refuse les doublons', async () => {
  const ok = await api('auth/register', { method: 'POST', body: { email: 'alice@example.com', password: 'MotDePasse1!' } });
  assert.equal(ok.status, 200);
  assert.equal(ok.data.user.role, 'user');
  assert.equal(ok.data.user.plan_id, 'free');
  assert.equal(ok.data.user.password, undefined, 'le mot de passe ne doit jamais être renvoyé');
  assert.ok(ok.cookie, 'l\'inscription ouvre une session');

  const me = await api('auth/me', { cookie: ok.cookie });
  assert.equal(me.status, 200);
  assert.equal(me.data.user.email, 'alice@example.com');

  const doublon = await api('auth/register', { method: 'POST', body: { email: 'alice@example.com', password: 'MotDePasse1!' } });
  assert.equal(doublon.status, 409);

  const faible = await api('auth/register', { method: 'POST', body: { email: 'faible@example.com', password: 'court' } });
  assert.equal(faible.status, 400);

  const invalide = await api('auth/register', { method: 'POST', body: { email: 'pas-un-email', password: 'MotDePasse1!' } });
  assert.equal(invalide.status, 400);
});

test('la connexion ouvre une session, la déconnexion la ferme', async () => {
  const bad = await api('auth/login', { method: 'POST', body: { email: 'alice@example.com', password: 'mauvais' } });
  assert.equal(bad.status, 401);

  const ok = await api('auth/login', { method: 'POST', body: { email: 'alice@example.com', password: 'MotDePasse1!' } });
  assert.equal(ok.status, 200);
  assert.ok(ok.cookie);

  const me = await api('auth/me', { cookie: ok.cookie });
  assert.equal(me.status, 200);
  assert.equal(me.data.user.email, 'alice@example.com');

  const out = await api('auth/logout', { method: 'POST', cookie: ok.cookie });
  assert.equal(out.status, 200);
  const apres = await api('auth/me', { cookie: ok.cookie });
  assert.equal(apres.status, 401, 'la session doit être invalide après déconnexion');
});

test('une route protégée refuse un appel sans session', async () => {
  const res = await api('dashboard');
  assert.equal(res.status, 401);
  const res2 = await api('auth/me');
  assert.equal(res2.status, 401);
});

test('un compte bloqué perd sa session et ne peut plus se connecter', async () => {
  const created = await api('auth/register', { method: 'POST', body: { email: 'bloque@example.com', password: 'MotDePasse1!' } });
  const cookie = created.cookie;
  assert.equal((await api('auth/me', { cookie })).status, 200);

  const users = await api('admin/users', { cookie: adminCookie });
  assert.equal(users.status, 200);
  const target = users.data.users.find((u) => u.email === 'bloque@example.com');
  assert.ok(target, 'le compte doit figurer dans la liste');

  const block = await api('admin/users/' + target.id, { method: 'POST', cookie: adminCookie, body: { action: 'block' } });
  assert.equal(block.status, 200);

  assert.equal((await api('auth/me', { cookie })).status, 401, 'la session d\'un compte bloqué est refusée');
  const login = await api('auth/login', { method: 'POST', body: { email: 'bloque@example.com', password: 'MotDePasse1!' } });
  assert.equal(login.status, 403);

  const unblock = await api('admin/users/' + target.id, { method: 'POST', cookie: adminCookie, body: { action: 'unblock' } });
  assert.equal(unblock.status, 200);
  assert.equal((await api('auth/login', { method: 'POST', body: { email: 'bloque@example.com', password: 'MotDePasse1!' } })).status, 200);
});

test('les permissions de sous-admin s\'appliquent réellement, et un utilisateur simple n\'accède à rien', async () => {
  const created = await api('auth/register', { method: 'POST', body: { email: 'sub@example.com', password: 'MotDePasse1!' } });
  const cookie = created.cookie;
  const users = await api('admin/users', { cookie: adminCookie });
  const target = users.data.users.find((u) => u.email === 'sub@example.com');

  // Un utilisateur simple ne peut pas gérer les fournisseurs IA.
  const refuse = await api('providers', { method: 'POST', cookie, body: { name: 'X', type: 'custom', base_url: 'https://exemple.test', api_key: 'k' } });
  assert.equal(refuse.status, 403);

  // Promotion en sous-admin : il démarre sans aucune permission.
  const role = await api('admin/users/' + target.id, { method: 'POST', cookie: adminCookie, body: { action: 'role', role: 'sub_admin' } });
  assert.equal(role.status, 200);
  const sansPermission = await api('providers', { method: 'POST', cookie, body: { name: 'X', type: 'custom', base_url: 'https://exemple.test', api_key: 'k' } });
  assert.equal(sansPermission.status, 403, 'un sous-admin sans permission ne peut rien configurer');

  // Permission accordée : l\'action devient possible.
  const perms = await api('admin/users/' + target.id, { method: 'POST', cookie: adminCookie, body: { action: 'permissions', permissions: ['providers.manage'] } });
  assert.equal(perms.status, 200);
  const avecPermission = await api('providers', { method: 'POST', cookie, body: { name: 'Sous-admin', type: 'custom', base_url: 'https://exemple.test', api_key: 'k' } });
  assert.equal(avecPermission.status, 200, 'la permission accordée ouvre la route');
});

test('seul le Super Admin peut attribuer rôles et permissions', async () => {
  const created = await api('auth/register', { method: 'POST', body: { email: 'intruseur@example.com', password: 'MotDePasse1!' } });
  const cookie = created.cookie;
  const users = await api('admin/users', { cookie: adminCookie });
  const target = users.data.users.find((u) => u.email === 'intruseur@example.com');
  const res = await api('admin/users/' + target.id, { method: 'POST', cookie, body: { action: 'role', role: 'super_admin' } });
  assert.equal(res.status, 403, 'un utilisateur simple ne peut pas se nommer Super Admin');
});

test('le changement de mot de passe exige le mot de passe actuel', async () => {
  const created = await api('auth/register', { method: 'POST', body: { email: 'pwd@example.com', password: 'MotDePasse1!' } });
  const cookie = created.cookie;
  const faux = await api('auth/password', { method: 'POST', cookie, body: { current: 'mauvais', next: 'NouveauMotDePasse2!' } });
  assert.equal(faux.status, 400);
  const faible = await api('auth/password', { method: 'POST', cookie, body: { current: 'MotDePasse1!', next: 'court' } });
  assert.equal(faible.status, 400);
  const ok = await api('auth/password', { method: 'POST', cookie, body: { current: 'MotDePasse1!', next: 'NouveauMotDePasse2!' } });
  assert.equal(ok.status, 200);
  const relogin = await api('auth/login', { method: 'POST', body: { email: 'pwd@example.com', password: 'NouveauMotDePasse2!' } });
  assert.equal(relogin.status, 200, 'le nouveau mot de passe est pris en compte');
  assert.equal((await api('auth/login', { method: 'POST', body: { email: 'pwd@example.com', password: 'MotDePasse1!' } })).status, 401);
});
