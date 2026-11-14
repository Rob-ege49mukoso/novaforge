'use strict';
const path = require('path');
const TEXT_MIMES = new Set(['text/plain','text/markdown','text/csv','text/html','text/css','text/javascript','application/javascript','application/json','application/xml','text/xml']);
const MAX_TEXT_BYTES = 256 * 1024;

function tokens(value) {
  return String(value || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').split(/[^a-z0-9]+/).filter((x) => x.length > 2);
}
function selectRelevant(rows, userId, ids, description = '') {
  const owned = (rows || []).filter((row) => row.user_id === userId);
  if (Array.isArray(ids)) {
    const wanted = new Set(ids.map(String));
    return owned.filter((row) => wanted.has(String(row.id))).slice(0, 20);
  }
  const terms = new Set(tokens(description));
  if (!terms.size) return [];
  return owned.map((row) => {
    const nameTokens = tokens(path.basename(row.name || '') + ' ' + String(row.search_text || ''));
    const score = nameTokens.reduce((n, t) => n + (terms.has(t) ? 3 : 0), 0);
    return { row, score };
  }).filter((x) => x.score > 0).sort((a, b) => b.score - a.score || String(a.row.name).localeCompare(String(b.row.name))).slice(0, 8).map((x) => x.row);
}
function extractText(buffer, mime) {
  if (!TEXT_MIMES.has(String(mime || '').toLowerCase()) || !Buffer.isBuffer(buffer) || buffer.length > MAX_TEXT_BYTES || buffer.includes(0)) return { text: '', supported: false };
  return { text: buffer.toString('utf8').replace(/\u0000/g, '').slice(0, 50000), supported: true };
}
function convertText(input, mime, format) {
  const ext = String(format || '').toLowerCase();
  if (!['txt','md','json'].includes(ext)) throw new Error('Conversion prise en charge : TXT, MD ou JSON.');
  if (Buffer.byteLength(String(input || ''), 'utf8') > MAX_TEXT_BYTES) throw new Error('Document trop volumineux pour cette conversion.');
  let content = String(input || '');
  if (ext === 'json') {
    try { content = JSON.stringify(JSON.parse(content), null, 2) + '\n'; }
    catch { throw new Error('JSON invalide : conversion impossible.'); }
  } else if (ext === 'md' && !/^\s*#/.test(content)) content = '# Document importé\n\n' + content.replace(/\s*$/, '') + '\n';
  else if (ext === 'txt') content = content.replace(/\r\n/g, '\n');
  return { content, nameExt: ext, mime: ext === 'json' ? 'application/json' : ext === 'md' ? 'text/markdown' : 'text/plain' };
}
module.exports = { selectRelevant, extractText, convertText, MAX_TEXT_BYTES };
