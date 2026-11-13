'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'novaforge-test-'));
process.env.NOVAFORGE_DATA_DIR = dataDir;
process.env.NODE_ENV = 'test';

const network = require('../server/lib/network');
const automation = require('../server/lib/automation');
const db = require('../server/lib/db');
const runtime = require('../server/generator/runtime');

test('outbound policy rejects private and reserved IP ranges', () => {
  for (const ip of ['10.0.0.1', '127.0.0.1', '192.168.1.10', '169.254.169.254', '172.20.1.1', '::1', 'fd00::1', '::ffff:7f00:1', '192.0.2.1', '198.51.100.1', '203.0.113.9', '2001:db8::1']) {
    assert.equal(network.isPrivateAddress(ip), true, `${ip} should be blocked`);
  }
  assert.equal(network.isPrivateAddress('8.8.8.8'), false);
});

test('outbound policy rejects local hostnames and non-HTTP schemes', async () => {
  await assert.rejects(network.validateOutboundUrl('http://localhost:8080'), /Hôte local interdit/);
  await assert.rejects(network.validateOutboundUrl('file:///etc/passwd'), /URL HTTP/);
  await assert.rejects(network.validateOutboundUrl('http://169.254.169.254/latest/meta-data'), /privée ou réservée/);
});

test('arbitrary shell actions cannot be created or executed', async () => {
  const created = automation.createTask(1, { explicit: { action: { type: 'run_command', params: { command: 'whoami' } } } });
  assert.equal(created.ok, false);
  const result = await automation.executeAction({ type: 'run_command', params: { command: 'whoami' } });
  assert.equal(result.ok, false);
  assert.match(result.log[0], /désactivée/);
});

test('daily tasks reject invalid times and receive a concrete next_run timestamp', () => {
  const invalid = automation.createTask(2, { explicit: { kind: 'daily', time: '29:90', action: { type: 'system_info', params: {} } } });
  assert.equal(invalid.ok, false);
  const result = automation.createTask(2, {
    description: 'daily test',
    explicit: { name: 'daily smoke test', kind: 'daily', time: '23:59', action: { type: 'system_info', params: {} } },
  });
  assert.equal(result.ok, true);
  assert.ok(Number.isFinite(Date.parse(result.task.next_run)));
  assert.equal(result.task.status, 'ready');
});

test('automation rejects workspace path traversal', async () => {
  const result = await automation.executeAction({ type: 'create_file', params: { path: '../../outside.txt', content: 'nope' } });
  assert.equal(result.ok, false);
});

test('generated API is reconstructed from metadata and ignores modified project code', async () => {
  const projectDir = path.join(dataDir, 'projects', '991', 'current');
  fs.mkdirSync(projectDir, { recursive: true });
  fs.writeFileSync(path.join(projectDir, 'api.js'), "require('fs').writeFileSync(" + JSON.stringify(path.join(dataDir, 'PWNED')) + ", 'bad'); module.exports = {};");
  db.table('projects').insert({ id: 991, type: 'api', name: "Test ' API", domain: 'generic' });
  const mod = runtime.loadProjectModule(991);
  assert.ok(mod);
  assert.ok(Array.isArray(mod.routes));
  assert.ok(mod.routes.some((r) => r.path === '/health'));
  assert.equal(fs.existsSync(path.join(dataDir, 'PWNED')), false);
  const handler = runtime.makeHandler(991, mod, 'generic');
  const health = await handler({ method: 'GET', url: '/health', body: {} });
  assert.equal(health.code, 200);
});

test.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));
