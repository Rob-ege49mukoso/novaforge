'use strict';
// Authentification & autorisations — toujours vérifiées côté serveur.
const crypto = require('crypto');
const db = require('./db');
const { sha256, now } = require('./util');

const users = () => db.table('users');
const sessions = () => db.table('sessions');

const PERMISSIONS = [
  'users.manage', 'users.block', 'users.delete', 'subadmins.manage',
  'projects.moderate', 'billing.manage', 'payments.manage',
  'plans.manage', 'providers.manage', 'mcp.manage', 'automation.manage',
  'transactions.manage', 'settings.manage', 'logs.view',
];

function hashPassword(pw) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(pw), salt, 64).toString('hex');
  return `scrypt$${salt}$${hash}`;
}

function verifyPassword(pw, stored) {
  try {
    const [scheme, salt, hash] = String(stored).split('$');
    if (scheme !== 'scrypt') return false;
    const test = crypto.scryptSync(String(pw), salt, 64);
    return crypto.timingSafeEqual(test, Buffer.from(hash, 'hex'));
  } catch {
    return false;
  }
}

function pwStrength(pw) {
  const s = String(pw || '');
  const score = (s.length >= 8 ? 1 : 0) + (/[a-z]/.test(s) && /[A-Z]/.test(s) ? 1 : 0) + (/\d/.test(s) ? 1 : 0) + (/[^A-Za-z0-9]/.test(s) ? 1 : 0);
  return score; // 0..4, exigé >= 3
}

function publicUser(u) {
  if (!u) return null;
  return {
    id: u.id, email: u.email, role: u.role, permissions: u.permissions || [],
    plan_id: u.plan_id || 'free', blocked: !!u.blocked, created_at: u.created_at,
    display_name: u.display_name || u.email.split('@')[0],
  };
}

function createSession(userId, meta) {
  const token = crypto.randomBytes(32).toString('hex');
  sessions().insert({
    token_hash: sha256(token), user_id: userId,
    ip: meta.ip || '', ua: (meta.ua || '').slice(0, 200),
    expires_at: new Date(Date.now() + 7 * 864e5).toISOString(),
  });
  return token;
}

function getSessionUser(req) {
  const cookies = req.cookies || {};
  const token = cookies.nfx_session;
  if (!token) return null;
  const s = sessions().find((x) => x.token_hash === sha256(token));
  if (!s) return null;
  if (s.expires_at < now()) { sessions().remove(s.id); return null; }
  const u = users().get(s.user_id);
  if (!u || u.blocked) return null;
  return u;
}

function destroySession(req) {
  const cookies = req.cookies || {};
  const token = cookies.nfx_session;
  if (!token) return;
  const s = sessions().find((x) => x.token_hash === sha256(token));
  if (s) sessions().remove(s.id);
}

function hasPerm(u, perm) {
  if (!u) return false;
  if (u.role === 'super_admin') return true;
  if (u.role === 'sub_admin') return (u.permissions || []).includes(perm);
  return false;
}

function requireAuth(req, res) {
  const u = getSessionUser(req);
  if (!u) {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Non authentifié.' }));
    return null;
  }
  return u;
}

function requireRole(req, res, roles) {
  const u = requireAuth(req, res);
  if (!u) return null;
  if (!roles.includes(u.role)) {
    res.writeHead(403, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Autorisation insuffisante.' }));
    return null;
  }
  return u;
}

function requirePerm(req, res, perm) {
  const u = requireAuth(req, res);
  if (!u) return null;
  if (!hasPerm(u, perm)) {
    res.writeHead(403, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: `Permission requise : ${perm}` }));
    return null;
  }
  return u;
}

module.exports = {
  users, sessions, PERMISSIONS,
  hashPassword, verifyPassword, pwStrength,
  publicUser, createSession, getSessionUser, destroySession,
  hasPerm, requireAuth, requireRole, requirePerm,
};
