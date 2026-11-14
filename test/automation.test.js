'use strict';
// Tests de l'automatisation : compréhension des consignes, création de
// tâches, exécution réelle des actions HTTP et fichiers, protection SSRF des
// destinations, planification quotidienne, isolation par utilisateur et
// historique des exécutions.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'novaforge-auto-test-'));
process.env.NOVAFORGE_DATA_DIR = dataDir;
process.env.NODE_ENV = 'test';

const AUTO = require('../server/lib/automation');
const A = require('../server/lib/auth');

const user = A.users().insert({
  email: 'automatisation@example.com', password: A.hashPassword('MotDePasse1!'),
  role: 'user', plan_id: 'free', blocked: false,
});
const autre = A.users().insert({
  email: 'automatisation2@example.com', password: A.hashPassword('MotDePasse1!'),
  role: 'user', plan_id: 'free', blocked: false,
});

/** Petit serveur HTTP local pour les actions d'automatisation. */
function startServer(handler) {
  return new Promise((resolve) => {
    const srv = http.createServer(handler);
    srv.listen(0, '127.0.0.1', () => resolve({
      srv, port: srv.address().port,
      close: () => new Promise((r) => srv.close(r)),
    }));
  });
}

test('une consigne en langage naturel devient une action', () => {
  const requete = AUTO.parseDescription('fais une requête GET https://exemple.test/donnees');
  assert.equal(requete.action.type, 'http_request');
  assert.equal(requete.action.params.method, 'GET');
  assert.equal(requete.action.params.url, 'https://exemple.test/donnees');

  // Une URL seule produit une requête HTTP (le schéma « http » figure dans l'URL).
  const visite = AUTO.parseDescription('visite https://exemple.test/page');
  assert.equal(visite.action.type, 'http_request');
  assert.equal(visite.action.params.url, 'https://exemple.test/page');

  // L'action « web_fetch » (lecture d'une page) reste accessible explicitement.
  const webTask = AUTO.createTask(user.id, { explicit: { action: { type: 'web_fetch', params: { url: 'https://exemple.test/page' } } } });
  assert.equal(webTask.task.action.type, 'web_fetch');

  const fichier = AUTO.parseDescription('crée le fichier notes.txt avec bonjour');
  assert.equal(fichier.action.type, 'create_file');
  assert.equal(fichier.action.params.path, 'notes.txt');
  assert.equal(fichier.action.params.content, 'bonjour');

  const sys = AUTO.parseDescription('info système');
  assert.equal(sys.action.type, 'system_info');

  // Planification quotidienne.
  const quotidien = AUTO.parseDescription('tous les jours à 8h visite https://exemple.test');
  assert.equal(quotidien.kind, 'daily');
  assert.equal(quotidien.time, '08:00');

  const dans = AUTO.parseDescription('dans 30 min fais une requête GET https://exemple.test');
  assert.ok(dans.at, 'une échéance est calculée');
  assert.ok(new Date(dans.at).getTime() > Date.now());
});

test('une tâche est créée, planifiée et isolée par utilisateur', () => {
  const daily = AUTO.createTask(user.id, { description: 'tous les jours à 7h30 visite https://exemple.test' });
  assert.equal(daily.ok, true);
  assert.equal(daily.task.kind, 'daily');
  assert.equal(daily.task.time, '07:30');
  assert.ok(daily.task.next_run, 'une première exécution est planifiée');
  const heure = new Date(daily.task.next_run);
  assert.equal(heure.getHours(), 7);
  assert.equal(heure.getMinutes(), 30);

  const oneTime = AUTO.createTask(user.id, { description: 'dans 45 min fais une requête GET https://exemple.test' });
  assert.equal(oneTime.ok, true);
  assert.equal(oneTime.task.kind, 'onetime');
  assert.ok(new Date(oneTime.task.next_run).getTime() > Date.now());

  // Les commandes shell restent refusées à la création.
  const shell = AUTO.createTask(user.id, { description: 'lance la commande whoami' });
  assert.equal(shell.ok, false);
  assert.match(shell.error, /désactivées/);

  // Isolation : chaque utilisateur ne voit que ses tâches.
  const miennes = AUTO.listTasks(user.id);
  const siennes = AUTO.listTasks(autre.id);
  assert.ok(miennes.length >= 2);
  assert.equal(siennes.length, 0, 'un autre utilisateur ne voit rien');
  assert.ok(miennes.every((t) => t.user_id === user.id));
});

test('une action HTTP est réellement exécutée', async () => {
  const srv = await startServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('réponse du serveur');
  });
  try {
    const res = await AUTO.executeAction({ type: 'http_request', params: { url: 'http://127.0.0.1:' + srv.port + '/sante', method: 'GET' } });
    assert.equal(res.ok, true);
    assert.ok(res.log.join('\n').includes('HTTP 200'), 'le code HTTP est journalisé');
    assert.ok(res.log.join('\n').includes('réponse du serveur'));

    const fetch = await AUTO.executeAction({ type: 'web_fetch', params: { url: 'http://127.0.0.1:' + srv.port + '/page' } });
    assert.equal(fetch.ok, true);
    assert.ok(fetch.log.join('\n').includes('Extrait'));
  } finally {
    await srv.close();
  }
});

test('une destination privée ou réservée est refusée par l\'automatisation', async () => {
  const res = await AUTO.executeAction({ type: 'http_request', params: { url: 'http://169.254.169.254/latest/meta-data', method: 'GET' } });
  assert.equal(res.ok, false, 'une adresse de métadonnées cloud doit être refusée');
  assert.match(res.log.join('\n'), /privée ou réservée/);

  const local = await AUTO.executeAction({ type: 'http_request', params: { url: 'http://127.0.0.1:1/secret', method: 'GET' } });
  assert.equal(local.ok, false);
});

test('une action fichier écrit dans l\'espace de travail et refuse d\'en sortir', async () => {
  const res = await AUTO.executeAction({ type: 'create_file', params: { path: 'rapport.txt', content: 'contenu' } });
  assert.equal(res.ok, true);
  const written = path.join(AUTO.WS, 'rapport.txt');
  assert.ok(fs.existsSync(written), 'le fichier est écrit dans l\'espace de travail');
  assert.equal(fs.readFileSync(written, 'utf8'), 'contenu');

  const dehors = await AUTO.executeAction({ type: 'create_file', params: { path: '../../evasion.txt', content: 'nope' } });
  assert.equal(dehors.ok, false);
  assert.ok(!fs.existsSync(path.join(dataDir, '..', 'evasion.txt')));
});

test('l\'exécution d\'une tâche est tracée dans son historique', async () => {
  const srv = await startServer((req, res) => { res.writeHead(204); res.end(); });
  try {
    const created = AUTO.createTask(user.id, {
      explicit: { name: 'Sonde', kind: 'onetime', action: { type: 'http_request', params: { url: 'http://127.0.0.1:' + srv.port + '/ping', method: 'GET' } } },
    });
    assert.equal(created.ok, true);
    const res = await AUTO.runTask(created.task.id);
    assert.equal(res.ok, true);

    const task = AUTO.getTask(created.task.id, user.id);
    assert.equal(task.status, 'done');
    assert.ok(task.last_run, 'la dernière exécution est datée');
    assert.ok(task.history.length > 0, 'l\'historique est conservé');
    assert.equal(task.history[task.history.length - 1].status, 'done');
    assert.match(task.history[task.history.length - 1].log, /HTTP 204/);
  } finally {
    await srv.close();
  }
});

test.after(() => {
  // L'espace de travail de l'automatisation est un vrai répertoire : on efface
  // ce que le test y a écrit pour ne rien laisser derrière soi.
  try { fs.rmSync(path.join(AUTO.WS, 'rapport.txt'), { force: true }); } catch { /* ignore */ }
  try { fs.rmSync(AUTO.WS, { recursive: true, force: true }); } catch { /* ignore */ }
  fs.rmSync(dataDir, { recursive: true, force: true });
});
