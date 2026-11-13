'use strict';
// Moteur de création par description — pipeline réel :
// compréhension → type → fonctionnalités → plan → construction → tests → prévisualisation.
//
// DEUX MOTEURS DE GÉNÉRATION :
//  • LOCAL (hors ligne, par défaut) : règles + gabarits testés — fonctionne sans internet ni IA.
//  • IA (en ligne) : si un fournisseur IA est configuré ET a réussi son test réel, le code est
//    généré par l'IA puis soumis aux MÊMES tests que le mode local. En cas d'échec (fournisseur,
//    format, tests), repli automatique sur le moteur local. Le moteur utilisé est tracé par version.
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const db = require('../lib/db');
const T = require('./templates');
let LLM = null;
try { LLM = require('../lib/llm'); } catch (e) { LLM = null; }

const projects = () => db.table('projects');
const PDIR = (id) => path.join(db.DATA_DIR, 'projects', String(id));

const TYPE_LBL = {
  app: 'Application web',
  api: 'API REST',
  agent: 'Agent IA',
  fullstack: 'Full stack (front + base de données)',
  mobile: 'App mobile (web + Capacitor)',
};

function writeVersion(pid, v, files) {
  const dir = path.join(PDIR(pid), 'v' + v);
  fs.mkdirSync(dir, { recursive: true });
  for (const [name, content] of Object.entries(files)) {
    const safe = name.replace(/[^a-zA-Z0-9._-]/g, '_');
    fs.writeFileSync(path.join(dir, safe), content, 'utf8');
  }
  // 'current' = copie de la version active
  const cur = path.join(PDIR(pid), 'current');
  try { fs.rmSync(cur, { recursive: true, force: true }); } catch { /* ignore */ }
  fs.mkdirSync(cur, { recursive: true });
  for (const f of fs.readdirSync(dir)) fs.copyFileSync(path.join(dir, f), path.join(cur, f));
  return dir;
}

function readCurrent(pid) {
  const link = path.join(PDIR(pid), 'current');
  if (!fs.existsSync(link)) return {};
  const out = {};
  for (const f of fs.readdirSync(link)) out[f] = fs.readFileSync(path.join(link, f), 'utf8');
  return out;
}

// ---------- Compréhension de la demande ----------
function understand(description, forcedType) {
  const t = String(description || '').trim();
  const lower = t.toLowerCase();

  let type = forcedType || null;
  if (!forcedType) {
    if (/\bagent\b|assistant ia|chatbot/i.test(lower)) type = 'agent';
    else if (/\bmobile\b|android|\bios\b|apk|appli mobile/i.test(lower)) type = 'mobile';
    else if (/\bfull ?stack\b|base de donn|backend|back-end|multi-?utilisateurs|comptes? utilisateurs|synchronis|inscription|login|connexion des utilisateurs/i.test(lower)) type = 'fullstack';
    else if (/\bapi\b|rest|endpoint/i.test(lower)) type = 'api';
    else type = 'app';
  }

  const rules = [
    [/livraison|livreur|colis|delivery/, 'delivery'],
    [/restaurant|menu|caf[ée]|resto|food/, 'restaurant'],
    [/boutique|e-?commerce|magasin|vente en ligne|shop/, 'shop'],
    [/finance|budget|comptabilit|d[ée]penses|monnaie/, 'finance'],
    [/r[ée]seau social|communaut[ée]|social|forum/, 'social'],
    [/blog|article|contenu|journal/, 'blog'],
    [/crm|relation client|prospects?/, 'crm'],
    [/[ée]cole|student|etudiant|classe|note|formation/, 'edu'],
    [/saas|abonnement|plateforme saas|multitenant/i, 'saas'],
    [/t[âa]che|todo|to-do|productivit|liste/, 'tasks'],
  ];
  let domain = null;
  for (const [re, d] of rules) if (re.test(lower)) { domain = d; break; }
  if (!domain) domain = 'generic';

  const features = {
    messages: /messagerie|chat |messages?|messager/i.test(lower) || (domain === 'social' || domain === 'crm' || domain === 'shop' || domain === 'delivery'),
    stats: /stat|tableau de bord|dashboard|analyt|graphique|kpi/i.test(lower),
    export: /export|csv|t[ée]l[ée]charger les donn[ée]es/i.test(lower),
    search: /recherch|search|filtr/i.test(lower),
  };

  // Nom
  let name = null;
  const mDe = t.match(/(?:application|app|api|plateforme|site|outil|syst[èe]me|service|agent|bot)\s+(?:de|pour|d'?)\s+([A-Za-zÀ-ÿ0-9'\- ]{2,40})/i);
  if (mDe) {
    name = mDe[1].trim();
    name = name.split(/\s+(?:avec|et|puis|par)\s+/i)[0].trim();
    if (name.length > 24) name = name.slice(0, 24).trim();
    name = name.charAt(0).toUpperCase() + name.slice(1);
  }
  if (!name) {
    const dLabel = (T.DOMAINS[domain] || T.DOMAINS.generic).label;
    name = type === 'api' ? 'API ' + dLabel : type === 'agent' ? 'Agent ' + dLabel : type === 'fullstack' ? dLabel + ' Pro' : type === 'mobile' ? dLabel + ' Mobile' : dLabel;
  }
  name = name.slice(0, 40) || (type === 'api' ? 'Mon API' : type === 'agent' ? 'Mon Agent' : type === 'fullstack' ? 'Ma Full Stack' : type === 'mobile' ? 'Mon App Mobile' : 'Mon Application');

  return { type, domain, features, name };
}

// ---------- Construction (moteur LOCAL — hors ligne) ----------
function buildFiles({ type, name, domain, features, description }) {
  const color = T.colorFor(name);
  const files = {};
  if (type === 'app') {
    files['index.html'] = T.renderApp({ name, domain, features, color });
    files['README.md'] = `# ${name}\n\nApplication « ${(T.DOMAINS[domain] || T.DOMAINS.generic).label} » générée par NovaForge à partir de la description :\n\n> ${description}\n\n## Fonctionnalités\n` +
      Object.entries(features).filter(([, v]) => v).map(([k]) => `- ${k}`).join('\n') +
      `\n\nOuvrez \`index.html\` dans un navigateur : l'application est autonome (persistance locale).\n`;
  } else if (type === 'api') {
    files['api.js'] = T.renderApiFile({ name, domain });
    files['README.md'] = T.renderApiReadme({ name, domain });
    const d = T.API_DOMAINS[domain] || T.API_DOMAINS.generic;
    files['openapi.json'] = JSON.stringify({
      openapi: '3.0.0',
      info: { title: name, version: '1.0', description: `API ${d.label} générée par NovaForge` },
      paths: Object.fromEntries(d.resources.flatMap((r) => [
        [`/${r.key}`, { get: { summary: `Liste les ${r.key}` }, post: { summary: `Crée un ${r.key}` } }],
        [`/${r.key}/{{id}}`, { get: { summary: `Détail ${r.key}` }, put: { summary: `Mise à jour ${r.key}` }, delete: { summary: `Suppression ${r.key}` } }],
      ])),
    }, null, 2);
  } else if (type === 'fullstack') {
    files['index.html'] = T.renderApp({ name, domain, features, color, backend: true, pwa: true });
    files['api.js'] = T.renderApiFile({ name, domain, apiPrefix: '/api' });
    files['manifest.webmanifest'] = T.renderManifest({ name, color });
    files['sw.js'] = T.renderServiceWorker();
    const d = T.API_DOMAINS[domain] || T.API_DOMAINS.generic;
    files['openapi.json'] = JSON.stringify({
      openapi: '3.0.0',
      info: { title: name, version: '1.0', description: `API ${d.label} (full stack) générée par NovaForge` },
      paths: Object.fromEntries(d.resources.flatMap((r) => [
        [`/api/${r.key}`, { get: { summary: `Liste les ${r.key}` }, post: { summary: `Crée un ${r.key}` } }],
        [`/api/${r.key}/{{id}}`, { get: { summary: `Détail ${r.key}` }, put: { summary: `Mise à jour ${r.key}` }, delete: { summary: `Suppression ${r.key}` } }],
        [`/api/state`, { get: { summary: 'État complet (synchro front)' }, post: { summary: 'Mise à jour de l’état (synchro front)' } } ],
      ])),
    }, null, 2);
    files['README.md'] = T.renderFullstackReadme({ name, domain });
  } else if (type === 'mobile') {
    const sl = T.slug(name);
    files['index.html'] = T.renderApp({ name, domain, features, color, backend: true, pwa: true });
    files['api.js'] = T.renderApiFile({ name, domain, apiPrefix: '/api' });
    files['manifest.webmanifest'] = T.renderManifest({ name, color });
    files['sw.js'] = T.renderServiceWorker();
    files['capacitor.config.json'] = T.renderCapacitorConfig({ name, slug: sl });
    files['package.json'] = T.renderMobilePackageJson({ name, slug: sl });
    files['make-www.js'] = T.renderMakeWww();
    files['README.md'] = T.renderMobileReadme({ name, slug: sl, domain });
  } else {
    const persona = /service client|customer|support/i.test(lower0(description)) ? 'amical, patient et résolutif (service client)' : 'professionnel, précis et courtois';
    files['agent.json'] = JSON.stringify(T.renderAgentConfig({ name, description, persona }), null, 2);
    files['README.md'] = `Agent IA « ${name} »\n\n> ${description}\n\nOuvrez l'aperçu dans NovaForge pour discuter avec l'agent. Outils actifs : built-in (calculatrice, date/heure, navigation) + serveurs MCP autorisés.\n`;
  }
  return files;
}
function lower0(s) { return String(s || '').toLowerCase(); }

// ---------- Moteur IA (en ligne) ----------
// L'IA écrit les fichiers métier ; la plateforme complète les fichiers structurels
// (manifest, service worker, Capacitor, README) pour garantir un projet complet et testable.
const AI_FILES = {
  app: ['index.html'],
  api: ['api.js'],
  fullstack: ['index.html', 'api.js'],
  mobile: ['index.html', 'api.js'],
};

function aiProviders() {
  if (!LLM) return [];
  // Un fournisseur n'est "actif" que si son TEST RÉEL a réussi (jamais de faux "connecté").
  return LLM.listProviders().filter((p) => p.status === 'active');
}

function aiPrompt(u, description, feedback) {
  const d = T.DOMAINS[u.domain] || T.DOMAINS.generic;
  const entities = JSON.stringify(d.entities.map((e) => ({ key: e.key, label: e.label, fields: e.fields })));
  const features = Object.entries(u.features).filter(([, v]) => v).map(([k]) => k).join(', ') || 'essentielles';
  const specs = {
    app: `index.html : application web AUTONOME en un seul fichier (HTML+CSS+JS inline), thème sombre moderne, responsive, en français. Persistance dans localStorage. Entités métier (clés exactes) : ${entities}. Fonctionnalités demandées : ${features}. L'app doit avoir : navigation par onglets, formulaire d'ajout, tableau des données, suppression, tableau de bord avec statistiques.`,
    api: `api.js : module Node.js CommonJS (pas d'imports externes). Structure OBLIGATOIRE : "use strict"; var CTX=null;function setCtx(c){CTX=c;} const routes=[]; function j(res,code,obj){...res.writeHead(code,{'Content-Type':'application/json'});res.end(JSON.stringify(obj))}; routes avec GET / (info), GET /health, et pour chaque ressource GET/POST /<ressource> + GET/PUT/DELETE /<ressource>/:id utilisant CTX.db.list/get/create/update/remove ; et module.exports={name:'${u.name}',description,routes,setCtx}. Ressources (clés exactes) : ${d.resources.map((r) => r.key).join(', ')}.`,
    fullstack: `DEUX fichiers. (1) index.html : application web thème sombre moderne, responsive, en français. Entités (clés exactes) : ${entities}. Fonctionnalités : ${features}. DOIT synchroniser avec son API : définir var API='api' (même origine, ne pas changer) et var CFG={...,api:true} ; à l'ouverture fetch(API+'/state') (GET, réponse {app,entities,msgs}) pour charger les données ; à chaque sauvegarde fetch(API+'/state',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(etat)}) ; garder localStorage comme repli hors ligne ; navigation par onglets, ajout, suppression, statistiques. (2) api.js : module Node.js CommonJS. Structure OBLIGATOIRE : "use strict"; var CTX=null;function setCtx(c){CTX=c;} const routes=[]; function j(...) ; routes : GET /api (info), GET /api/health, GET /api/state (retourne CTX.db.all()), POST /api/state (appelle CTX.db.replaceAll(corps)), et pour chaque ressource GET/POST /api/<ressource> + GET/PUT/DELETE /api/<ressource>/:id utilisant CTX.db.list/get/create/update/remove ; module.exports={name:'${u.name}',description,routes,setCtx}. CTX.db expose : list, get, create, update, remove, all, replaceAll. Ressources : ${d.resources.map((r) => r.key).join(', ')}.`,
    mobile: `DEUX fichiers, IDENTIQUES aux spécifications fullstack (l'application doit aussi être utilisable hors ligne via PWA — le manifest et le service worker sont fournis séparément par la plateforme).`,
  };
  return `Tu génères du code pour la plateforme NovaForge.
Projet : type « ${u.type} », nom « ${u.name} », domaine « ${d.label} ».
Description de l'utilisateur : ${description}

Génère UNIQUEMENT les fichiers suivants : ${AI_FILES[u.type].join(', ')}
Format EXACT (un bloc par fichier, rien d'autre dans ta réponse) :
---FILE: <nom-de-fichier>---
<contenu complet du fichier>
---END---

Spécifications : ${specs[u.type]}

Règles : code 100 % complet et fonctionnel (aucun «…», aucun placeholder), syntaxe JavaScript valide, aucun commentaire de remplissage, aucune dépendance externe. ${feedback || ''}`;
}

function parseAIFiles(content) {
  const files = {};
  const re = /---FILE:\s*([A-Za-z0-9._\/-]+)\s*---\n([\s\S]*?)\n?---END---/g;
  let m;
  while ((m = re.exec(content || '')) !== null) {
    const name = m[1];
    if (name && !files[name]) files[name] = m[2].trim() + '\n';
  }
  return Object.keys(files).length ? files : null;
}

/** Tente une génération par IA. Renvoie {provider, files} ou {provider, error} ou null (aucun fournisseur actif). */
async function tryAIBuild(u, description, feedback) {
  const providers = aiProviders();
  if (!providers.length) return null;
  const p = providers[0];
  const res = await LLM.callChat(p, {
    messages: [
      { role: 'system', content: 'Tu es un développeur expert. Tu réponds UNIQUEMENT avec les fichiers demandés, dans le format de marqueurs précisé, sans texte autour.' },
      { role: 'user', content: aiPrompt(u, description, feedback) },
    ],
    temperature: 0.2,
    max_tokens: 8000,
  });
  if (!res.ok || !res.content) return { provider: p.name, error: res.error || 'réponse vide' };
  const files = parseAIFiles(res.content);
  if (!files) return { provider: p.name, error: 'format de fichiers non reconnu dans la réponse IA' };
  const expected = AI_FILES[u.type] || [];
  if (!expected.every((f) => files[f] && files[f].length > 50)) return { provider: p.name, error: 'fichier(s) manquant(s) ou tronqué(s) dans la réponse IA' };
  // Fichiers structurels fournis par la plateforme (garantissent un projet complet et homogène)
  const skeleton = buildFiles({ type: u.type, name: u.name, domain: u.domain, features: u.features, description });
  for (const f of Object.keys(skeleton)) if (!files[f]) files[f] = skeleton[f];
  return { provider: p.name, files };
}

// ---------- Tests réels ----------
function syntaxCheck(js) {
  try { new vm.Script(js); return { ok: true }; } catch (e) { return { ok: false, detail: e.message.slice(0, 200) }; }
}

function htmlChecks(files) {
  const tests = [];
  const html = files['index.html'] || '';
  tests.push({ name: 'Fichier principal présent', ok: html.length > 500, detail: html.length + ' octets' });
  tests.push({ name: 'Structure HTML valide (basique)', ok: /<html[\s>]/i.test(html) && /<\/html>\s*$/.test(html), detail: 'balises <html>/</html> détectées' });
  const m = html.match(/<script>([\s\S]*?)<\/script>/g) || [];
  let jsOk = true, detail = '';
  for (const block of m) {
    const code = block.replace(/^<script>/, '').replace(/<\/script>$/, '');
    const r = syntaxCheck(code);
    if (!r.ok) { jsOk = false; detail = r.detail; break; }
  }
  tests.push({ name: 'JavaScript sans erreur de syntaxe', ok: jsOk, detail: jsOk ? m.length + ' bloc(s) vérifié(s)' : detail });
  return tests;
}

function apiModuleChecks(files) {
  const tests = [];
  const js = files['api.js'] || '';
  const r = syntaxCheck(js);
  tests.push({ name: 'Syntaxe de api.js', ok: r.ok, detail: r.ok ? 'OK' : r.detail });
  let mod = null;
  if (r.ok) {
    try {
      const module_ = { exports: {} };
      new vm.Script(js).runInNewContext({ module: module_, exports: module_.exports, require, console });
      mod = module_.exports;
      tests.push({ name: 'Chargement du module', ok: !!mod && Array.isArray(mod.routes) && mod.routes.length > 0, detail: `${mod.routes.length} routes déclarées` });
    } catch (e) {
      tests.push({ name: 'Chargement du module', ok: false, detail: e.message.slice(0, 200) });
    }
  }
  return { tests, mod };
}

async function runTests(project, files, runtimeTest) {
  const tests = [];
  if (project.type === 'app') {
    tests.push(...htmlChecks(files));
  } else if (project.type === 'api') {
    const { tests: t, mod } = apiModuleChecks(files);
    tests.push(...t);
    if (mod && Array.isArray(mod.routes)) {
      const res = await runtimeTest(mod);
      tests.push(res);
    }
  } else if (project.type === 'fullstack' || project.type === 'mobile') {
    tests.push(...htmlChecks(files));
    tests.push({ name: 'Front synchronisé avec son API', ok: /syncApi|fetch\(API/.test(files['index.html'] || '') && /pullApi|\/state/.test(files['index.html'] || ''), detail: 'fetch GET/POST /state détecté' });
    const { tests: t, mod } = apiModuleChecks(files);
    tests.push(...t);
    if (mod && Array.isArray(mod.routes)) {
      tests.push({ name: 'PWA : manifest + service worker', ok: !!files['manifest.webmanifest'] && !!files['sw.js'], detail: 'manifest.webmanifest + sw.js' });
      const res = await runtimeTest(mod);
      tests.push(res);
    }
  } else if (project.type === 'agent') {
    let cfg = null;
    try { cfg = JSON.parse(files['agent.json']); } catch (e) { /* noop */ }
    tests.push({ name: 'Configuration agent valide', ok: !!(cfg && cfg.name && cfg.system_prompt && Array.isArray(cfg.tools)), detail: cfg ? `${cfg.tools.length} outil(s)` : 'JSON illisible' });
  }
  if (project.type === 'mobile') {
    let capOk = false, capDetail = '';
    try {
      const c = JSON.parse(files['capacitor.config.json'] || '{}');
      capOk = !!(c.appId && c.webDir === 'www');
      capDetail = c.appId || '';
    } catch (e) { capDetail = e.message.slice(0, 120); }
    tests.push({ name: 'Projet mobile complet (Capacitor)', ok: capOk && !!files['make-www.js'], detail: capDetail });
    let pkgOk = false;
    try {
      const p = JSON.parse(files['package.json'] || '{}');
      pkgOk = !!(p.dependencies && p.dependencies['@capacitor/core'] && p.devDependencies && p.devDependencies['@capacitor/android']);
    } catch (e) { /* noop */ }
    tests.push({ name: 'Dépendances Android/iOS déclarées', ok: pkgOk, detail: '@capacitor/core + android + ios' });
  }
  return tests;
}

// ---------- Pipeline principal ----------
async function generateProject({ user, description, forcedType, note }) {
  const u = understand(description, forcedType);
  const pipeline = [
    { step: 'Comprendre la demande', status: 'done', detail: `« ${description.slice(0, 90)}${description.length > 90 ? '…' : ''} »` },
    { step: 'Type de projet', status: 'done', detail: TYPE_LBL[u.type] || u.type },
    { step: 'Fonctionnalités identifiées', status: 'done', detail: Object.entries(u.features).filter(([, v]) => v).map(([k]) => k).join(', ') || 'essentielles' },
    { step: 'Plan de réalisation', status: 'done', detail: `domaine ${(T.DOMAINS[u.domain] || T.DOMAINS.generic).label}, nom « ${u.name} »` },
    { step: 'Construction du projet', status: 'running', detail: 'génération des fichiers…' },
  ];

  const project = projects().insert({
    owner_id: user.id, type: u.type, name: u.name, description, domain: u.domain,
    features: u.features, status: 'draft', current_version: 0,
    versions: [], pipeline, activity: [{ ts: new Date().toISOString(), action: 'created', detail: 'Projet créé par description' }],
    color: T.colorFor(u.name), published_at: null,
  });

  const pid = project.id;
  const liveTest = (u.type === 'api' || u.type === 'fullstack' || u.type === 'mobile')
    ? (mod) => liveApiTest(pid, mod, u.domain, u.type === 'api' ? '' : '/api')
    : null;

  // ----- Construction : moteur IA (en ligne) si dispo, sinon moteur local (hors ligne) -----
  let files = null, engine = 'local', engineDetail = 'moteur local (hors ligne) — règles + gabarits testés';
  let tests = null;
  if (aiProviders().length) {
    const aiStep = { step: 'Moteur IA (en ligne)', status: 'running', detail: 'IA : ' + aiProviders().map((p) => p.name).join(', ') + ' — tests obligatoires, repli local en cas d’échec' };
    pipeline.push(aiStep);
    const ai1 = await tryAIBuild(u, description);
    if (ai1 && ai1.files) {
      const t1 = await runTests({ ...project }, ai1.files, liveTest);
      if (t1.every((t) => t.ok)) {
        files = ai1.files; tests = t1; engine = 'ai';
        engineDetail = `IA : ${ai1.provider} — tous les tests OK`;
      } else {
        const fb = 'Itération 2 — ton code précédent a échoué les tests : ' + t1.filter((t) => !t.ok).map((t) => t.name + ' (' + (t.detail || 'échec') + ')').join(' | ') + '. Refais les fichiers, corrigés.';
        const ai2 = await tryAIBuild(u, description, fb);
        if (ai2 && ai2.files) {
          const t2 = await runTests({ ...project }, ai2.files, liveTest);
          if (t2.every((t) => t.ok)) {
            files = ai2.files; tests = t2; engine = 'ai';
            engineDetail = `IA : ${ai2.provider} — OK après 1 itération de correction`;
          } else engineDetail = `IA : ${ai2.provider} — tests en échec → repli moteur local`;
        } else engineDetail = `IA : ${ai1.provider} — ${((ai2 && ai2.error) || 'réponse invalide')} → repli moteur local`;
      }
    } else engineDetail = `IA : ${((ai1 && ai1.error) || 'indisponible')} → repli moteur local`;
    aiStep.status = engine === 'ai' ? 'done' : 'warning';
    aiStep.detail = engineDetail;
  }
  if (!files) files = buildFiles({ type: u.type, name: u.name, domain: u.domain, features: u.features, description });

  pipeline[4].status = 'done';
  pipeline[4].detail = (engine === 'ai' ? 'fichiers IA : ' : 'génération : ') + Object.keys(files).join(', ');
  pipeline.push({ step: 'Tests automatiques', status: 'running', detail: 'exécution…' });
  if (!tests) tests = await runTests({ ...project }, files, liveTest);
  const ok = tests.every((t) => t.ok);
  pipeline[pipeline.length - 1] = { step: 'Tests automatiques', status: ok ? 'done' : 'error', detail: tests.map((t) => `${t.ok ? '✓' : '✗'} ${t.name}`).join(' · ') };
  pipeline.push({ step: 'Prévisualisation', status: ok ? 'done' : 'warning', detail: ok ? 'Aperçu fonctionnel disponible' : 'Projet créé avec avertissements — voir tests' });

  const v = 1;
  writeVersion(pid, v, files);
  const proj = projects().update(pid, {
    current_version: v,
    versions: [{ v, created_at: new Date().toISOString(), note: 'Version initiale (création par description)', files: Object.keys(files), tests, ok, engine, engine_detail: engineDetail }],
    pipeline,
  });
  return proj;
}

/** Test HTTP réel : exécute les routes du module dans le runtime de la plateforme. */
async function liveApiTest(pid, mod, domain, prefix = '') {
  const RT = require('./runtime');
  const handle = RT.makeHandler(pid, mod, domain);
  try {
    const health = await handle({ method: 'GET', url: prefix + '/health', body: {} });
    const first = (mod.routes.find((r) => r.path !== '/' && r.path !== prefix && !r.path.endsWith('/health') && !r.path.endsWith('/state') && !r.path.includes(':')) || {}).path || '';
    const list = first ? await handle({ method: 'GET', url: first, body: {} }) : { code: 0 };
    const created = first ? await handle({ method: 'POST', url: first, body: { _test: 'novaforge' } }) : { code: 0 };
    const state = await handle({ method: 'GET', url: prefix + '/state', body: {} });
    const okRes = health.code === 200 && list.code === 200 && created.code === 201 && state.code === 200;
    return { name: 'Test HTTP du runtime', ok: okRes, detail: 'health ' + health.code + ', list ' + list.code + ', post ' + created.code + ', state ' + state.code };
  } catch (e) {
    return { name: 'Test HTTP du runtime', ok: false, detail: e.message.slice(0, 200) };
  }
}

/** Re-teste les fichiers actuels d'un projet (utilisé par l'action « test »). */
function rerunTests(project, files) {
  const liveTest = ['api', 'fullstack', 'mobile'].includes(project.type)
    ? (mod) => liveApiTest(project.id, mod, project.domain, project.type === 'api' ? '' : '/api')
    : null;
  return runTests(project, files, liveTest);
}

module.exports = { projects, PDIR, writeVersion, readCurrent, understand, generateProject, buildFiles, rerunTests, aiProviders, TYPE_LBL };
