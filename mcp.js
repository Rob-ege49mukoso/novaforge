'use strict';
// Gestionnaire MCP — client JSON-RPC 2.0 (HTTP).
// Les secrets restent côté serveur : l'API ne renvoie jamais la valeur brute.
const db = require('./db');
const { now, maskSecret } = require('./util');
const { validateOutboundUrl, readLimited } = require('./network');

const servers = () => db.table('mcp_servers');

function publicServer(s) {
  return {
    id: s.id, name: s.name, url: s.url, auth_method: s.auth_method || 'none',
    auth_header: s.auth_method === 'custom_header' ? s.auth_header : (s.auth_method === 'bearer' ? 'Authorization' : ''),
    has_secret: !!s.auth_value, secret_hint: s.auth_value ? maskSecret(s.auth_value) : '',
    enabled: s.enabled !== false, status: s.status || 'untested',
    last_test: s.last_test || null, last_error: s.last_error || null,
    tools: s.tools || [], // [{name, description, allowed}]
  };
}

function listServers() {
  return servers().list().map(publicServer);
}

function authHeaders(s) {
  const h = {};
  if (s.auth_method === 'bearer' && s.auth_value) h['Authorization'] = `Bearer ${s.auth_value}`;
  if (s.auth_method === 'api_key' && s.auth_value) {
    h['X-Api-Key'] = s.auth_value;
  }
  if (s.auth_method === 'custom_header' && s.auth_value && s.auth_header && /^[!#$%&'*+.^_`|~0-9A-Za-z-]{1,80}$/.test(s.auth_header)) h[s.auth_header] = s.auth_value;
  return h;
}

async function rpc(server, method, params, timeoutMs = 12000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const url = await validateOutboundUrl(server.url, { requireHttps: process.env.NODE_ENV === 'production' });
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', ...authHeaders(server) },
      body: JSON.stringify({ jsonrpc: '2.0', id: Date.now(), method, params: params || {} }),
      signal: ctrl.signal,
      redirect: 'error',
    });
    const text = await readLimited(r);
    // Certains serveurs MCP répondent en SSE (data: {...})
    let json = null;
    const dataLine = text.split('\n').find((l) => l.startsWith('data:'));
    const payload = dataLine ? dataLine.slice(5).trim() : text;
    try { json = JSON.parse(payload); } catch { json = null; }
    return { http: r.status, json, text };
  } finally {
    clearTimeout(t);
  }
}

/** Test réel : initialize puis tools/list. */
async function testServer(id) {
  const s = servers().get(id);
  if (!s) return { ok: false, error: 'Serveur introuvable.' };
  try {
    const init = await rpc(s, 'initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'NovaForge', version: '1.0' },
    });
    if (!init.json || init.json.error) {
      const err = (init.json && init.json.error && init.json.error.message) || `HTTP ${init.http}`;
      servers().update(id, { status: 'error', last_test: now(), last_error: String(err).slice(0, 300) });
      return { ok: false, error: 'initialize : ' + String(err).slice(0, 300) };
    }
    const tools = await rpc(s, 'tools/list', {});
    const list = (tools.json && tools.json.result && tools.json.result.tools) || [];
    const existing = s.tools || [];
    const merged = list.map((t) => {
      const prev = existing.find((x) => x.name === t.name);
      return { name: t.name, description: t.description || '', allowed: prev ? prev.allowed : true };
    });
    servers().update(id, { status: 'active', last_test: now(), last_error: null, tools: merged });
    return { ok: true, tools: merged };
  } catch (e) {
    const msg = e.name === 'AbortError' ? 'timeout' : e.message;
    servers().update(id, { status: 'error', last_test: now(), last_error: msg.slice(0, 300) });
    return { ok: false, error: msg.slice(0, 300) };
  }
}

async function callTool(server, toolName, args) {
  const r = await rpc(server, 'tools/call', { name: toolName, arguments: args || {} }, 30000);
  if (r.json && r.json.error) return { ok: false, error: r.json.error.message || 'erreur MCP' };
  const res = r.json && r.json.result;
  if (!res) return { ok: false, error: 'Réponse MCP inattendue.' };
  const text = (res.content || []).map((c) => c.text || JSON.stringify(c)).join('\n');
  return { ok: !res.isError, error: res.isError ? text.slice(0, 500) : null, content: text };
}

module.exports = { listServers, publicServer, testServer, callTool, servers };
