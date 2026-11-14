'use strict';
// Tests du moteur de génération : compréhension de la demande, construction
// des fichiers, exécution réelle des tests obligatoires (le code produit ne
// doit pas être annoncé « fonctionnel » sans tests réussis) et versionnage.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'novaforge-gen-test-'));
process.env.NOVAFORGE_DATA_DIR = dataDir;
process.env.NODE_ENV = 'test';

const GEN = require('../server/generator');
const A = require('../server/lib/auth');

const user = A.users().insert({
  email: 'generateur@example.com', password: A.hashPassword('MotDePasse1!'),
  role: 'user', plan_id: 'free', blocked: false,
});

test('la demande est comprise : type, domaine, fonctionnalités et nom', () => {
  const agent = GEN.understand('Crée un agent chatbot de support client');
  assert.equal(agent.type, 'agent');

  const mobile = GEN.understand('Une application mobile android de suivi de courses');
  assert.equal(mobile.type, 'mobile');

  const fullstack = GEN.understand('Une plateforme full stack avec base de données et inscription des utilisateurs');
  assert.equal(fullstack.type, 'fullstack');

  const api = GEN.understand('Une api REST de gestion de commandes');
  assert.equal(api.type, 'api');

  const app = GEN.understand('Une application de gestion de tâches');
  assert.equal(app.type, 'app');

  // Le domaine métier est détecté à partir des mots-clés.
  assert.equal(GEN.understand('Une application de livraison de colis').domain, 'delivery');
  assert.equal(GEN.understand('Un site web de restaurant avec menu').domain, 'restaurant');
  assert.equal(GEN.understand('Une boutique en ligne de vente de livres').domain, 'shop');
  assert.equal(GEN.understand('Une plateforme de suivi de budget').domain, 'finance');
  assert.equal(GEN.understand('Un réseau social de partage d\'idées').domain, 'social');
  assert.equal(GEN.understand('Un blog de voyage').domain, 'blog');
  assert.equal(GEN.understand('Un CRM de suivi des prospects').domain, 'crm');
  assert.equal(GEN.understand('Une plateforme de gestion des tâches').domain, 'tasks');
  assert.equal(GEN.understand('Un truc sans mot-clé métier').domain, 'generic');

  // Les fonctionnalités demandées sont détectées.
  const feats = GEN.understand('Une application de tâches avec recherche, export csv et tableau de bord');
  assert.equal(feats.features.search, true);
  assert.equal(feats.features.export, true);
  assert.equal(feats.features.stats, true);

  // Le nom est extrait de la phrase quand elle en contient un.
  assert.equal(GEN.understand('Une application de gestion de tâches').name, 'Gestion de tâches');
  assert.ok(GEN.understand('Un truc').name.length > 0, 'un nom de repli est toujours fourni');
});

test('chaque type produit les fichiers attendus', () => {
  const app = GEN.buildFiles({ type: 'app', name: 'Test App', domain: 'tasks', features: { messages: false, stats: true, export: true, search: true }, description: 'test' });
  assert.ok(app['index.html'], 'une application produit une page HTML');
  assert.ok(app['README.md']);
  assert.match(app['index.html'], /Test App/);

  const api = GEN.buildFiles({ type: 'api', name: 'Test API', domain: 'tasks', features: {}, description: 'test' });
  assert.ok(api['api.js'], 'une API produit son module exécutable');
  assert.ok(api['openapi.json'], 'une API produit sa description OpenAPI');

  const agent = GEN.buildFiles({ type: 'agent', name: 'Test Agent', domain: 'generic', features: {}, description: 'test' });
  assert.ok(agent['agent.json'], 'un agent produit sa configuration');

  const fullstack = GEN.buildFiles({ type: 'fullstack', name: 'Test FS', domain: 'shop', features: {}, description: 'test' });
  assert.ok(fullstack['index.html'], 'une full stack produit un front');
  assert.ok(fullstack['api.js'], 'une full stack produit son API');

  const mobile = GEN.buildFiles({ type: 'mobile', name: 'Test Mobile', domain: 'tasks', features: {}, description: 'test' });
  assert.ok(mobile['capacitor.config.json'], 'une app mobile produit la configuration Capacitor');
  assert.ok(mobile['package.json']);
});

test('un projet généré passe les tests obligatoires et est versionné', async () => {
  const proj = await GEN.generateProject({ user, description: 'Une application de gestion de tâches avec recherche' });

  assert.equal(proj.owner_id, user.id);
  assert.equal(proj.type, 'app');
  assert.equal(proj.status, 'draft');
  assert.equal(proj.current_version, 1);

  // Principe produit : aucun statut « fonctionnel » sans tests réussis.
  const version = proj.versions[0];
  assert.equal(version.v, 1);
  assert.equal(version.ok, true, 'tous les tests obligatoires doivent réussir');
  assert.ok(version.tests.length > 0, 'des tests ont réellement été exécutés');
  assert.ok(version.tests.every((t) => t.ok), 'aucun test en échec');
  assert.equal(version.engine, 'local', 'sans fournisseur IA, le moteur local est utilisé');
  assert.ok(version.engine_detail.length > 0);

  // Le pipeline est tracé.
  const steps = proj.pipeline.map((p) => p.step);
  assert.ok(steps.includes('Comprendre la demande'));
  assert.ok(steps.includes('Tests automatiques'));
  const etapeTests = proj.pipeline.find((p) => p.step === 'Tests automatiques');
  assert.equal(etapeTests.status, 'done');

  // Les fichiers existent réellement sur le disque.
  const current = GEN.readCurrent(proj.id);
  assert.ok(current['index.html'], 'le fichier généré est écrit sur le disque');
  assert.ok(fs.existsSync(path.join(GEN.PDIR(proj.id), 'v1', 'index.html')), 'la version 1 est archivée');
  assert.ok(current['index.html'].includes('Tâches') || current['index.html'].length > 500);
});

test('une API générée est réellement exécutable par le runtime', async () => {
  const proj = await GEN.generateProject({ user, description: 'Une api REST de gestion de commandes' });
  assert.equal(proj.type, 'api');
  const version = proj.versions[0];
  assert.equal(version.ok, true);
  const testRuntime = version.tests.find((t) => t.name.includes('runtime'));
  assert.ok(testRuntime, 'un test HTTP du runtime doit avoir été exécuté');
  assert.equal(testRuntime.ok, true, 'le runtime doit répondre sur les routes générées');
  assert.ok(fs.existsSync(path.join(GEN.PDIR(proj.id), 'current', 'api.js')));
});

test('un agent généré est configuré pour la boucle d\'outils', async () => {
  const proj = await GEN.generateProject({ user, description: 'Crée un agent chatbot de support client' });
  assert.equal(proj.type, 'agent');
  assert.equal(proj.versions[0].ok, true);
  const cfg = JSON.parse(GEN.readCurrent(proj.id)['agent.json']);
  assert.ok(cfg.system_prompt, 'l\'agent a une instruction système');
});

test('les tests peuvent être relancés sur la version courante', async () => {
  const proj = await GEN.generateProject({ user, description: 'Une application de gestion de tâches' });
  const files = GEN.readCurrent(proj.id);
  const again = await GEN.rerunTests(proj, files);
  assert.ok(Array.isArray(again));
  assert.ok(again.length > 0);
  assert.ok(again.every((t) => t.ok), 'les tests obligatoires repassent');
});

test.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));
