'use strict';
// Orchestration multi-IA : fournisseurs configurables (clés stockées côté serveur),
// test de connexion réel, comptage d'usage, bascule automatique UNIQUEMENT en cas
// d'erreur du fournisseur sélectionné. Un fournisseur n'est jamais "connecté"
// tant que son test réel n'a pas réussi.
const db = require('./db');
const { now } = require('./util');
const { validateOutboundUrl, readLimited } = require('./network');

const providers = () => db.table('ai_providers');
const usage = () => db.table('ai_usage');

const BUILTIN = [
  { type: 'openai', label: 'OpenAI', defaultBase: 'https://api.openai.com/v1', keyName: 'sk-…' },
  { type: 'openrouter', label: 'OpenRouter', defaultBase: 'https://openrouter.ai/api/v1', keyName: 'sk-or-…' },
  { type: 'anthropic', label: 'Anthropic (Claude)', defaultBase: 'https://api.anthropic.com', keyName: 'sk-ant-…' },
  { type: 'ollama', label: 'Ollama (local)', defaultBase: 'http://127.0.0.1:11434/v1', keyName: '(optionnel)' },
  { type: 'custom', label: 'Compatible OpenAI (autre)', defaultBase: '', keyName: '…' },
];

function listProviders() {
  return providers().list().map((p) => ({
    id: p.id, name: p.name, type: p.type, base_url: p.base_url,
    has_key: !!p.api_key, key_hint: p.api_key ? (p.api_key.length <= 8 ? '****' : p.api_key.slice(0, 4) + '…' + p.api_key.slice(-4)) : '',
    models: p.models || [], enabled: p.enabled !== false, order: p.order || 0,
    status: p.status || 'unconfigured', last_test: p.last_test || null, last_error: p.last_error || null,
  }));
}

function getProvider(id) {
  return providers().get(id);
}

async function httpJSON(url, opts, timeoutMs = 20000, allowLoopback = false) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const safeUrl = await validateOutboundUrl(url, {
      requireHttps: process.env.NODE_ENV === 'production' && !allowLoopback,
      allowLoopback,
    });
    const r = await fetch(safeUrl, { ...opts, redirect: 'error', signal: ctrl.signal, headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) } });
    const text = await readLimited(r, 5 * 1024 * 1024);
    let json = null;
    try { json = JSON.parse(text); } catch { /* pas du JSON */ }
    return { status: r.status, json, text };
  } finally {
    clearTimeout(t);
  }
}

/** Appelle un chat LLM. Renvoie {ok, content, raw?, usage?, error?} */
async function callChat(p, { messages, model, temperature = 0.7, max_tokens = 1024, tools }) {
  if (!p || p.enabled === false) return { ok: false, error: 'Fournisseur indisponible.' };
  if (!p.api_key && p.type !== 'ollama') return { ok: false, error: 'Clé API manquante pour ce fournisseur.' };
  const m = model || (p.models && p.models[0]) || null;
  if (!m) return { ok: false, error: 'Aucun modèle défini pour ce fournisseur.' };

  try {
    if (p.type === 'anthropic') {
      const sys = (messages.find((x) => x.role === 'system') || {}).content || '';
      const rest = messages.filter((x) => x.role !== 'system');
      const r = await httpJSON(`${p.base_url.replace(/\/$/, '')}/v1/messages`, {
        method: 'POST',
        headers: { 'x-api-key': p.api_key, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({ model: m, max_tokens: max_tokens, system: sys, messages: rest, temperature }),
      }, 20000, p.type === 'ollama' && (process.env.NODE_ENV !== 'production' || process.env.NOVAFORGE_ALLOW_LOCAL_LLM === 'true'));
      if (r.status !== 200) return { ok: false, error: `Anthropic HTTP ${r.status} : ${String(r.text || r.json && r.json.error && r.json.error.message || '').slice(0, 300)}` };
      const content = (r.json.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n');
      return { ok: true, content, usage: r.json.usage ? { input_tokens: r.json.usage.input_tokens, output_tokens: r.json.usage.output_tokens } : null };
    }
    // OpenAI / OpenRouter / Ollama / custom (format compatible)
    const body = { model: m, messages, temperature, max_tokens };
    if (tools && tools.length) body.tools = tools;
    const r = await httpJSON(`${p.base_url.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${p.api_key || 'local'}` },
      body: JSON.stringify(body),
    }, 20000, p.type === 'ollama' && (process.env.NODE_ENV !== 'production' || process.env.NOVAFORGE_ALLOW_LOCAL_LLM === 'true'));
    if (r.status !== 200) return { ok: false, error: `HTTP ${r.status} : ${String(r.text || '').slice(0, 300)}` };
    const choice = r.json.choices && r.json.choices[0];
    if (!choice) return { ok: false, error: 'Réponse inattendue du fournisseur.' };
    const toolCalls = choice.message && choice.message.tool_calls ? choice.message.tool_calls : null;
    return {
      ok: true, content: choice.message.content || '', tool_calls: toolCalls,
      usage: r.json.usage ? { input_tokens: r.json.usage.prompt_tokens, output_tokens: r.json.usage.completion_tokens } : null,
    };
  } catch (e) {
    return { ok: false, error: 'Erreur réseau : ' + (e.name === 'AbortError' ? 'timeout' : e.message) };
  }
}

/** Test réel de la connexion (jamais de statut "connecté" sans succès). */
async function testProvider(id) {
  const p = getProvider(id);
  if (!p) return { ok: false, error: 'Fournisseur introuvable.' };
  const res = await callChat(p, { messages: [{ role: 'user', content: 'Réponds uniquement : OK' }], max_tokens: 8 });
  providers().update(id, {
    last_test: now(),
    status: res.ok ? 'active' : 'error',
    last_error: res.ok ? null : res.error,
  });
  return res;
}

function recordUsage({ userId, providerId, providerName, model, inputTokens, outputTokens, purpose }) {
  usage().insert({
    user_id: userId || 0, provider_id: providerId || 0, provider: providerName || '?',
    model: model || '?', input_tokens: inputTokens || 0, output_tokens: outputTokens || 0,
    purpose: purpose || 'chat', at: now(),
  });
}

function usageSummary(limit = 50) {
  const rows = usage().list().sort((a, b) => (a.at < b.at ? 1 : -1)).slice(0, limit);
  const totals = rows.reduce((acc, r) => {
    acc.input += r.input_tokens; acc.output += r.output_tokens; acc.calls += 1;
    return acc;
  }, { input: 0, output: 0, calls: 0 });
  return { rows, totals };
}

/**
 * Résout le fournisseur à utiliser pour un utilisateur :
 * modèle par défaut de l'utilisateur, sinon 1er fournisseur actif.
 * Bascule automatique uniquement en cas d'erreur du fournisseur sélectionné.
 */
async function chatWithFallback({ user, messages, purpose = 'chat', max_tokens = 1024, tools }) {
  const order = providers().list().filter((p) => p.enabled !== false).sort((a, b) => (a.order || 0) - (b.order || 0));
  const pref = user && user.default_provider_id;
  let chain = order;
  if (pref) {
    const first = order.find((p) => p.id === pref);
    if (first) chain = [first, ...order.filter((p) => p.id !== pref)];
  }
  const errors = [];
  for (const p of chain) {
    const res = await callChat(p, { messages, max_tokens, tools, model: user && user.default_model });
    if (res.ok) {
      if (res.usage) recordUsage({ userId: user && user.id, providerId: p.id, providerName: p.name, model: (user && user.default_model) || p.models[0], inputTokens: res.usage.input_tokens, outputTokens: res.usage.output_tokens, purpose });
      return { ...res, provider: p.name, provider_id: p.id, fallback: errors.length > 0, fallback_errors: errors };
    }
    errors.push({ provider: p.name, error: res.error });
  }
  return { ok: false, error: 'Aucun fournisseur IA actif. ' + errors.map((e) => `${e.provider} : ${e.error}`).join(' | ').slice(0, 400), fallback_errors: errors };
}

module.exports = {
  BUILTIN, listProviders, getProvider, providers,
  callChat, testProvider, recordUsage, usageSummary, chatWithFallback,
};
