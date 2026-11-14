'use strict';
// Backend Supabase (PostgREST) — même interface synchrone que le store JSON local.
// - Lecture : cache mémoire, rechargé au démarrage du serveur (ready()).
// - Écriture : cache mis à jour immédiatement + persistance asynchrone dans Supabase.
// - La clé service_role ne quitte jamais le serveur (jamais exposée au navigateur).
const fs = require('fs');
const path = require('path');
const { now } = require('./util');

function loadConfig() {
  try {
    if (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_KEY) {
      return { url: process.env.SUPABASE_URL.replace(/\/$/, ''), key: process.env.SUPABASE_SERVICE_KEY };
    }
    const f = path.join(__dirname, '..', '..', 'supabase.config.json');
    if (fs.existsSync(f)) {
      const c = JSON.parse(fs.readFileSync(f, 'utf8'));
      if (c.url && c.key) return { url: c.url.replace(/\/$/, ''), key: c.key };
    }
  } catch (e) {
    console.error('[supabase] configuration illisible :', e.message);
  }
  return null;
}

const cfg = loadConfig();

if (!cfg) {
  module.exports = null; // pas de config → db.js retombe sur le store local
} else {
  (function () {
    const BASE = cfg.url + '/rest/v1/nfx_data';
    const H = { apikey: cfg.key, Authorization: 'Bearer ' + cfg.key, 'Content-Type': 'application/json' };
    const cache = {}; // table -> Map(key -> row)
    const pending = [];
    let flushing = false;

    async function getJSON(method, qs, body) {
      const r = await fetch(BASE + '?' + qs, { method, headers: H, body: body ? JSON.stringify(body) : undefined });
      const text = await r.text();
      if (!r.ok && r.status !== 404) throw new Error('PostgREST ' + r.status + ' : ' + text.slice(0, 200));
      if (!text) return [];
      return JSON.parse(text);
    }

    /** Charge le cache complet depuis Supabase (à appeler avant d'accepter les requêtes). */
    async function ready() {
      const rows = await getJSON('GET', 'select=table_name');
      const names = [...new Set(rows.map((x) => x.table_name))];
      for (const n of names) {
        const data = await getJSON('GET', 'table_name=eq.' + encodeURIComponent(n) + '&select=key,data');
        const m = new Map();
        for (const r of data) m.set(r.key, r.data);
        cache[n] = m;
      }
      console.log('[supabase] cache chargé : ' + names.length + ' table(s) depuis ' + cfg.url);
    }

    function scheduleWrite(fn) {
      pending.push(fn);
      if (flushing) return;
      flushing = true;
      (async () => {
        let fails = 0;
        while (pending.length) {
          const w = pending.shift();
          try {
            await w();
            fails = 0;
          } catch (e) {
            fails++;
            console.error('[supabase] écriture échouée (retrait) :', e.message);
            if (fails >= 5) { console.error('[supabase] file d’écriture saturée, abandon des écritures en attente.'); break; }
            pending.unshift(w);
            await new Promise((r) => setTimeout(r, 1500));
          }
        }
        flushing = false;
      })();
    }

    function nextId(m) {
      let max = 0;
      for (const r of m.values()) if (typeof r.id === 'number' && r.id > max) max = r.id;
      return max + 1;
    }

    function table(name) {
      let m = cache[name];
      if (!m) { m = new Map(); cache[name] = m; }
      return {
        _name: name,
        get(id) { const r = m.get(name + ':' + id); return r ? JSON.parse(JSON.stringify(r)) : null; },
        raw(id) { return m.get(name + ':' + id) || null; },
        list() { return [...m.values()].map((r) => JSON.parse(JSON.stringify(r))); },
        find(pred) { const r = [...m.values()].find(pred); return r ? JSON.parse(JSON.stringify(r)) : null; },
        where(pred) { return [...m.values()].filter(pred).map((r) => JSON.parse(JSON.stringify(r))); },
        insert(obj) {
          const row = Object.assign({ created_at: now() }, obj);
          if (row.id === undefined || row.id === null) row.id = nextId(m);
          const key = name + ':' + row.id;
          m.set(key, row);
          const payload = { key, table_name: name, data: JSON.parse(JSON.stringify(row)), updated_at: now() };
          scheduleWrite(async () => {
            const r = await fetch(BASE, { method: 'POST', headers: { ...H, Prefer: 'return=minimal' }, body: JSON.stringify([payload]) });
            if (!r.ok && r.status !== 204) throw new Error('insert ' + r.status);
          });
          return JSON.parse(JSON.stringify(row));
        },
        update(id, patch) {
          const key = name + ':' + id;
          const cur = m.get(key);
          if (!cur) return null;
          Object.assign(cur, patch, { updated_at: now() });
          const payload = { key, table_name: name, data: JSON.parse(JSON.stringify(cur)), updated_at: cur.updated_at };
          scheduleWrite(async () => {
            const r = await fetch(BASE + '?key=eq.' + encodeURIComponent(key), { method: 'PATCH', headers: H, body: JSON.stringify(payload) });
            if (!r.ok) throw new Error('update ' + r.status);
          });
          return JSON.parse(JSON.stringify(cur));
        },
        remove(id) {
          const key = name + ':' + id;
          const had = m.delete(key);
          if (had) scheduleWrite(async () => {
            const r = await fetch(BASE + '?key=eq.' + encodeURIComponent(key), { method: 'DELETE', headers: H });
            if (!r.ok) throw new Error('delete ' + r.status);
          });
          return had;
        },
        count() { return m.size; },
      };
    }

    /** Sauvegarde : dump complet du cache (les données sont déjà dans Supabase). */
    function snapshot() {
      const dir = path.join(__dirname, '..', '..', 'data', 'backups');
      fs.mkdirSync(dir, { recursive: true });
      const file = path.join(dir, 'supabase-dump-' + new Date().toISOString().replace(/[:.]/g, '-') + '.json');
      const dump = {};
      for (const [n, m] of Object.entries(cache)) {
        dump[n] = {};
        for (const [k, v] of m) dump[n][k] = v;
      }
      fs.writeFileSync(file, JSON.stringify(dump, null, 1));
      return file;
    }

    module.exports = { ready, table, snapshot, backend: 'supabase' };
  })();
}
