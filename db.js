'use strict';
// Couche de stockage — fichiers JSON atomiques (0 dépendance).
// Interface volontairement simple : la table de stockage est isolée ici,
// ce qui permet de brancher SQLite/PostgreSQL plus tard sans toucher aux routes.
const fs = require('fs');
const path = require('path');
const { now } = require('./util');

const DATA_DIR = process.env.NOVAFORGE_DATA_DIR || path.join(__dirname, '..', '..', 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');

let state = { tables: {} };
let saveTimer = null;

function ensureDirs() {
  for (const d of [DATA_DIR, path.join(DATA_DIR, 'projects'), path.join(DATA_DIR, 'proofs')]) {
    fs.mkdirSync(d, { recursive: true });
  }
}

function load() {
  ensureDirs();
  if (fs.existsSync(DB_FILE)) {
    try {
      state = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
    } catch (e) {
      throw new Error('db.json corrompu : ' + e.message);
    }
  } else {
    state = { tables: {} };
  }
  if (!state.tables) state.tables = {};
}

function persist() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    try {
      fs.mkdirSync(DATA_DIR, { recursive: true });
      const tmp = DB_FILE + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(state));
      fs.renameSync(tmp, DB_FILE);
    } catch (e) {
      console.error('[db] persist error:', e.message);
    }
  }, 150);
}

function table(name) {
  let t = state.tables[name];
  if (!t) {
    t = { rows: {}, seq: 0 };
    state.tables[name] = t;
  }
  return {
    _name: name,
    get(id) {
      const r = t.rows[String(id)];
      return r ? JSON.parse(JSON.stringify(r)) : null;
    },
    raw(id) {
      return t.rows[String(id)] || null;
    },
    list() {
      return Object.values(t.rows).map((r) => JSON.parse(JSON.stringify(r)));
    },
    find(pred) {
      return Object.values(t.rows).find(pred) || null;
    },
    where(pred) {
      return Object.values(t.rows).filter(pred).map((r) => JSON.parse(JSON.stringify(r)));
    },
    insert(obj) {
      if (obj.id === undefined || obj.id === null) {
        t.seq += 1;
        obj.id = t.seq;
      } else if (typeof obj.id === 'number' && obj.id > t.seq) {
        t.seq = obj.id;
      }
      const row = Object.assign({ created_at: now() }, obj);
      t.rows[String(row.id)] = row;
      persist();
      return JSON.parse(JSON.stringify(row));
    },
    update(id, patch) {
      const r = t.rows[String(id)];
      if (!r) return null;
      Object.assign(r, patch, { updated_at: now() });
      persist();
      return JSON.parse(JSON.stringify(r));
    },
    remove(id) {
      const r = t.rows[String(id)];
      if (r) {
        delete t.rows[String(id)];
        persist();
      }
      return !!r;
    },
    count() {
      return Object.keys(t.rows).length;
    },
  };
}

function snapshot() {
  // Sauvegarde datée de la base (restauration possible).
  ensureDirs();
  const file = path.join(DATA_DIR, 'backups', `db-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(state));
  return file;
}

load();

// --- Bascule de backend : Supabase si configuré, sinon store local JSON ---
// (l'isolation de la couche de stockage permet ce basculement sans toucher aux routes)
let SB = null;
try { SB = require('./supabase-db'); } catch (e) { console.error('[db] backend Supabase indisponible :', e.message); }
if (SB) console.log('[db] backend actif : Supabase');

module.exports = {
  table: (name) => (SB ? SB.table(name) : table(name)),
  snapshot: () => (SB ? SB.snapshot() : snapshot()),
  ready: SB ? SB.ready : () => Promise.resolve(),
  backend: () => (SB ? 'supabase' : 'local'),
  DATA_DIR,
};
