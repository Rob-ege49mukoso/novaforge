'use strict';
// Runtime de la plateforme : héberge les API générées (aperçu réel, tests réels).
const fs = require('fs');
const path = require('path');
const T = require('./templates');
const vm = require('vm');
const db = require('../lib/db');

const storeFile = (pid) => path.join(db.DATA_DIR, 'projects', String(pid), 'runtime.json');

function loadState(pid) {
  try { return JSON.parse(fs.readFileSync(storeFile(pid), 'utf8')); } catch { return null; }
}
function saveState(pid, s) {
  fs.mkdirSync(path.dirname(storeFile(pid)), { recursive: true });
  fs.writeFileSync(storeFile(pid), JSON.stringify(s, null, 2));
}

/** Fabrique un handler {method,url,body} -> Promise<{code,data}> pour un module d'API. */
function makeHandler(pid, mod, projectDomain) {
  let state = loadState(pid);
  if (!state) {
    state = {};
    const d = T.API_DOMAINS[projectDomain] || T.API_DOMAINS.generic;
    for (const r of d.resources) state[r.key] = (r.seed || []).map((x) => JSON.parse(JSON.stringify(x)));
    saveState(pid, state);
  }
  const dbApi = {
    list: (k) => state[k] || [],
    get: (k, id) => (state[k] || []).find((r) => String(r.id) === String(id)),
    create: (k, body) => {
      state[k] = state[k] || [];
      const id = state[k].length ? Math.max(...state[k].map((r) => r.id || 0)) + 1 : 1;
      const it = { id, ...body };
      state[k].push(it);
      saveState(pid, state);
      return it;
    },
    update: (k, id, body) => {
      const it = dbApi.get(k, id);
      if (!it) return null;
      Object.assign(it, body);
      saveState(pid, state);
      return it;
    },
    remove: (k, id) => {
      const arr = state[k] || [];
      const i = arr.findIndex((r) => String(r.id) === String(id));
      if (i < 0) return false;
      arr.splice(i, 1);
      saveState(pid, state);
      return true;
    },
    all: () => ({
      app: state.app || '',
      entities: Object.fromEntries(Object.keys(state).filter((k) => Array.isArray(state[k])).map((k) => [k, state[k]])),
      msgs: state.msgs || [],
    }),
    replaceAll: (s) => {
      const n = {};
      if (s && s.entities) for (const k in s.entities) if (Array.isArray(s.entities[k])) n[k] = s.entities[k].map((x) => ({ ...x }));
      n.msgs = Array.isArray(s.msgs) ? s.msgs : [];
      n.app = s.app || '';
      state = n;
      saveState(pid, state);
      return true;
    },
  };
  const ctx = { db: dbApi };
  if (typeof mod.setCtx === 'function') mod.setCtx(ctx);
  return function handle(q) {
    return new Promise((resolve) => {
      let res = {
        _code: 200,
        writeHead(c) { this._code = c; },
        end(data) { resolve({ code: this._code, data: String(data == null ? '' : data) }); },
      };
      let done = false;
      res.end = (data) => { if (done) return; done = true; resolve({ code: res._code, data: String(data == null ? '' : data) }); };
      try {
        const segs = (q.url || '/').split('?')[0].split('/').filter(Boolean);
        for (const r of mod.routes || []) {
          const ssegs = r.path.split('/').filter(Boolean);
          if (r.method !== (q.method || 'GET') || ssegs.length !== segs.length) continue;
          const params = {};
          let ok = true;
          ssegs.forEach((s, i) => {
            if (s.startsWith(':')) params[s.slice(1)] = decodeURIComponent(segs[i]);
            else if (s !== segs[i]) ok = false;
          });
          if (!ok) continue;
          const out = r.handler({ params, body: q.body || {} }, res, ctx);
          if (out && out.then) out.then(() => { if (!done) res.end(''); }, () => { if (!done) res.end(''); });
          return;
        }
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'route introuvable' }));
      } catch (e) {
        if (!done) { res._code = 500; res.end(JSON.stringify({ error: e.message })); }
      }
    });
  };
}

/** Charge uniquement un module reconstruit depuis les métadonnées fiables.
 * Les fichiers api.js téléversés/modifiables sont des données et ne sont jamais exécutés.
 */
function loadProjectModule(pid) {
  const project = db.table('projects').get(pid);
  if (!project || !['api', 'fullstack', 'mobile'].includes(project.type)) return null;
  const safeName = String(project.name || 'NovaForge API').replace(/[^\\p{L}\\p{N} _.-]/gu, '').slice(0, 60) || 'NovaForge API';
  const prefix = project.type === 'api' ? '' : '/api';
  const code = T.renderApiFile({ name: safeName, domain: project.domain || 'generic', apiPrefix: prefix });
  const moduleObject = { exports: {} };
  const sandbox = { module: moduleObject, exports: moduleObject.exports };
  vm.runInNewContext(code, sandbox, { timeout: 100, filename: 'novaforge-generated-api.js' });
  return moduleObject.exports;
}

module.exports = { makeHandler, loadProjectModule, loadState };
