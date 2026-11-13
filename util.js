'use strict';
const crypto = require('crypto');

const now = () => new Date().toISOString();

function uid(prefix = '') {
  return prefix + Date.now().toString(36) + crypto.randomBytes(4).toString('hex');
}

function safeEmail(email) {
  if (typeof email !== 'string') return null;
  const e = email.trim().toLowerCase();
  if (!/^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/.test(e)) return null;
  return e;
}

function safeStr(s, max = 5000) {
  if (typeof s !== 'string') return null;
  const t = s.trim();
  if (!t) return null;
  return t.slice(0, max);
}

function maskSecret(s) {
  if (!s) return '';
  if (s.length <= 8) return '****';
  return s.slice(0, 4) + '…' + s.slice(-4);
}

function parseCookies(header) {
  const out = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > -1) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function sha256(s) {
  return crypto.createHash('sha256').update(s).digest('hex');
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// ---------- Minimal ZIP writer (store, no compression) ----------
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** zipFiles([{name, content(Buffer|string)}]) -> Buffer (valid .zip) */
function zipFiles(files) {
  const chunks = [];
  const central = [];
  let offset = 0;
  for (const f of files) {
    const nameBuf = Buffer.from(f.name.replace(/\\/g, '/'), 'utf8');
    const content = Buffer.isBuffer(f.content) ? f.content : Buffer.from(String(f.content), 'utf8');
    const crc = crc32(content);
    const dosTime = ((new Date().getHours() << 11) | (new Date().getMinutes() << 5)) << 16;
    const dosDate = (((new Date().getFullYear() - 1980) & 0x7f) << 9) | ((new Date().getMonth() + 1) << 5) | new Date().getDate();
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // version
    local.writeUInt16LE(0x0800, 6); // utf8 flag
    local.writeUInt16LE(0, 8); // store
    local.writeUInt16LE(new Date().getMinutes(), 10);
    local.writeUInt16LE(new Date().getHours() << 11 | new Date().getMinutes() << 5, 10);
    local.writeUInt16LE(dosDate >>> 0, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(content.length, 18);
    local.writeUInt32LE(content.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);
    chunks.push(local, nameBuf, content);

    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0);
    cd.writeUInt16LE(20, 4);
    cd.writeUInt16LE(20, 6);
    cd.writeUInt16LE(0x0800, 8);
    cd.writeUInt16LE(0, 10);
    cd.writeUInt16LE(dosDate >>> 0, 12);
    cd.writeUInt32LE(crc, 16);
    cd.writeUInt32LE(content.length, 20);
    cd.writeUInt32LE(content.length, 24);
    cd.writeUInt16LE(nameBuf.length, 28);
    cd.writeUInt32LE(offset, 42);
    central.push(Buffer.concat([cd, nameBuf]));
    offset += local.length + nameBuf.length + content.length;
  }
  const cdBuf = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(cdBuf.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...chunks, cdBuf, end]);
}

module.exports = { now, uid, safeEmail, safeStr, maskSecret, parseCookies, sha256, sleep, zipFiles };
