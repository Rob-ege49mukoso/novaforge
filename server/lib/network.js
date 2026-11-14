'use strict';
// Outbound HTTP policy shared by MCP, automations and agent web tools.
const dns = require('dns').promises;
const net = require('net');

function isPrivateAddress(address) {
  const ip = String(address || '').toLowerCase().split('%')[0];
  if (net.isIPv4(ip)) {
    const n = ip.split('.').map(Number);
    return n[0] === 0 || n[0] === 10 || n[0] === 127 ||
      (n[0] === 100 && n[1] >= 64 && n[1] <= 127) ||
      (n[0] === 169 && n[1] === 254) ||
      (n[0] === 172 && n[1] >= 16 && n[1] <= 31) ||
      (n[0] === 192 && n[1] === 168) ||
      (n[0] === 192 && n[1] === 0 && n[2] === 0) ||
      (n[0] === 192 && n[1] === 0 && n[2] === 2) ||
      (n[0] === 192 && n[1] === 88 && n[2] === 99) ||
      (n[0] === 198 && (n[1] === 18 || n[1] === 19 || n[1] === 51 && n[2] === 100)) ||
      (n[0] === 203 && n[1] === 0 && n[2] === 113) || n[0] >= 224;
  }
  if (net.isIPv6(ip)) {
    if (ip === '::' || ip === '::1') return true;
    if (ip.startsWith('::ffff:')) return true; // Block mapped IPv4 forms, including hexadecimal notation.
    return /^(fc|fd|fe8|fe9|fea|feb|ff|2001:db8:|2001:0:|2001:10:|2001:20:|2002:)/i.test(ip);
  }
  return true;
}

async function validateOutboundUrl(raw, options = {}) {
  let url;
  try { url = new URL(raw); } catch { throw new Error('URL invalide.'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('URL HTTP(S) sans identifiants requise.');
  if (options.requireHttps && url.protocol !== 'https:') throw new Error('HTTPS est requis.');
  const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (!host || host.endsWith('.localhost') || host.endsWith('.local') || (host === 'localhost' && !options.allowLoopback)) throw new Error('Hôte local interdit.');
  let addresses;
  if (net.isIP(host)) addresses = [{ address: host }];
  else {
    try { addresses = await dns.lookup(host, { all: true, verbatim: true }); }
    catch { throw new Error('Nom d’hôte introuvable.'); }
  }
  if (!addresses.length || addresses.some((entry) => isPrivateAddress(entry.address))) {
    const loopbackOnly = addresses.length > 0 && addresses.every((entry) => entry.address === '127.0.0.1' || entry.address === '::1');
    const loopbackAllowed = loopbackOnly && (options.allowLoopback === true || process.env.NODE_ENV !== 'production');
    if (!loopbackAllowed) throw new Error('Destination réseau privée ou réservée interdite (protection SSRF).');
  }
  return url;
}

async function readLimited(response, maxBytes = 1024 * 1024) {
  if (!response.body) return '';
  const reader = response.body.getReader();
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

module.exports = { validateOutboundUrl, readLimited, isPrivateAddress };
