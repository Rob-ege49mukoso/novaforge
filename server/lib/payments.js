'use strict';
// Passerelle de paiement automatisée — NovaForge v1.4 (étape 2 sur 4).
//
// Modèle sur le patron déjà éprouvé des fournisseurs IA (server/lib/llm.js) :
//   - configuration côté Super Admin, secrets conservés côté serveur ;
//   - test de connexion RÉEL : une passerelle n'est « active » qu'après un appel
//     réussi. Sans identifiants marchands elle reste « non configurée », et le
//     statut affiché le dit ;
//   - aucun secret n'est renvoyé en clair (jamais de clé complète dans une
//     réponse HTTP : seulement une empreinte masquée) ;
//   - tout appel sortant passe par server/lib/network.js (protection SSRF,
//     HTTPS obligatoire hors loopback de développement).
//
// Deux familles d'adaptateurs :
//   - `flutterwave` : contrat API officiel vérifié (Flutterwave v3) — endpoints
//     figés et documentés (création de paiement, vérification de transaction,
//     en-tête de webhook « verif-hash ») ;
//   - `candy` : adaptateur générique, entièrement décrit par le Super Admin
//     (URL de base, secret, chemins, en-têtes, schéma de signature). AUCUN
//     endpoint n'est supposé : tant que le contrat n'est pas renseigné,
//     l'adaptateur refuse de fonctionner — on n'invente pas d'API.
//
// Le flux mobile money manuel (M-Pesa / Orange / Airtel) reste inchangé :
// il continue de passer par une demande de paiement validée manuellement par
// le Super Admin. La passerelle automatisée est un chemin parallèle, jamais un
// remplacement. La comptabilité reste dans le même vocabulaire
// (brut / commission / net) et avec le même taux de commission plateforme.
const crypto = require('crypto');
const db = require('./db');
const A = require('./auth');
const { now, uid, maskSecret } = require('./util');
const { requestOutbound, readLimited } = require('./network');

const gateways = () => db.table('payment_gateways');
const payments = () => db.table('payments');
const plans = () => db.table('plans');
const settings = () => db.table('settings');

const MAX_RESPONSE_BYTES = 512 * 1024;
const DEFAULT_COMMISSION = 0.10;

// ---------- Adaptateurs connus ----------
// `flutterwave` : contrat API officiel vérifié (docs développeur Flutterwave v3).
//   - création de paiement  : POST {base}/payments
//   - vérification          : GET  {base}/transactions/{id}/verify
//   - webhook               : en-tête « verif-hash » (secret configuré dans le
//     tableau de bord Flutterwave), comparaison à temps constant.
// `candy` : adaptateur générique — tout est fourni par le Super Admin.
//   AUCUN endpoint, AUCUN chemin et AUCUN schéma de réponse par défaut.
const BUILTIN = [
  {
    type: 'flutterwave',
    label: 'Flutterwave',
    documented: true,
    base_url: 'https://api.flutterwave.com/v3',
    currency: 'NGN',
    create_path: '/payments',
    verify_path: '/transactions/{id}/verify',
    test_path: '/transactions/0/verify',
    test_404_is_ok: true,
    auth_scheme: 'bearer',
    auth_header: 'Authorization',
    auth_prefix: 'Bearer ',
    webhook_scheme: 'plain',
    webhook_header: 'verif-hash',
    webhook_encoding: 'hex',
    webhook_prefix: '',
    checkout_url_path: 'data.link',
    payment_id_path: 'data.id',
    ref_path: 'data.tx_ref',
    amount_path: 'data.amount',
    currency_path: 'data.currency',
    status_path: 'data.status',
    success_values: ['successful'],
    verify_before_activation: true,
    price_multiplier: 1,
  },
  {
    type: 'candy',
    label: 'Candy (adaptateur générique)',
    documented: false,
    base_url: '',
    currency: 'USD',
    create_path: '',
    verify_path: '',
    test_path: '',
    test_404_is_ok: false,
    auth_scheme: 'bearer',
    auth_header: 'Authorization',
    auth_prefix: 'Bearer ',
    webhook_scheme: 'hmac_sha256',
    webhook_header: 'x-signature',
    webhook_encoding: 'hex',
    webhook_prefix: '',
    checkout_url_path: 'link',
    payment_id_path: 'id',
    ref_path: 'reference',
    amount_path: 'amount',
    currency_path: 'currency',
    status_path: 'status',
    success_values: ['successful', 'success', 'paid', 'completed', 'succeeded'],
    verify_before_activation: false,
    price_multiplier: 1,
  },
];

// ---------- Petits utilitaires ----------
const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

function builtin(type) {
  return BUILTIN.find((b) => b.type === type) || null;
}

/** Résout un chemin pointé dans un objet JSON : « data.tx_ref », « items.0.id »… */
function getPath(obj, dotted) {
  if (!dotted) return undefined;
  let cur = obj;
  for (const raw of String(dotted).split('.')) {
    if (cur === null || cur === undefined) return undefined;
    if (Array.isArray(cur)) {
      const i = Number(raw);
      if (!Number.isInteger(i)) return undefined;
      cur = cur[i];
      continue;
    }
    if (typeof cur !== 'object') return undefined;
    cur = cur[raw];
  }
  return cur;
}

/** Comparaison à temps constant (les signatures ne doivent pas fuir par le timing). */
function safeEqual(a, b) {
  const x = Buffer.from(String(a == null ? '' : a), 'utf8');
  const y = Buffer.from(String(b == null ? '' : b), 'utf8');
  if (x.length !== y.length) {
    crypto.timingSafeEqual(x, x); // temps constant même si les longueurs diffèrent
    return false;
  }
  return crypto.timingSafeEqual(x, y);
}

function headerValue(headers, name) {
  if (!headers || !name) return '';
  const lower = String(name).toLowerCase();
  for (const k of Object.keys(headers)) {
    if (k.toLowerCase() === lower) {
      const v = headers[k];
      return Array.isArray(v) ? String(v[0] || '') : String(v == null ? '' : v);
    }
  }
  return '';
}

function joinUrl(base, suffix) {
  const b = String(base || '').replace(/\/+$/, '');
  const s = String(suffix || '');
  if (!s) return b;
  return b + (s.startsWith('/') ? '' : '/') + s;
}

function isLoopbackHost(hostname) {
  const h = String(hostname || '').replace(/^\[|\]$/g, '').toLowerCase();
  return h === 'localhost' || h === '::1' || /^127\./.test(h) || h.endsWith('.localhost');
}

/** Taux de commission plateforme (10 % par défaut, piloté par les paramètres). */
function commissionRate() {
  const s = settings().find((x) => x.key === 'platform');
  const rate = s && s.value ? Number(s.value.commission_rate) : NaN;
  return isFinite(rate) && rate >= 0 ? rate : DEFAULT_COMMISSION;
}

/**
 * Découpe un montant en brut / commission / net.
 * Même formule et même arrondi que la saisie manuelle des transactions
 * (10 % par défaut, taux réel lu dans les paramètres de la plateforme).
 */
function computeSplit(gross, rate) {
  const g = round2(gross);
  const r = isFinite(Number(rate)) ? Number(rate) : DEFAULT_COMMISSION;
  const commission = round2(g * r);
  return { gross: g, commission, net: round2(g - commission) };
}

// ---------- Requêtes HTTP sortantes (toujours via server/lib/network.js) ----------
// Résolution DNS unique, validation de toutes les adresses, connexion à
// l'adresse validée (épinglage d'IP) : une passerelle ne peut pas être
// redirigée vers une IP privée entre la validation et l'appel.
async function httpJSON(url, { method = 'GET', headers = {}, body } = {}, timeoutMs = 20000) {
  const target = new URL(url);
  // HTTPS obligatoire, sauf loopback en développement (tests, intégration locale).
  const loopbackOk = process.env.NODE_ENV !== 'production' && isLoopbackHost(target.hostname);
  const r = await requestOutbound(url, {
    method,
    headers: { Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}), ...headers },
    body,
    timeoutMs,
    requireHttps: !loopbackOk,
    allowLoopback: loopbackOk,
  });
  const text = await readLimited(r.body, MAX_RESPONSE_BYTES);
  let json = null;
  try { json = JSON.parse(text); } catch { /* réponse non JSON */ }
  return { ok: r.status >= 200 && r.status < 300, status: r.status, json, text };
}

/** En-têtes d'authentification selon le schéma retenu par l'adaptateur. */
function authHeaders(cfg, gateway) {
  const secret = String(gateway.secret || '');
  if (!secret) return {};
  if (cfg.auth_scheme === 'body') return {}; // le secret part dans le corps de la requête
  if (cfg.auth_scheme === 'header') return { [cfg.auth_header]: secret };
  return { [cfg.auth_header]: (cfg.auth_prefix || 'Bearer ') + secret };
}

// ---------- Configuration des passerelles ----------
/** Fusionne les valeurs par défaut de l'adaptateur et la configuration saisie. */
function resolveConfig(gateway) {
  const base = builtin(gateway.type) || BUILTIN[1];
  const cfg = { ...base };
  const custom = gateway.config || {};
  for (const k of Object.keys(custom)) {
    if (custom[k] === null || custom[k] === undefined || custom[k] === '') continue;
    cfg[k] = custom[k];
  }
  // Champs de premier niveau (saisis dans le formulaire d'administration).
  if (gateway.base_url) cfg.base_url = gateway.base_url;
  if (gateway.currency) cfg.currency = gateway.currency;
  if (gateway.price_multiplier !== undefined && gateway.price_multiplier !== null && gateway.price_multiplier !== '') {
    const m = Number(gateway.price_multiplier);
    if (isFinite(m) && m > 0) cfg.price_multiplier = m;
  }
  return cfg;
}

/** Vue publique d'une passerelle : jamais de secret en clair. */
function listGateways() {
  return gateways().list().map((g) => ({
    id: g.id,
    name: g.name,
    type: g.type,
    type_label: (builtin(g.type) || {}).label || g.type,
    documented: !!(builtin(g.type) || {}).documented,
    base_url: g.base_url || '',
    currency: g.currency || (builtin(g.type) || {}).currency || '',
    price_multiplier: g.price_multiplier === undefined || g.price_multiplier === null ? 1 : g.price_multiplier,
    enabled: g.enabled !== false,
    status: g.status || 'unconfigured',
    last_test: g.last_test || null,
    last_error: g.last_error || null,
    has_secret: !!g.secret,
    secret_hint: g.secret ? maskSecret(g.secret) : '',
    has_webhook_secret: !!g.webhook_secret,
    webhook_secret_hint: g.webhook_secret ? maskSecret(g.webhook_secret) : '',
    config: Object.assign({}, g.config || {}),
  }));
}

function getGateway(id) {
  return gateways().get(id);
}

/** Passerelle utilisable : activée ET testée avec succès. */
function activeGateway() {
  const list = gateways().list()
    .filter((g) => g.enabled !== false && g.status === 'active')
    .sort((a, b) => (a.order || 0) - (b.order || 0));
  return list[0] || null;
}

/** Passerelle telle qu'elle est présentée à l'utilisateur (jamais de secret). */
function publicGateway() {
  const g = activeGateway();
  if (!g) return { available: false, reason: 'Aucune passerelle de paiement automatique n’est active.' };
  const cfg = resolveConfig(g);
  return {
    available: true,
    id: g.id,
    name: g.name,
    type: g.type,
    type_label: (builtin(g.type) || {}).label || g.type,
    currency: cfg.currency,
    price_multiplier: cfg.price_multiplier,
  };
}

// ---------- Cycle de vie côté administration ----------
function createGateway(input) {
  const type = builtin(input.type) ? input.type : 'candy';
  const def = builtin(type);
  const name = String(input.name || '').trim().slice(0, 80) || def.label;
  const secret = String(input.secret || '').trim();
  const webhookSecret = String(input.webhook_secret || '').trim() || secret;
  const baseUrl = String(input.base_url || '').trim() || def.base_url;
  if (!secret) return { ok: false, error: 'La clé secrète marchande est requise.' };
  if (!baseUrl) return { ok: false, error: 'L’URL de base du gateway est requise.' };

  const config = {};
  const allowed = [
    'currency', 'create_path', 'verify_path', 'test_path', 'auth_scheme', 'auth_header', 'auth_prefix',
    'webhook_scheme', 'webhook_header', 'webhook_encoding', 'webhook_prefix', 'checkout_url_path',
    'payment_id_path', 'ref_path', 'amount_path', 'currency_path', 'status_path', 'verify_before_activation',
    'extra_body',
  ];
  for (const k of allowed) {
    const v = input.config ? input.config[k] : undefined;
    if (v === undefined || v === null || v === '') continue;
    config[k] = typeof v === 'string' ? v.trim().slice(0, 200) : v;
  }
  if (type === 'candy') {
    if (!config.create_path) return { ok: false, error: 'Pour un adaptateur générique, le chemin de création de paiement est requis.' };
    if (!config.test_path) return { ok: false, error: 'Pour un adaptateur générique, le chemin de test de connexion est requis.' };
  }
  const gw = gateways().insert({
    name, type, base_url: baseUrl, secret, webhook_secret: webhookSecret,
    currency: String(input.currency || '').trim().toUpperCase() || config.currency || def.currency,
    price_multiplier: Number(input.price_multiplier) > 0 ? Number(input.price_multiplier) : 1,
    enabled: input.enabled !== false,
    status: 'unconfigured',
    last_test: null,
    last_error: null,
    order: Number(input.order) || 0,
    config,
  });
  return { ok: true, gateway: gw };
}

function updateGateway(gateway, input) {
  const patch = {};
  if (input.name !== undefined) patch.name = String(input.name).trim().slice(0, 80);
  if (input.base_url !== undefined) patch.base_url = String(input.base_url).trim().slice(0, 200);
  if (input.secret !== undefined && input.secret !== '') patch.secret = String(input.secret).trim();
  if (input.webhook_secret !== undefined && input.webhook_secret !== '') patch.webhook_secret = String(input.webhook_secret).trim();
  if (input.currency !== undefined && input.currency !== '') patch.currency = String(input.currency).trim().slice(0, 10).toUpperCase();
  if (input.price_multiplier !== undefined && input.price_multiplier !== '') {
    const m = Number(input.price_multiplier);
    if (isFinite(m) && m > 0) patch.price_multiplier = m;
  }
  if (input.order !== undefined) patch.order = Number(input.order) || 0;
  if (input.config && typeof input.config === 'object') {
    const config = Object.assign({}, gateway.config || {});
    for (const [k, v] of Object.entries(input.config)) {
      if (v === undefined || v === null) continue;
      config[k] = typeof v === 'string' ? v.trim().slice(0, 200) : v;
    }
    patch.config = config;
  }
  // Toute modification invalide le test de connexion : le statut redevient incertain.
  patch.status = 'unconfigured';
  patch.last_error = null;
  return gateways().update(gateway.id, patch);
}

/**
 * Test de connexion RÉEL : un appel authentifié au gateway.
 * La passerelle ne devient « active » qu'en cas de succès ; sinon elle reste
 * « error » (ou « unconfigured » s'il manque des identifiants marchands).
 */
async function testGateway(id) {
  const gw = getGateway(id);
  if (!gw) return { ok: false, error: 'Passerelle introuvable.' };
  const cfg = resolveConfig(gw);

  const fail = (error) => {
    gateways().update(gw.id, { last_test: now(), status: 'error', last_error: error });
    return { ok: false, error };
  };

  if (!gw.secret) {
    const msg = 'Identifiants marchands absents : la clé secrète est requise avant tout test.';
    gateways().update(gw.id, { last_test: now(), status: 'unconfigured', last_error: msg });
    return { ok: false, error: msg };
  }
  if (!cfg.base_url) return fail('URL de base absente : indiquez l’URL du gateway.');
  if (!cfg.test_path) {
    const msg = 'Aucun chemin de test configuré : renseignez l’URL de test du gateway.';
    gateways().update(gw.id, { last_test: now(), status: 'unconfigured', last_error: msg });
    return { ok: false, error: msg };
  }

  let res;
  try {
    res = await httpJSON(joinUrl(cfg.base_url, cfg.test_path), { method: 'GET', headers: authHeaders(cfg, gw) }, 15000);
  } catch (e) {
    return fail('Appel impossible vers le gateway : ' + (e && e.message ? e.message : 'erreur réseau'));
  }

  if (res.status === 401 || res.status === 403) {
    return fail('Authentification refusée par le gateway (HTTP ' + res.status + ') : vérifiez la clé secrète.');
  }
  if (res.status === 404 && !cfg.test_404_is_ok) {
    return fail('Chemin de test introuvable chez le gateway (HTTP 404) : vérifiez la configuration.');
  }
  if (res.status >= 500) {
    return fail('Le gateway a répondu par une erreur serveur (HTTP ' + res.status + ').');
  }
  const message = String((res.json && (res.json.message || res.json.error)) || res.text || '').slice(0, 200);
  if (/authoriz|unauthor|invalid.*(key|secret|auth)|api key/i.test(message)) {
    return fail('Le gateway a rejeté les identifiants : ' + message);
  }

  gateways().update(gw.id, { last_test: now(), status: 'active', last_error: null });
  return { ok: true, status: 'active', message: 'Connexion réussie — la passerelle est active.' };
}

// ---------- Paiement : initialisation ----------
/** Vue publique d'un paiement (aucun secret, aucune preuve). */
function publicPayment(p) {
  if (!p) return null;
  return {
    id: p.id,
    plan_id: p.plan_id,
    method: p.method,
    gateway_id: p.gateway_id || null,
    gateway_type: p.gateway_type || null,
    reference: p.reference || '',
    status: p.status,
    amount: p.amount === undefined ? null : p.amount,
    currency: p.currency || null,
    gross: p.gross === undefined ? null : p.gross,
    commission: p.commission === undefined ? null : p.commission,
    net: p.net === undefined ? null : p.net,
    checkout_url: p.checkout_url || null,
    gateway_payment_id: p.gateway_payment_id || null,
    created_at: p.created_at,
    validated_at: p.validated_at || null,
    admin_note: p.admin_note || '',
  };
}

/**
 * Paiement « en cours » réutilisable (idempotence) : un seulCheckout vivant
 * par (utilisateur, offre, passerelle) à la fois.
 */
function findLiveCheckout({ userId, planId, gatewayId, idempotencyKey }) {
  const live = payments().where((p) =>
    p.user_id === userId && p.plan_id === planId && p.gateway_id === gatewayId &&
    ['pending', 'awaiting'].includes(p.status) && p.checkout_url);
  if (idempotencyKey) {
    const exact = live.find((p) => p.idempotency_key === idempotencyKey);
    if (exact) return exact;
  }
  return live[0] || null;
}

/** Corps de la requête de création, selon l'adaptateur. */
function buildCreateBody(cfg, ctx) {
  if (ctx.gatewayType === 'flutterwave') {
    // Contrat officiel Flutterwave v3.
    return {
      tx_ref: ctx.tx_ref,
      amount: ctx.amount,
      currency: ctx.currency,
      redirect_url: ctx.return_url,
      callback_url: ctx.callback_url,
      customer: { email: ctx.email || '', name: ctx.name || '' },
      customizations: {
        title: ctx.title || 'NovaForge',
        description: ctx.description || '',
      },
      payment_options: ctx.payment_options || 'card',
    };
  }
  // Adaptateur générique : corps conventionnel, complété par les champs libres
  // saisis par le Super Admin (extra_body).
  const body = {
    reference: ctx.tx_ref,
    amount: ctx.amount,
    currency: ctx.currency,
    description: ctx.description || '',
    callback_url: ctx.callback_url,
    return_url: ctx.return_url,
    customer: { email: ctx.email || '', name: ctx.name || '' },
  };
  const extra = ctx.extra_body;
  if (extra && typeof extra === 'object' && !Array.isArray(extra)) Object.assign(body, extra);
  return body;
}

/**
 * Initialise un paiement chez la passerelle et renvoie l'URL de paiement.
 * Aucune transaction n'est simulée : si l'appel échoue, rien n'est enregistré
 * comme un paiement en cours.
 */
async function createCheckout({ user, plan, gateway, idempotencyKey, baseUrl, callbackUrl }) {
  const cfg = resolveConfig(gateway);
  if (!gateway.secret) return { ok: false, error: 'Identifiants marchands absents.' };
  if (!cfg.base_url) return { ok: false, error: 'URL de base absente.' };
  if (!cfg.create_path) return { ok: false, error: 'Chemin de création de paiement non configuré.' };

  const txRef = uid('nfx_');
  const multiplier = Number(cfg.price_multiplier) > 0 ? Number(cfg.price_multiplier) : 1;
  const amount = round2(Number(plan.price) * multiplier);
  const split = computeSplit(plan.price, commissionRate());
  const returnUrl = baseUrl ? joinUrl(baseUrl, '#/billing') : '';

  let res;
  try {
    res = await httpJSON(joinUrl(cfg.base_url, cfg.create_path), {
      method: 'POST',
      headers: authHeaders(cfg, gateway),
      body: JSON.stringify(buildCreateBody(cfg, {
        gatewayType: gateway.type,
        tx_ref: txRef,
        amount,
        currency: cfg.currency,
        email: user.email,
        name: user.display_name || (user.email || '').split('@')[0],
        title: 'NovaForge',
        description: 'Abonnement ' + (plan.name || plan.id),
        return_url: returnUrl,
        callback_url: callbackUrl || '',
        extra_body: cfg.extra_body,
      })),
    }, 25000);
  } catch (e) {
    return { ok: false, error: 'Appel impossible vers la passerelle : ' + (e && e.message ? e.message : 'erreur réseau') };
  }

  if (res.status !== 200 && res.status !== 201) {
    const detail = String((res.json && (res.json.message || res.json.error)) || res.text || '').slice(0, 200);
    return { ok: false, error: 'La passerelle a refusé la création du paiement (HTTP ' + res.status + ')' + (detail ? ' : ' + detail : '') };
  }
  const checkout = getPath(res.json, cfg.checkout_url_path);
  const gatewayPaymentId = getPath(res.json, cfg.payment_id_path);
  if (!checkout || typeof checkout !== 'string') {
    return { ok: false, error: 'Réponse inattendue de la passerelle : lien de paiement absent (' + cfg.checkout_url_path + ').' };
  }

  const p = payments().insert({
    user_id: user.id,
    plan_id: plan.id,
    method: 'gateway',
    gateway_id: gateway.id,
    gateway_type: gateway.type,
    reference: txRef,
    tx_ref: txRef,
    gateway_payment_id: gatewayPaymentId === undefined || gatewayPaymentId === null ? null : String(gatewayPaymentId),
    checkout_url: checkout,
    amount,
    currency: cfg.currency,
    gross: split.gross,
    commission: split.commission,
    net: split.net,
    idempotency_key: idempotencyKey || (gateway.id + ':' + user.id + ':' + plan.id),
    status: 'pending',
    admin_note: '',
    proof: null,
  });
  return { ok: true, payment: p };
}

// ---------- Webhook : signature et activation ----------
/**
 * Vérifie la signature du webhook.
 *   - `plain`       : le gateway renvoie le secret configuré (en-tête « verif-hash »
 *                     documenté par Flutterwave) — comparaison à temps constant ;
 *   - `hmac_sha256` : HMAC-SHA256 du corps brut, encodé en hexadécimal ou
 *                     base64, comparé à temps constant.
 * Aucun webhook n'est accepté sans signature.
 */
function verifySignature(cfg, gateway, rawBody, provided) {
  const secret = String(gateway.webhook_secret || gateway.secret || '');
  if (!secret) return false;
  let value = String(provided || '');
  const prefix = cfg.webhook_prefix || '';
  if (prefix && value.toLowerCase().startsWith(prefix.toLowerCase())) value = value.slice(prefix.length);
  else if (/^sha256=/i.test(value)) value = value.slice(7);
  value = value.trim();
  if (!value) return false;

  if (cfg.webhook_scheme === 'plain') return safeEqual(value, secret);

  if (cfg.webhook_scheme === 'hmac_sha256') {
    const mac = crypto.createHmac('sha256', secret).update(rawBody).digest(cfg.webhook_encoding === 'base64' ? 'base64' : 'hex');
    return safeEqual(value, mac);
  }
  return false;
}

/** Vérification de la transaction côté passerelle (recommandation officielle). */
async function verifyTransaction(gateway, cfg, gatewayPaymentId) {
  if (!cfg.verify_path || !gatewayPaymentId) return { ok: false, skipped: true, error: 'Vérification distante indisponible.' };
  const path = String(cfg.verify_path).replace(/\{id\}/g, encodeURIComponent(gatewayPaymentId));
  let res;
  try {
    res = await httpJSON(joinUrl(cfg.base_url, path), { method: 'GET', headers: authHeaders(cfg, gateway) }, 20000);
  } catch (e) {
    // Erreur de réseau : temporaire, la passerelle doit réessayer.
    return { ok: false, transient: true, error: 'Vérification distante impossible : ' + (e && e.message ? e.message : 'erreur réseau') };
  }
  if (res.status === 401 || res.status === 403) return { ok: false, transient: false, error: 'Identifiants marchands refusés par la passerelle (HTTP ' + res.status + ').' };
  if (res.status >= 500) return { ok: false, transient: true, error: 'La passerelle a répondu par une erreur serveur (HTTP ' + res.status + ').' };
  const status = String(getPath(res.json, cfg.status_path) || '').toLowerCase();
  const ok = cfg.success_values.map((v) => String(v).toLowerCase()).includes(status);
  return { ok, transient: false, error: ok ? null : 'La transaction n’est pas « successful » chez la passerelle (statut : ' + (status || 'inconnu') + ').', data: res.json };
}

/**
 * Traite un webhook signé : idempotent.
 *   - paiement inconnu         → ignoré (HTTP 200, journalisé) ;
 *   - paiement déjà activé     → no-op (HTTP 200) ;
 *   - montant/devise divergents→ refusé (HTTP 200, aucun abonnement activé) ;
 *   - échec de la transaction  →_HTTP 200, aucun abonnement activé.
 */
async function handleWebhook({ gateway, rawBody, headers }) {
  const cfg = resolveConfig(gateway);
  const raw = Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(String(rawBody || ''), 'utf8');
  const provided = headerValue(headers, cfg.webhook_header);
  if (!provided) return { status: 401, ok: false, action: 'rejected', error: 'Signature de webhook absente.' };
  if (!verifySignature(cfg, gateway, raw, provided)) {
    return { status: 401, ok: false, action: 'rejected', error: 'Signature de webhook invalide.' };
  }

  let payload;
  try { payload = JSON.parse(raw.toString('utf8')); }
  catch { return { status: 400, ok: false, action: 'rejected', error: 'Corps de webhook illisible.' }; }

  const ref = String(getPath(payload, cfg.ref_path) || '').trim();
  const remoteId = getPath(payload, cfg.payment_id_path);
  const status = String(getPath(payload, cfg.status_path) || '').trim().toLowerCase();
  const success = cfg.success_values.map((v) => String(v).toLowerCase()).includes(status);

  let payment = ref ? payments().find((p) => p.gateway_id === gateway.id && p.tx_ref === ref) : null;
  if (!payment && remoteId !== undefined && remoteId !== null) {
    payment = payments().find((p) => p.gateway_id === gateway.id && p.gateway_payment_id === String(remoteId));
  }
  if (!payment) {
    return { status: 200, ok: true, action: 'ignored', error: null, message: 'Aucun paiement correspondant à cette référence.' };
  }
  if (payment.status === 'validated') {
    return { status: 200, ok: true, action: 'idempotent', error: null, payment: publicPayment(payment) };
  }
  if (!success) {
    payments().update(payment.id, { status: 'failed', admin_note: 'Échec signalé par la passerelle (statut : ' + (status || 'inconnu') + ').' });
    return { status: 200, ok: true, action: 'failed', error: null, payment: publicPayment(payments().get(payment.id)) };
  }

  // Contrôle du montant et de la devise : un paiement partiel n'active rien.
  const receivedAmount = Number(getPath(payload, cfg.amount_path));
  const receivedCurrency = String(getPath(payload, cfg.currency_path) || '').trim().toUpperCase();
  if (isFinite(receivedAmount) && payment.amount !== undefined && payment.amount !== null && round2(receivedAmount) !== round2(payment.amount)) {
    payments().update(payment.id, { status: 'mismatch', admin_note: 'Montant reçu (' + receivedAmount + ') différent du montant attendu (' + payment.amount + ').' });
    return { status: 200, ok: true, action: 'mismatch', error: null, payment: publicPayment(payments().get(payment.id)) };
  }
  if (receivedCurrency && payment.currency && receivedCurrency !== String(payment.currency).toUpperCase()) {
    payments().update(payment.id, { status: 'mismatch', admin_note: 'Devise reçue (' + receivedCurrency + ') différente de la devise attendue (' + payment.currency + ').' });
    return { status: 200, ok: true, action: 'mismatch', error: null, payment: publicPayment(payments().get(payment.id)) };
  }

  // Vérification distante avant activation (recommandation Flutterwave).
  if (cfg.verify_before_activation) {
    const v = await verifyTransaction(gateway, cfg, payment.gateway_payment_id || (remoteId === undefined ? null : String(remoteId)));
    if (v.transient) return { status: 503, ok: false, action: 'retry', error: v.error };
    if (!v.ok && !v.skipped) {
      payments().update(payment.id, { status: 'failed', admin_note: v.error || 'Vérification distante refusée.' });
      return { status: 200, ok: true, action: 'failed', error: null, payment: publicPayment(payments().get(payment.id)) };
    }
  }

  const activated = activatePayment(payment, {
    gateway_payment_id: remoteId === undefined || remoteId === null ? payment.gateway_payment_id : String(remoteId),
  });
  return { status: 200, ok: true, action: 'activated', error: null, payment: publicPayment(activated) };
}

/**
 * Activation automatique de l'offre (idempotente).
 * Même durée d'abonnement que la validation manuelle du Super Admin (30 jours).
 */
function activatePayment(payment, extra) {
  const plan = plans().get(payment.plan_id);
  const user = A.users().get(payment.user_id);
  if (!plan || !user) return payment;
  const already = payments().get(payment.id);
  if (already && already.status === 'validated') return already;

  const expires = new Date(Date.now() + 30 * 864e5).toISOString();
  const patch = Object.assign({
    status: 'validated',
    validated_by: 0,
    validated_at: now(),
    activated_at: now(),
    admin_note: 'Activé automatiquement par la passerelle de paiement.',
  }, extra || {});
  payments().update(payment.id, patch);
  A.users().update(user.id, {
    plan_id: plan.id,
    subscription: { plan_id: plan.id, status: 'active', expires_at: expires, since: now() },
  });
  return payments().get(payment.id);
}

module.exports = {
  BUILTIN, builtin,
  gateways, payments,
  listGateways, getGateway, activeGateway, publicGateway,
  createGateway, updateGateway, testGateway,
  createCheckout, findLiveCheckout, publicPayment,
  handleWebhook, verifySignature, verifyTransaction,
  activatePayment, computeSplit, commissionRate,
  getPath, safeEqual, round2,
};
