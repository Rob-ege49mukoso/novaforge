'use strict';
// Politique de sortie réseau + ÉPINGLAGE D'IP (anti-DNS-rebinding).
//
// Constat (limite documentée en v1.3) : `validateOutboundUrl()` résolvait le
// DNS, puis l'appelant refaisait `fetch(url)` — qui résout DE NOUVEAU. Entre
// les deux résolutions, un attaquant pouvait rebindre le nom (première
// résolution → IP publique, seconde → IP privée) : fenêtre TOCTOU
// exploitable, même avec une politique d'URL correcte.
//
// Correction (v1.4) :
//   1. UNE SEULE résolution DNS par requête ;
//   2. validation de TOUTES les adresses obtenues (une seule adresse privée
//      suffit à rejeter la cible) ;
//   3. connexion à l'adresse validée via un `lookup` personnalisé
//      (node:http / node:https — zéro dépendance npm, pas d'undici) ;
//   4. le nom d'hôte est conservé pour l'en-tête Host, le SNI TLS et la
//      vérification du certificat : on ne dégrade pas la sécurité TLS ;
//   5. chaque redirection est re-résolue ET re-validée avant d'être suivie.
const dns = require('dns').promises;
const net = require('net');
const http = require('http');
const https = require('https');

const DEFAULT_TIMEOUT_MS = 20000;
const DEFAULT_MAX_REDIRECTS = 3;
const REDIRECT_STATUS = new Set([301, 302, 303, 307, 308]);

// ---------- Analyse des adresses ----------
/** Développe une adresse IPv6 en 8 groupes de 16 bits (null si invalide). */
function expandIPv6(ip) {
  let s = String(ip || '').split('%')[0].toLowerCase();
  // IPv4 en fin d'adresse : ::ffff:127.0.0.1
  let tail4 = null;
  const dotted = s.match(/^(.*:)((?:\d{1,3}\.){3}\d{1,3})$/);
  if (dotted) {
    tail4 = dotted[2];
    s = dotted[1];
  }
  const halves = s.split('::');
  if (halves.length > 2) return null;
  const parse = (g) => (/^[0-9a-f]{1,4}$/.test(g) ? parseInt(g, 16) : null);
  const head = halves[0] ? halves[0].split(':').filter(Boolean) : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(':').filter(Boolean) : [];
  const headVals = [];
  for (const g of head) { const v = parse(g); if (v === null) return null; headVals.push(v); }
  const tailVals = [];
  for (const g of tail) { const v = parse(g); if (v === null) return null; tailVals.push(v); }
  let v4 = null;
  if (tail4) {
    const parts = tail4.split('.').map(Number);
    if (parts.length !== 4 || parts.some((p) => !isFinite(p) || p < 0 || p > 255)) return null;
    v4 = parts;
  }
  const total = headVals.length + tailVals.length + (v4 ? 2 : 0);
  const groups = headVals.slice();
  if (halves.length === 2) {
    const fill = 8 - total;
    if (fill < 0) return null;
    for (let i = 0; i < fill; i++) groups.push(0);
  } else if (total !== 8) {
    return null;
  }
  groups.push(...tailVals);
  if (v4) groups.push(((v4[0] << 8) | v4[1]) & 0xffff, ((v4[2] << 8) | v4[3]) & 0xffff);
  return groups.length === 8 ? groups : null;
}

/**
 * Adresse IPv4 encodée dans une IPv6 : IPv4 mappée (::ffff:0:0/96) ou
 * NAT64 (64:ff9b::/96). Ces écritures atteignent une adresse IPv4 : il faut
 * donc leur appliquer les règles IPv4, pas les règles IPv6.
 * Renvoie l'adresse IPv4 en clair, ou null.
 */
function mappedIPv4(ip) {
  const g = expandIPv6(ip);
  if (!g) return null;
  const v4 = (hi, lo) => [(hi >> 8) & 255, hi & 255, (lo >> 8) & 255, lo & 255].join('.');
  if (g[0] === 0 && g[1] === 0 && g[2] === 0 && g[3] === 0 && g[4] === 0 && g[5] === 0xffff) return v4(g[6], g[7]);
  if (g[0] === 0x0064 && g[1] === 0xff9b && g[2] === 0 && g[3] === 0 && g[4] === 0 && g[5] === 0) return v4(g[6], g[7]);
  return null;
}

function isPrivateIPv4(ip) {
  const n = ip.split('.').map(Number);
  return n[0] === 0 || n[0] === 10 || n[0] === 127 ||
    (n[0] === 100 && n[1] >= 64 && n[1] <= 127) ||
    (n[0] === 169 && n[1] === 254) ||
    (n[0] === 172 && n[1] >= 16 && n[1] <= 31) ||
    (n[0] === 192 && n[1] === 168) ||
    (n[0] === 192 && n[2] === 0) ||
    (n[0] === 192 && n[2] === 2) ||
    (n[0] === 198 && (n[1] === 18 || n[1] === 19 || n[1] === 51 && n[2] === 100)) ||
    (n[0] === 203 && n[1] === 0 && n[2] === 113) || n[0] >= 224;
}

/** Une destination est-elle privée, locale ou réservée ? */
function isPrivateAddress(address) {
  const ip = String(address || '').toLowerCase().split('%')[0];
  if (net.isIPv4(ip)) return isPrivateIPv4(ip);
  if (net.isIPv6(ip)) {
    if (ip === '::' || ip === '::1') return true;
    // IPv4 mappée ou NAT64 : on applique les règles IPv4 à l'adresse embarquée.
    const mapped = mappedIPv4(ip);
    if (mapped) return isPrivateIPv4(mapped);
    return /^(fc|fd|fe8|fe9|fea|feb|ff|2001:db8:|2001:0:|2001:10:|2001:20:|2002:)/i.test(ip);
  }
  return true;
}

// ---------- Résolution unique + validation ----------
/** Analyse l'URL : protocole, hôte, port. */
function parseTarget(raw, options = {}) {
  let url;
  try { url = new URL(raw); } catch { throw new Error('URL invalide.'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('URL HTTP(S) sans identifiants requise.');
  if (options.requireHttps && url.protocol !== 'https:') throw new Error('HTTPS est requis.');
  const hostname = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (!hostname || hostname.endsWith('.localhost') || hostname.endsWith('.local') || (hostname === 'localhost' && !options.allowLoopback)) throw new Error('Hôte local interdit.');
  const port = url.port ? parseInt(url.port, 10) : (url.protocol === 'https:' ? 443 : 80);
  return { url, hostname, port, protocol: url.protocol };
}

/**
 * Résout le nom UNE FOIS et valide TOUTES les adresses retournées.
 * Une seule adresse privée suffit à rejeter la cible.
 */
async function resolveAndValidate(hostname, options = {}) {
  let addresses;
  if (net.isIP(hostname)) {
    addresses = [{ address: hostname, family: net.isIPv6(hostname) ? 6 : 4 }];
  } else {
    try { addresses = await dns.lookup(hostname, { all: true, verbatim: true }); }
    catch { throw new Error('Nom d’hôte introuvable.'); }
  }
  if (!addresses || !addresses.length) throw new Error('Nom d’hôte introuvable.');
  const list = addresses.map((a) => ({ address: a.address, family: a.family || (net.isIPv6(a.address) ? 6 : 4) }));
  if (list.some((a) => isPrivateAddress(a.address))) {
    const loopbackOnly = list.every((a) => a.address === '127.0.0.1' || a.address === '::1');
    const loopbackAllowed = loopbackOnly && (options.allowLoopback === true || process.env.NODE_ENV !== 'production');
    if (!loopbackAllowed) throw new Error('Destination réseau privée ou réservée interdite (protection SSRF).');
  }
  return list;
}

/**
 * `lookup` personnalisé : ne consulte PLUS le DNS et renvoie l'adresse
 * validée. C'est l'épinglage : la connexion part vers l'adresse contrôlée,
 * jamais vers une résolution nouvelle.
 */
function pinnedLookup(addresses) {
  return function lookup(hostname, options, callback) {
    if (typeof options === 'function') { callback = options; options = {}; }
    const opts = options || {};
    let list = addresses;
    if (opts.family) {
      const matching = addresses.filter((a) => a.family === opts.family);
      if (matching.length) list = matching;
    }
    if (opts.all) return callback(null, list);
    return callback(null, list[0].address, list[0].family);
  };
}

/**
 * Prépare une requête sortante : URL analysée, adresses validées, `lookup`
 * épinglé. À utiliser avec `requestOutbound`.
 */
async function resolveOutbound(raw, options = {}) {
  const { url, hostname, port, protocol } = parseTarget(raw, options);
  const addresses = await resolveAndValidate(hostname, options);
  return {
    url, hostname, port, protocol, addresses,
    lookup: pinnedLookup(addresses),
    // Le nom d'hôte est conservé : SNI TLS + vérification du certificat.
    servername: protocol === 'https:' && !net.isIP(hostname) ? hostname : undefined,
  };
}

/**
 * Validation d'URL sortante (API conservée).
 * ⚠ Cette fonction ne suffit plus à protéger un appel `fetch()` : elle
 * valide, mais la résolution qui suit peut différer. Utilisez
 * `requestOutbound()` pour tout appel sortant.
 */
async function validateOutboundUrl(raw, options = {}) {
  const plan = await resolveOutbound(raw, options);
  return plan.url;
}

// ---------- Requête sortante épinglée ----------
function timeoutError() {
  const e = new Error('timeout');
  e.name = 'AbortError';
  return e;
}
function abortError() {
  const e = new Error('interrompu');
  e.name = 'AbortError';
  return e;
}

/** Une seule requête HTTP, vers l'adresse épinglée. */
function requestOnce(plan, { method = 'GET', headers = {}, body, timeoutMs = DEFAULT_TIMEOUT_MS, signal } = {}) {
  return new Promise((resolve, reject) => {
    const mod = plan.protocol === 'https:' ? https : http;
    const requestHeaders = Object.assign({}, headers);
    if (body !== undefined && body !== null && requestHeaders['Content-Length'] === undefined && requestHeaders['content-length'] === undefined) {
      requestHeaders['Content-Length'] = String(Buffer.byteLength(String(body)));
    }
    const options = {
      protocol: plan.protocol,
      host: plan.hostname,
      hostname: plan.hostname,
      port: plan.port,
      path: (plan.url.pathname || '/') + (plan.url.search || ''),
      method,
      headers: requestHeaders,
      lookup: plan.lookup,          // ← pas de nouvelle résolution DNS
    };
    if (plan.protocol === 'https:') {
      if (plan.servername) options.servername = plan.servername; // SNI + vérification du certificat
      options.rejectUnauthorized = true;
    }
    let timer = null;
    let req = null;
    const cleanup = () => {
      if (timer) { clearTimeout(timer); timer = null; }
      if (signal) signal.removeEventListener('abort', onAbort);
    };
    const onAbort = () => { if (req) req.destroy(abortError()); };
    try {
      req = mod.request(options, (res) => {
        // Le minuteur reste armé tant que le corps n'est pas consommé :
        // un flux bloqué ne doit pas pouvoir faire dépasser la requête.
        const finish = () => {
          if (timer) { clearTimeout(timer); timer = null; }
          if (signal) signal.removeEventListener('abort', onAbort);
        };
        res.on('end', finish);
        res.on('close', finish);
        res.on('error', finish);
        resolve(res);
      });
    } catch (e) { cleanup(); reject(e); return; }
    timer = setTimeout(() => { if (req) req.destroy(timeoutError()); }, timeoutMs);
    if (signal) {
      if (signal.aborted) onAbort();
      else signal.addEventListener('abort', onAbort, { once: true });
    }
    req.on('error', (e) => { cleanup(); reject(e); });
    if (body !== undefined && body !== null) req.write(body);
    req.end();
  });
}

/**
 * Requête sortante complète : résolution unique, validation, épinglage,
 * redirections re-validées une par une.
 * Renvoie { status, headers, body } — `body` est le flux de réponse (Node).
 */
async function requestOutbound(raw, options = {}) {
  const maxRedirects = Number.isFinite(options.maxRedirects) ? options.maxRedirects : DEFAULT_MAX_REDIRECTS;
  let target = String(raw);
  let method = options.method || 'GET';
  let body = options.body;
  let redirects = 0;
  for (;;) {
    // Chaque étape (initiale ou redirection) : nouvelle résolution + validation.
    const plan = await resolveOutbound(target, options);
    const res = await requestOnce(plan, { ...options, method, body });
    const status = res.statusCode;
    const location = res.headers && res.headers.location;
    if (!REDIRECT_STATUS.has(status) || !location) {
      return { status, headers: res.headers, body: res, redirects };
    }
    res.resume(); // on vide la réponse de redirection avant de suivre
    if (redirects >= maxRedirects) throw new Error('Trop de redirections (' + maxRedirects + ').');
    let next;
    try { next = new URL(location, target).toString(); }
    catch { throw new Error('Redirection invalide.'); }
    if (status === 303 || ((status === 301 || status === 302) && method === 'POST')) { method = 'GET'; body = undefined; }
    target = next;
    redirects += 1;
  }
}

// ---------- Lecture bornée ----------
/**
 * Lit une réponse distante avec une taille maximale.
 * Accepte un flux web (fetch) ou un flux Node (node:http).
 */
async function readLimited(response, maxBytes = 1024 * 1024) {
  const body = response && response.body !== undefined && response.body !== null ? response.body : response;
  if (!body) return '';
  if (typeof body.getReader === 'function') {
    const reader = body.getReader();
    const chunks = [];
    let total = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) { await reader.cancel(); throw new Error('Réponse distante trop volumineuse.'); }
      chunks.push(Buffer.from(value));
    }
    return Buffer.concat(chunks).toString('utf8');
  }
  if (typeof body.on === 'function') {
    return new Promise((resolve, reject) => {
      const chunks = [];
      let total = 0;
      body.on('data', (chunk) => {
        total += chunk.length;
        if (total > maxBytes) {
          try { body.destroy(); } catch { /* ignore */ }
          reject(new Error('Réponse distante trop volumineuse.'));
          return;
        }
        chunks.push(Buffer.from(chunk));
      });
      body.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
      body.on('error', (e) => reject(e));
      body.on('close', () => resolve(Buffer.concat(chunks).toString('utf8')));
    });
  }
  return '';
}

module.exports = {
  validateOutboundUrl, resolveOutbound, requestOutbound,
  readLimited, isPrivateAddress, expandIPv6, mappedIPv4,
  DEFAULT_TIMEOUT_MS, DEFAULT_MAX_REDIRECTS,
};
