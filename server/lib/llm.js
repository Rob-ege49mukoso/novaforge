'use strict';
// Orchestration multi-IA : fournisseurs configurables (clés stockées côté serveur),
// test de connexion réel, comptage d'usage, bascule automatique UNIQUEMENT en cas
// d'erreur du fournisseur sélectionné. Un fournisseur n'est jamais "connecté"
// tant que son test réel n'a pas réussi.
//
// v1.4 : boucle d'outils complète (tool_calls → exécution → renvoi du résultat dans
// la conversation → réponse finale) et streaming incrémental des réponses.
// La boucle est générique : elle sert aussi bien les fournisseurs IA que le moteur
// local NovaCore, qui produit des appels d'outils au même format normalisé.
const db = require('./db');
const { now } = require('./util');
const { requestOutbound, readLimited } = require('./network');

const providers = () => db.table('ai_providers');
const usage = () => db.table('ai_usage');

const BUILTIN = [
  { type: 'openai', label: 'OpenAI', defaultBase: 'https://api.openai.com/v1', keyName: 'sk-…' },
  { type: 'openrouter', label: 'OpenRouter', defaultBase: 'https://openrouter.ai/api/v1', keyName: 'sk-or-…' },
  { type: 'anthropic', label: 'Anthropic (Claude)', defaultBase: 'https://api.anthropic.com', keyName: 'sk-ant-…' },
  { type: 'ollama', label: 'Ollama (local)', defaultBase: 'http://127.0.0.1:11434/v1', keyName: '(optionnel)' },
  { type: 'custom', label: 'Compatible OpenAI (autre)', defaultBase: '', keyName: '…' },
];

// ---------- Garde-fous de la boucle d'outils ----------
const MAX_TOOL_ROUNDS = 6;      // allers-retours LLM maximum dans une boucle d'outils
const MAX_TOOL_CALLS = 24;      // exécutions d'outils maximum par requête
const MAX_IDENTICAL_CALLS = 3;  // même outil + mêmes arguments : au-delà, on arrête
const MAX_TOOL_RESULT_CHARS = 4000;
const MAX_STREAM_BYTES = 8 * 1024 * 1024;

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

/**
 * Appel HTTP sortant — résolution unique, adresse épinglée (anti-DNS-rebinding).
 * Les redirections sont re-validées une par une par server/lib/network.js.
 */
async function httpJSON(url, opts, timeoutMs = 20000, allowLoopback = false) {
  const r = await requestOutbound(url, {
    method: (opts && opts.method) || 'GET',
    headers: { 'Content-Type': 'application/json', ...((opts && opts.headers) || {}) },
    body: opts && opts.body,
    timeoutMs,
    requireHttps: process.env.NODE_ENV === 'production' && !allowLoopback,
    allowLoopback,
  });
  const text = await readLimited(r.body, 5 * 1024 * 1024);
  let json = null;
  try { json = JSON.parse(text); } catch { /* pas du JSON */ }
  return { status: r.status, json, text };
}

// ---------- Lecture d'un flux SSE distant ----------
/** Découpe une trame SSE brute en {event, data} (data déjà parsé en JSON si possible). */
function parseSSEFrame(frame) {
  const data = [];
  let event = '';
  for (const raw of String(frame).split('\n')) {
    const line = raw.replace(/\r$/, '');
    if (!line || line.startsWith(':')) continue;
    if (line.startsWith('event:')) event = line.slice(6).trim();
    else if (line.startsWith('data:')) data.push(line.slice(5).replace(/^ /, ''));
  }
  if (!data.length) return null;
  const raw = data.join('\n');
  let json = null;
  try { json = JSON.parse(raw); } catch { /* texte brut */ }
  return { event: event || 'message', data: json === null ? raw : json };
}

/**
 * Appelle une URL et relit le flux SSE incident, trame par trame.
 * onFrame({event, data}) est appelé dès qu'une trame est reçue (incrémental).
 */
async function httpSSE(url, opts, onFrame, timeoutMs = 45000, allowLoopback = false) {
  const netError = (e) => {
    const aborted = opts.signal && opts.signal.aborted;
    return { ok: false, error: aborted ? 'Génération interrompue.' : 'Erreur réseau : ' + (e.name === 'AbortError' ? 'timeout' : e.message) };
  };
  let res;
  try {
    res = await requestOutbound(url, {
      method: (opts && opts.method) || 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream', ...((opts && opts.headers) || {}) },
      body: opts && opts.body,
      signal: opts && opts.signal,
      timeoutMs,
      requireHttps: process.env.NODE_ENV === 'production' && !allowLoopback,
      allowLoopback,
    });
  } catch (e) {
    return netError(e);
  }
  if (res.status !== 200) {
    const text = await readLimited(res.body, 64 * 1024);
    return { ok: false, status: res.status, error: `HTTP ${res.status} : ${String(text || '').slice(0, 300)}` };
  }
  const dec = new TextDecoder();
  let buf = '';
  let total = 0;
  try {
    for await (const chunk of res.body) {
      total += chunk.length;
      if (total > MAX_STREAM_BYTES) { try { res.body.destroy(); } catch { /* ignore */ } break; }
      buf += dec.decode(chunk, { stream: true }).replace(/\r\n/g, '\n');
      let idx;
      while ((idx = buf.indexOf('\n\n')) !== -1) {
        const frame = buf.slice(0, idx);
        buf = buf.slice(idx + 2);
        const parsed = parseSSEFrame(frame);
        if (parsed) onFrame(parsed);
      }
    }
    // Une réponse interrompue en cours de flux n'est pas une fin normale.
    if (res.body.complete === false) return netError(new Error('flux interrompu'));
  } catch (e) {
    return netError(e);
  }
  return { ok: true, status: res.status };
}

// ---------- Outils : normalisation ----------
function parseToolArgs(raw) {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) return raw;
  try {
    const p = JSON.parse(String(raw || '{}'));
    return p && typeof p === 'object' && !Array.isArray(p) ? p : {};
  } catch { return {}; }
}

/** Signature stable d'un appel d'outil (nom + arguments) : sert à détecter les boucles. */
function toolSignature(tc) {
  const fn = (tc && tc.function) || {};
  let args = '';
  try { args = JSON.stringify(parseToolArgs(fn.arguments)); } catch { args = String(fn.arguments || ''); }
  return String(fn.name || '') + '|' + args;
}

function stringifyResult(out) {
  if (out === undefined) return 'null';
  if (typeof out === 'string') return out;
  try { return JSON.stringify(out); } catch { return String(out); }
}

// ---------- Adaptateur Anthropique (format messages différent d'OpenAI) ----------
function toAnthropicMessages(msgs) {
  const out = [];
  for (const m of msgs) {
    if (!m || m.role === 'system') continue;
    if (m.role === 'tool') {
      const block = { type: 'tool_result', tool_use_id: m.tool_call_id, content: String(m.content == null ? '' : m.content) };
      const last = out[out.length - 1];
      if (last && last.role === 'user' && Array.isArray(last.content) && last.content.some((b) => b.type === 'tool_result')) last.content.push(block);
      else out.push({ role: 'user', content: [block] });
      continue;
    }
    if (m.role === 'assistant' && Array.isArray(m.tool_calls) && m.tool_calls.length) {
      const blocks = [];
      if (m.content) blocks.push({ type: 'text', text: String(m.content) });
      for (const tc of m.tool_calls) {
        blocks.push({ type: 'tool_use', id: tc.id, name: tc.function.name, input: parseToolArgs(tc.function.arguments) });
      }
      out.push({ role: 'assistant', content: blocks });
      continue;
    }
    out.push({ role: m.role, content: String(m.content == null ? '' : m.content) });
  }
  return out;
}

function anthropicTools(tools) {
  return (tools || []).map((t) => ({
    name: t.function.name,
    description: t.function.description || '',
    input_schema: t.function.parameters || { type: 'object', properties: {} },
  }));
}

/** Blocs « tool_use » Anthropic → tool_calls normalisés OpenAI. */
function anthropicToolCalls(blocks) {
  const calls = (blocks || []).filter((b) => b.type === 'tool_use')
    .map((b) => ({ id: b.id, type: 'function', function: { name: b.name, arguments: JSON.stringify(b.input || {}) } }));
  return calls.length ? calls : null;
}

// ---------- Appels fournisseurs ----------
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
      const body = { model: m, max_tokens: max_tokens, system: sys, messages: toAnthropicMessages(rest), temperature };
      if (tools && tools.length) body.tools = anthropicTools(tools);
      const r = await httpJSON(`${p.base_url.replace(/\/$/, '')}/v1/messages`, {
        method: 'POST',
        headers: { 'x-api-key': p.api_key, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify(body),
      }, 20000, p.type === 'ollama' && (process.env.NODE_ENV !== 'production' || process.env.NOVAFORGE_ALLOW_LOCAL_LLM === 'true'));
      if (r.status !== 200) return { ok: false, error: `Anthropic HTTP ${r.status} : ${String(r.text || r.json && r.json.error && r.json.error.message || '').slice(0, 300)}` };
      const blocks = r.json.content || [];
      const content = blocks.filter((b) => b.type === 'text').map((b) => b.text).join('\n');
      return {
        ok: true, content, tool_calls: anthropicToolCalls(blocks),
        usage: r.json.usage ? { input_tokens: r.json.usage.input_tokens, output_tokens: r.json.usage.output_tokens } : null,
      };
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

/**
 * Appel en streaming : le texte arrive par fragments (onDelta) au lieu d'un bloc unique.
 * Renvoie la même forme que callChat ({ok, content, tool_calls, usage}).
 */
async function streamChat(p, { messages, model, temperature = 0.7, max_tokens = 1024, tools, onDelta, signal }) {
  if (!p || p.enabled === false) return { ok: false, error: 'Fournisseur indisponible.' };
  if (!p.api_key && p.type !== 'ollama') return { ok: false, error: 'Clé API manquante pour ce fournisseur.' };
  const m = model || (p.models && p.models[0]) || null;
  if (!m) return { ok: false, error: 'Aucun modèle défini pour ce fournisseur.' };
  const emit = typeof onDelta === 'function' ? onDelta : () => {};
  const allowLoopback = p.type === 'ollama' && (process.env.NODE_ENV !== 'production' || process.env.NOVAFORGE_ALLOW_LOCAL_LLM === 'true');

  if (p.type === 'anthropic') {
    const sys = (messages.find((x) => x.role === 'system') || {}).content || '';
    const rest = messages.filter((x) => x.role !== 'system');
    const body = { model: m, max_tokens, system: sys, messages: toAnthropicMessages(rest), temperature, stream: true };
    if (tools && tools.length) body.tools = anthropicTools(tools);
    let content = '';
    let usage = null;
    let failure = null;
    const blocks = new Map();
    const res = await httpSSE(`${p.base_url.replace(/\/$/, '')}/v1/messages`, {
      method: 'POST',
      headers: { 'x-api-key': p.api_key, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify(body),
      signal,
    }, (frame) => {
      const d = frame.data;
      if (!d || typeof d !== 'object' || failure) return;
      if (d.type === 'message_start' && d.message && d.message.usage) usage = { input_tokens: d.message.usage.input_tokens || 0, output_tokens: 0 };
      else if (d.type === 'content_block_start' && d.content_block && d.content_block.type === 'tool_use') {
        blocks.set(d.index, { id: d.content_block.id, name: d.content_block.name, json: '' });
      } else if (d.type === 'content_block_delta' && d.delta) {
        if (d.delta.type === 'text_delta' && typeof d.delta.text === 'string') { content += d.delta.text; emit(d.delta.text); }
        else if (d.delta.type === 'input_json_delta') {
          const b = blocks.get(d.index) || { id: 'call_' + d.index, name: '', json: '' };
          b.json += d.delta.partial_json || '';
          blocks.set(d.index, b);
        }
      } else if (d.type === 'message_delta' && d.usage) {
        usage = { input_tokens: (usage && usage.input_tokens) || 0, output_tokens: d.usage.output_tokens || 0 };
      } else if (d.type === 'error') {
        failure = 'Erreur Anthropic : ' + String((d.error && d.error.message) || 'flux interrompu').slice(0, 200);
      }
    }, 45000, allowLoopback);
    if (!res.ok) return { ok: false, error: res.error };
    if (failure) return { ok: false, error: failure };
    const toolCalls = [...blocks.entries()].sort((a, b) => a[0] - b[0]).map(([idx, b]) => ({
      id: b.id || 'call_' + idx, type: 'function', function: { name: b.name, arguments: b.json || '{}' },
    })).filter((c) => c.function.name);
    return { ok: true, content, tool_calls: toolCalls.length ? toolCalls : null, usage };
  }

  // OpenAI / OpenRouter / Ollama / custom
  const body = { model: m, messages, temperature, max_tokens, stream: true };
  if (tools && tools.length) body.tools = tools;
  let content = '';
  let usage = null;
  let failure = null;
  const acc = new Map();
  const res = await httpSSE(`${p.base_url.replace(/\/$/, '')}/chat/completions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${p.api_key || 'local'}` },
    body: JSON.stringify(body),
    signal,
  }, (frame) => {
    const d = frame.data;
    if (!d || typeof d !== 'object' || failure) return;
    if (d.error) { failure = 'Erreur fournisseur : ' + String((d.error && d.error.message) || JSON.stringify(d.error)).slice(0, 200); return; }
    if (d.usage) usage = { input_tokens: d.usage.prompt_tokens || 0, output_tokens: d.usage.completion_tokens || 0 };
    const choice = d.choices && d.choices[0];
    if (!choice) return;
    const delta = choice.delta || choice.message || {};
    if (typeof delta.content === 'string' && delta.content) { content += delta.content; emit(delta.content); }
    if (Array.isArray(delta.tool_calls)) {
      for (const tc of delta.tool_calls) {
        const idx = tc.index == null ? 0 : tc.index;
        const cur = acc.get(idx) || { id: '', name: '', args: '' };
        if (tc.id) cur.id = tc.id;
        if (tc.function && tc.function.name) cur.name += tc.function.name;
        if (tc.function && tc.function.arguments) cur.args += tc.function.arguments;
        acc.set(idx, cur);
      }
    }
  }, 45000, allowLoopback);
  if (!res.ok) return { ok: false, error: res.error };
  if (failure) return { ok: false, error: failure };
  const toolCalls = [...acc.entries()].sort((a, b) => a[0] - b[0]).map(([idx, c]) => ({
    id: c.id || 'call_' + idx, type: 'function', function: { name: c.name, arguments: c.args || '{}' },
  })).filter((c) => c.function.name);
  return { ok: true, content, tool_calls: toolCalls.length ? toolCalls : null, usage };
}

/**
 * Boucle d'outils générique.
 *
 *   appel LLM → tool_calls → exécution des outils → renvoi des résultats dans la
 *   conversation → nouvel appel LLM → … → réponse finale.
 *
 * @param {object} o
 * @param {function} o.call         async (messages, ctx) => {ok, content, tool_calls, usage}
 * @param {Array} o.messages         historique initial
 * @param {Array} o.tools            outils proposés au modèle
 * @param {function} o.executeTool   async (name, args, ctx) => résultat de l'outil
 * @param {function} o.onEvent        (event) => void — trace des outils et fragments de texte
 * @param {number} o.maxRounds       nombre maximum d'itérations de la boucle
 */
async function runToolLoop({ call, messages, tools = [], executeTool, onEvent, maxRounds = MAX_TOOL_ROUNDS, signal }) {
  const convo = messages.slice();
  const trace = [];
  const perSignature = new Map();
  let round = 0;
  let toolCalls = 0;
  let lastRoundSignature = null;
  let limit = null;
  let usage = null;

  const emit = (event) => { if (typeof onEvent === 'function') onEvent(event); };

  for (;;) {
    if (signal && signal.aborted) return { ok: false, error: 'Génération interrompue.', trace, aborted: true, usage };
    emit({ type: 'round', round: round + 1 });
    const res = await call(convo, { round: round + 1, noTools: false });
    if (!res || !res.ok) {
      return { ok: false, error: (res && res.error) || 'Réponse invalide du fournisseur.', trace, usage };
    }
    usage = res.usage || usage;
    const calls = Array.isArray(res.tool_calls) ? res.tool_calls.filter((tc) => tc && tc.function && tc.function.name) : [];
    if (!calls.length) {
      return { ok: true, content: res.content || '', usage, trace, rounds: round };
    }

    round += 1;
    if (round > maxRounds) {
      limit = `Limite d’itérations d’outils atteinte (${maxRounds}).`;
      break;
    }
    // Cycle détecté : le modèle redemande exactement la même combinaison d'outils.
    const roundSignature = calls.map(toolSignature).sort().join(' >> ');
    if (roundSignature === lastRoundSignature) {
      limit = 'Boucle d’outils détectée (mêmes appels répétés) — arrêt.';
      break;
    }
    lastRoundSignature = roundSignature;

    convo.push({ role: 'assistant', content: res.content || null, tool_calls: calls });
    for (const tc of calls) {
      const name = tc.function.name;
      const args = parseToolArgs(tc.function.arguments);
      const sig = toolSignature(tc);
      const callId = tc.id || `${name}_${round}_${toolCalls}`;
      const seen = (perSignature.get(sig) || 0) + 1;
      perSignature.set(sig, seen);
      if (toolCalls >= MAX_TOOL_CALLS) {
        limit = `Limite d’appels d’outils atteinte (${MAX_TOOL_CALLS}).`;
        convo.push({ role: 'tool', tool_call_id: callId, content: JSON.stringify({ error: limit }) });
        continue;
      }
      if (seen >= MAX_IDENTICAL_CALLS) {
        limit = `Boucle d’outils détectée (« ${name} » appelé ${seen} fois avec les mêmes arguments) — arrêt.`;
        convo.push({ role: 'tool', tool_call_id: callId, content: JSON.stringify({ error: limit }) });
        continue;
      }
      toolCalls += 1;
      emit({ type: 'tool_start', round, tool: name, args });
      let out;
      try {
        out = executeTool ? await executeTool(name, args, { round, tool_call_id: callId }) : { error: 'Aucun exécuteur d’outil disponible.' };
      } catch (e) {
        out = { error: 'Erreur de l’outil : ' + (e && e.message ? e.message : 'erreur inconnue') };
      }
      trace.push({ tool: name, args, round, result: out });
      emit({ type: 'tool_end', round, tool: name, args, result: out });
      convo.push({ role: 'tool', tool_call_id: callId, content: stringifyResult(out).slice(0, MAX_TOOL_RESULT_CHARS) });
    }
    if (limit) break;
  }

  // Arrêt anticipé (limite ou boucle) : on demande une conclusion au modèle, sans outils.
  if (limit) {
    const final = await call(convo, { round: round + 1, noTools: true });
    if (final && final.ok) {
      return { ok: true, content: final.content || '', usage: final.usage || usage, trace, rounds: round, limit };
    }
    return { ok: false, error: limit, trace, usage };
  }
  return { ok: true, content: '', usage, trace, rounds: round };
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
 *
 * @param {object} o
 * @param {object} o.user
 * @param {Array} o.messages
 * @param {Array} o.tools        outils proposés au modèle
 * @param {function} o.executeTool  exécuteur d'outils (signature : (nom, args, ctx))
 * @param {function} o.onEvent     trace d'exécution (delta / tool_start / tool_end)
 */
async function chatWithFallback({ user, messages, purpose = 'chat', max_tokens = 1024, tools, executeTool, onEvent, maxRounds, signal }) {
  const order = providers().list().filter((p) => p.enabled !== false).sort((a, b) => (a.order || 0) - (b.order || 0));
  const pref = user && user.default_provider_id;
  let chain = order;
  if (pref) {
    const first = order.find((p) => p.id === pref);
    if (first) chain = [first, ...order.filter((p) => p.id !== pref)];
  }
  const errors = [];
  let emitted = false; // du texte est déjà parti vers le client : plus de bascule possible
  const emit = (event) => {
    if (event && event.type === 'delta') emitted = true;
    if (typeof onEvent === 'function') onEvent(event);
  };

  for (const p of chain) {
    const res = await runToolLoop({
      call: async (msgs, ctx) => {
        const r = await callChat(p, {
          messages: msgs,
          max_tokens,
          tools: ctx && ctx.noTools ? undefined : tools,
          model: user && user.default_model,
        });
        if (r && r.ok) {
          if (r.usage) recordUsage({ userId: user && user.id, providerId: p.id, providerName: p.name, model: (user && user.default_model) || p.models[0], inputTokens: r.usage.input_tokens, outputTokens: r.usage.output_tokens, purpose });
        }
        return r;
      },
      messages, tools, executeTool, onEvent: emit, maxRounds, signal,
    });
    if (res.ok) {
      return {
        ...res,
        provider: p.name, provider_id: p.id,
        fallback: errors.length > 0, fallback_errors: errors,
        tools_used: res.trace || [],
      };
    }
    errors.push({ provider: p.name, error: res.error });
    if (emitted) break; // impossible de basculer proprement après l'envoi de texte
  }
  return {
    ok: false,
    error: 'Aucun fournisseur IA actif. ' + errors.map((e) => `${e.provider} : ${e.error}`).join(' | ').slice(0, 400),
    fallback_errors: errors,
  };
}

/**
 * Variante streaming : même chaîne de bascule, mais le texte est diffusé au fur et
 * à mesure. Si un fournisseur a déjà envoyé du texte puis échoue, on ne bascule pas
 * (le client a déjà reçu des fragments) : l'erreur est remontée telle quelle.
 */
async function chatStreamWithFallback({ user, messages, purpose = 'chat', max_tokens = 1024, tools, executeTool, onEvent, maxRounds, signal }) {
  const order = providers().list().filter((p) => p.enabled !== false).sort((a, b) => (a.order || 0) - (b.order || 0));
  const pref = user && user.default_provider_id;
  let chain = order;
  if (pref) {
    const first = order.find((p) => p.id === pref);
    if (first) chain = [first, ...order.filter((p) => p.id !== pref)];
  }
  const errors = [];
  let emitted = false;
  const emit = (event) => {
    if (event && event.type === 'delta') emitted = true;
    if (typeof onEvent === 'function') onEvent(event);
  };

  for (const p of chain) {
    const res = await runToolLoop({
      call: async (msgs, ctx) => {
        const r = await streamChat(p, {
          messages: msgs,
          max_tokens,
          tools: ctx && ctx.noTools ? undefined : tools,
          model: user && user.default_model,
          onDelta: (text) => emit({ type: 'delta', text }),
          signal,
        });
        if (r && r.ok && r.usage) {
          recordUsage({ userId: user && user.id, providerId: p.id, providerName: p.name, model: (user && user.default_model) || p.models[0], inputTokens: r.usage.input_tokens, outputTokens: r.usage.output_tokens, purpose });
        }
        return r;
      },
      messages, tools, executeTool, onEvent: emit, maxRounds, signal,
    });
    if (res.ok) {
      return {
        ...res,
        provider: p.name, provider_id: p.id,
        fallback: errors.length > 0, fallback_errors: errors,
        tools_used: res.trace || [],
      };
    }
    errors.push({ provider: p.name, error: res.error });
    if (emitted) break;
  }
  return {
    ok: false,
    error: 'Aucun fournisseur IA actif. ' + errors.map((e) => `${e.provider} : ${e.error}`).join(' | ').slice(0, 400),
    fallback_errors: errors,
  };
}

module.exports = {
  BUILTIN, listProviders, getProvider, providers,
  callChat, streamChat, testProvider, recordUsage, usageSummary,
  chatWithFallback, chatStreamWithFallback, runToolLoop,
  parseToolArgs, toolSignature, parseSSEFrame,
  MAX_TOOL_ROUNDS, MAX_TOOL_CALLS, MAX_IDENTICAL_CALLS,
};
