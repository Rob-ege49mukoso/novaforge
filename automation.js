'use strict';
// Moteur d'automatisation — contrôle la machine où la plateforme est installée.
// Tâches en ligne (requêtes HTTP, navigation) et hors ligne (fichiers).
// L'exécution shell reste désactivée jusqu'à l'ajout d'un exécuteur isolé.
const db = require('./db');
const fs = require('fs');
const path = require('path');
const { now } = require('./util');
const { validateOutboundUrl, readLimited } = require('./network');

const WS = path.join(__dirname, '..', '..', 'automation_ws');
const TASKS = () => db.table('automation_tasks');
let timer = null;

function ensureWS() {
  fs.mkdirSync(WS, { recursive: true });
}

function safePath(p) {
  ensureWS();
  const abs = path.resolve(WS, String(p || ''));
  if (abs !== WS && !abs.startsWith(WS + path.sep)) return null;
  return abs;
}

function listTasks(userId) {
  return TASKS().where((t) => t.user_id === userId).sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
}

function getTask(id, userId) {
  const t = TASKS().get(id);
  return t && t.user_id === userId ? t : null;
}

function pushHistory(t, entry) {
  const h = t.history || [];
  h.push(entry);
  if (h.length > 50) h.splice(0, h.length - 50);
  TASKS().update(t.id, { history: h });
}

/** Analyse une description naturelle (FR/EN) en action structurée. */
function parseDescription(text) {
  const t = String(text || '').trim();
  const lower = t.toLowerCase();
  const urlRe = /https?:\/\/[^\s"'<>]+/i;
  const url = (t.match(urlRe) || [])[0] || null;

  // Planification
  let kind = 'onetime';
  let at = null;
  let time = null;
  let m = lower.match(/tous les jours à\s+(\d{1,2})h(?:\s*(\d{2}))?/);
  if (m) { kind = 'daily'; time = `${m[1].padStart(2, '0')}:${(m[2] || '00').padStart(2, '0')}`; }
  m = lower.match(/(demain|chaque jour) à\s+(\d{1,2})h(?:\s*(\d{2}))?/);
  if (m && !time) { kind = 'daily'; time = `${m[2].padStart(2, '0')}:${(m[3] || '00').padStart(2, '0')}`; }
  m = t.match(/dans\s+(\d+)\s*(min|minute|h|heures?)/i);
  if (m) at = new Date(Date.now() + parseInt(m[1]) * (m[2][0] === 'h' ? 3600 : 60) * 1000).toISOString();
  m = lower.match(/à\s+(\d{1,2})h(?:\s*(\d{2}))?/);
  if (m && !at && !time) {
    const d = new Date(); d.setHours(parseInt(m[1]), parseInt(m[2] || 0), 0, 0);
    if (d.getTime() < Date.now()) d.setDate(d.getDate() + 1);
    at = d.toISOString();
  }

  // Action
  let action = null;
  const noUrl = t.replace(url || '', '').trim();

  if (/commande|terminal|shell|lance le processus|^lance |^execute /i.test(noUrl) && /commande|terminal|shell|^lance |^execute /i.test(noUrl)) {
    const cm = t.match(/(?:commande|terminal)\s*[:\-]?\s*(.{3,200})$/i) || t.match(/^lance\s+(.{5,200})$/i);
    if (cm) action = { type: 'run_command', params: { command: cm[1].trim() } };
  }
  if (!action && url) {
    if (/post|body|envoi/i.test(lower)) {
      const bm = t.match(/body\s*[:=]\s*(.+)$/i);
      action = { type: 'http_request', params: { url, method: 'POST', body: bm ? bm[1].trim() : '' } };
    } else if (/delete|supprime via|suppress/i.test(lower)) {
      action = { type: 'http_request', params: { url, method: 'DELETE' } };
    } else {
      action = /requete|http|api|test le|vérifie l'adresse|verifie l'adresse/i.test(lower)
        ? { type: 'http_request', params: { url, method: 'GET' } }
        : { type: 'web_fetch', params: { url } };
    }
  }
  if (!action) {
    let fm = t.match(/(?:crée|creer|create|ecrire|écri[sr])\s+(?:le\s+)?fichier\s+["']?([^"''\n]+)["']?\s*(?:avec|contenant)\s*[:\-]?\s*(.+)/is);
    if (fm) action = { type: 'create_file', params: { path: fm[1].trim(), content: fm[2].trim().replace(/["']+$/, '') } };
    else {
      fm = t.match(/(?:crée|creer|create)\s+(?:le\s+)?fichier\s+["']?([^"''\n]+)["']?/i);
      if (fm) action = { type: 'create_file', params: { path: fm[1].trim(), content: '' } };
    }
  }
  if (!action && /liste les fichiers|contenu du dossier|browse/i.test(lower)) action = { type: 'list_dir', params: { path: '.' } };
  if (!action && /info système|resume de l'appareil|system info|diagnostic/i.test(lower)) action = { type: 'system_info', params: {} };
  if (!action && url === null && /télécharge|telecharge|download/i.test(lower)) action = { type: 'web_fetch', params: { url: null } };

  return { action, kind, at, time };
}

function systemInfo() {
  const os = require('os');
  return {
    hostname: os.hostname(), platform: os.platform(), arch: os.arch(),
    node: process.version, cpus: os.cpus().length,
    mem_total_go: Math.round(os.totalmem() / 1073741824 * 10) / 10,
    mem_free_go: Math.round(os.freemem() / 1073741824 * 10) / 10,
    uptime_h: Math.round(os.uptime() / 3600),
    date: now(),
    workspace: WS,
  };
}

function nextDailyRun(timeStr) {
  const [h, mm] = timeStr.split(':').map((x) => parseInt(x));
  const d = new Date();
  d.setHours(h, mm, 0, 0);
  if (d.getTime() <= Date.now()) d.setDate(d.getDate() + 1);
  return d.toISOString();
}

async function executeAction(action) {
  const log = [];
  const add = (s) => log.push(s);
  switch (action.type) {
    case 'system_info':
      add(JSON.stringify(systemInfo(), null, 2));
      break;
    case 'run_command': {
      return { ok: false, log: ['Interdit : l’exécution de commandes shell est désactivée jusqu’à la mise en place d’un exécuteur isolé.'] };
    }
    case 'http_request': {
      const p = action.params;
      add(`${p.method || 'GET'} ${p.url}`);
      try {
        const url = await validateOutboundUrl(p.url, { requireHttps: process.env.NODE_ENV === 'production' });
        const r = await fetch(url, { method: p.method || 'GET', headers: p.headers || {}, body: p.body || undefined, redirect: 'error', signal: AbortSignal.timeout(15000) });
        const text = await readLimited(r, 1024 * 1024);
        add(`HTTP ${r.status} — ${text.slice(0, 2000)}`);
      } catch (e) {
        add('ERREUR RÉSEAU: ' + e.message);
        return { ok: false, log };
      }
      break;
    }
    case 'web_fetch': {
      const u = action.params.url;
      if (!u) return { ok: false, log: ['Aucune URL fournie.'] };
      add('GET ' + u);
      try {
        const url = await validateOutboundUrl(u, { requireHttps: process.env.NODE_ENV === 'production' });
        const r = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(15000) });
        const text = await readLimited(r, 1024 * 1024);
        add(`HTTP ${r.status} — ${Math.round(text.length / 1024)} Ko`);
        add('Extrait: ' + text.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').slice(0, 1200));
      } catch (e) {
        add('ERREUR RÉSEAU: ' + e.message);
        return { ok: false, log };
      }
      break;
    }
    case 'create_file': {
      const abs = safePath(action.params.path);
      if (!abs) return { ok: false, log: ['Chemin interdit (dehors de l’espace d’automatisation).'] };
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, String(action.params.content || ''), 'utf8');
      add(`Fichier écrit : ${path.relative(WS, abs)} (${Buffer.byteLength(action.params.content || '')} octets)`);
      break;
    }
    case 'read_file': {
      const abs = safePath(action.params.path);
      if (!abs || !fs.existsSync(abs)) return { ok: false, log: ['Fichier introuvable.'] };
      add(fs.readFileSync(abs, 'utf8').slice(0, 3000));
      break;
    }
    case 'list_dir': {
      const abs = safePath(action.params.path || '.');
      if (!abs) return { ok: false, log: ['Chemin interdit.'] };
      add((fs.readdirSync(abs, { withFileTypes: true }) || []).map((d) => (d.isDirectory() ? d.name + '/' : d.name)).join('\n'));
      break;
    }
    case 'copy_file': {
      const a = safePath(action.params.from), b = safePath(action.params.to);
      if (!a || !b) return { ok: false, log: ['Chemin interdit.'] };
      fs.mkdirSync(path.dirname(b), { recursive: true });
      fs.copyFileSync(a, b);
      add(`Copié : ${a} -> ${b}`);
      break;
    }
    case 'delete_file': {
      const abs = safePath(action.params.path);
      if (!abs) return { ok: false, log: ['Chemin interdit.'] };
      fs.rmSync(abs, { recursive: true, force: true });
      add('Supprimé : ' + abs);
      break;
    }
    default:
      return { ok: false, log: [`Action inconnue : ${action.type}`] };
  }
  return { ok: true, log };
}

async function runTask(taskId, { confirm = false } = {}) {
  const t = TASKS().get(taskId);
  if (!t) return { ok: false, error: 'Tâche introuvable.' };
  if (t.status === 'awaiting_confirmation' && !confirm) return { ok: false, error: 'Confirmation requise.', needs_confirmation: true };
  if (t.action && t.action.type === 'run_command' && !t.auto_approve && !confirm) {
    TASKS().update(taskId, { status: 'awaiting_confirmation' });
    return { ok: false, needs_confirmation: true, error: 'Cette tâche exécute une commande shell : votre confirmation est requise.' };
  }
  TASKS().update(taskId, { status: 'running' });
  const res = await executeAction(t.action || { type: 'system_info', params: {} });
  const entry = { ts: now(), status: res.ok ? 'done' : 'failed', log: (res.log || []).join('\n').slice(0, 6000), confirmed: confirm || undefined };
  pushHistory(t, entry);
  const patch = { status: res.ok ? (t.kind === 'daily' ? 'ready' : 'done') : 'failed', last_run: now() };
  if (t.kind === 'daily' && t.time) patch.next_run = nextDailyRun(t.time);
  TASKS().update(taskId, patch);
  return { ok: res.ok, log: res.log };
}

function startScheduler() {
  if (timer) return;
  timer = setInterval(() => {
    const current = now();
    const due = TASKS().where((t) =>
      t.status === 'ready' && t.next_run && t.next_run <= current &&
      (t.kind === 'daily' || t.kind === 'onetime')
    );
    for (const t of due) {
      if (t.kind === 'onetime' && t.next_run) TASKS().update(t.id, { next_run: null, at: null });
      runTask(t.id).catch((e) => pushHistory(t, { ts: now(), status: 'failed', log: e.message }));
    }
  }, 20000);
  timer.unref && timer.unref();
}

function createTask(userId, { description, explicit }) {
  ensureWS();
  let action = explicit && explicit.action ? explicit.action : null;
  let kind = explicit && explicit.kind ? explicit.kind : 'onetime';
  let at = explicit && explicit.at ? explicit.at : null;
  let time = explicit && explicit.time ? explicit.time : null;
  if (!action && description) {
    const p = parseDescription(description);
    if (!p.action) return { ok: false, error: 'Je n’ai pas compris l’action. Exemples : « fais une requête GET https://api.example.com », « lance la commande df -h », « tous les jours à 8h visite https://… ».' };
    action = p.action; kind = p.kind; at = p.at; time = p.time;
  }
  if (!action) return { ok: false, error: 'Action manquante.' };
  if (action.type === 'run_command') return { ok: false, error: 'Les commandes shell sont désactivées jusqu’à la mise en place d’un exécuteur isolé.' };
  if (kind === 'daily' && (!/^([01]\d|2[0-3]):[0-5]\d$/.test(String(time || '')))) return { ok: false, error: 'Heure quotidienne invalide (format HH:MM).' };
  const t = TASKS().insert({
    user_id: userId,
    name: explicit && explicit.name ? explicit.name.slice(0, 120) : String(description || action.type).slice(0, 120),
    description: description || '', kind, at: at || null, time: time || null,
    next_run: at || (time ? nextDailyRun(time) : null),
    action, auto_approve: !!(explicit && explicit.auto_approve),
    status: 'ready', history: [],
  });
  return { ok: true, task: t, needs_confirmation: false };
}

module.exports = {
  WS, listTasks, getTask, parseDescription, runTask, createTask, startScheduler,
  executeAction, systemInfo,
};
