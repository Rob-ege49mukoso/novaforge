'use strict';
// Tests de la boucle d'outils (server/lib/llm.js) et du moteur local NovaCore.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'novaforge-llm-test-'));
process.env.NOVAFORGE_DATA_DIR = dataDir;
process.env.NODE_ENV = 'test';

const LLM = require('../server/lib/llm');
const NOVACORE = require('../server/lib/novacore');

const toolCall = (name, args, id = 'c1') => ({
  id, type: 'function', function: { name, arguments: JSON.stringify(args || {}) },
});

test('la boucle d\'outils exécute l\'outil puis renvoie le résultat dans la conversation', async () => {
  const seen = [];
  const res = await LLM.runToolLoop({
    call: async (messages) => {
      seen.push(messages.slice());
      if (seen.length === 1) return { ok: true, content: '', tool_calls: [toolCall('calculator', { expression: '2+2' })] };
      return { ok: true, content: 'Résultat : **4**' };
    },
    messages: [{ role: 'user', content: 'calcule 2+2' }],
    executeTool: async (name, args) => ({ name, args, value: 4 }),
  });

  assert.equal(res.ok, true);
  assert.equal(res.content, 'Résultat : **4**');
  assert.equal(seen.length, 2);

  // Le résultat de l\'outil est bien réinjecté dans la conversation.
  const toolMsg = seen[1].find((m) => m.role === 'tool');
  assert.ok(toolMsg, 'le message « tool » doit être présent');
  assert.equal(toolMsg.tool_call_id, 'c1');
  assert.match(toolMsg.content, /"value":4/);

  // La trace de chaque outil utilisé est conservée.
  assert.equal(res.trace.length, 1);
  assert.equal(res.trace[0].tool, 'calculator');
  assert.deepEqual(res.trace[0].args, { expression: '2+2' });
  assert.deepEqual(res.trace[0].result, { name: 'calculator', args: { expression: '2+2' }, value: 4 });
});

test('la boucle d\'outils s\'arrête sur une boucle infinie', async () => {
  let executed = 0;
  const res = await LLM.runToolLoop({
    call: async () => ({ ok: true, content: '', tool_calls: [toolCall('boucle', { x: 1 })] }),
    messages: [{ role: 'user', content: 'boucle' }],
    executeTool: async () => { executed += 1; return { ok: true }; },
  });

  // Le même appel répété est détecté : l\'outil n\'est pas relancé indéfiniment.
  assert.ok(executed <= 2, 'la boucle ne doit pas dépasser 2 exécutions');
  assert.match(String(res.limit || res.error), /Boucle d[’']outils détectée/);
});

test('la boucle d\'outils respecte le nombre maximum d\'itérations', async () => {
  let executed = 0;
  const res = await LLM.runToolLoop({
    call: async (messages) => {
      const n = messages.filter((m) => m.role === 'tool').length;
      return { ok: true, content: '', tool_calls: [toolCall('outil' + n, { n }, 'c' + n)] };
    },
    messages: [{ role: 'user', content: 'x' }],
    executeTool: async () => { executed += 1; return { ok: true }; },
    maxRounds: 3,
  });

  assert.equal(executed, 3);
  assert.match(String(res.limit || res.error), /Limite d[’']itérations/);
});

test('une erreur d\'exécution d\'outil est remontée sans interrompre la boucle', async () => {
  const res = await LLM.runToolLoop({
    call: async (messages) => {
      if (messages.length === 1) return { ok: true, content: '', tool_calls: [toolCall('casse', {})] };
      return { ok: true, content: 'Je continue malgré l\'échec.' };
    },
    messages: [{ role: 'user', content: 'test' }],
    executeTool: async () => { throw new Error('panne simulée'); },
  });

  assert.equal(res.ok, true);
  assert.equal(res.content, 'Je continue malgré l\'échec.');
  assert.match(JSON.stringify(res.trace[0].result), /panne simulée/);
});

test('le moteur local NovaCore produit des appels d\'outils normalisés', () => {
  const turn = NOVACORE.agentTurn([{ role: 'user', content: 'Calcule 12 * 4' }], { name: 'Nova' });
  assert.equal(turn.content, '');
  assert.equal(turn.tool_calls.length, 1);
  assert.equal(turn.tool_calls[0].function.name, 'calculator');
  assert.deepEqual(JSON.parse(turn.tool_calls[0].function.arguments).expression.includes('12'), true);
});

test('le moteur local NovaCore répond après l\'exécution de l\'outil, sans fournisseur IA', async () => {
  const res = await LLM.runToolLoop({
    call: async (messages) => {
      const turn = NOVACORE.agentTurn(messages, { name: 'Nova' });
      return { ok: true, content: turn.content, tool_calls: turn.tool_calls && turn.tool_calls.length ? turn.tool_calls : null };
    },
    messages: [{ role: 'user', content: 'Calcule 12 * 4' }],
    executeTool: async (name, args) => {
      if (name !== 'calculator') return { error: 'outil inconnu' };
      const val = Function('"use strict";return (' + String(args.expression).replace(/\^/g, '**') + ')')();
      return { value: val };
    },
  });

  assert.equal(res.ok, true);
  assert.match(res.content, /48/);
  assert.equal(res.trace[0].tool, 'calculator');
});

test('les trames SSE sont décodées (événement + données JSON)', () => {
  const fr = LLM.parseSSEFrame('event: delta\ndata: {"text":"Bonjour"}');
  assert.equal(fr.event, 'delta');
  assert.deepEqual(fr.data, { text: 'Bonjour' });
  assert.equal(LLM.parseSSEFrame(': simple commentaire'), null);
  assert.equal(LLM.parseSSEFrame(''), null);
});

test('les arguments d\'un outil sont analysés sans faire tomber la boucle', () => {
  assert.deepEqual(LLM.parseToolArgs('{"a":1}'), { a: 1 });
  assert.deepEqual(LLM.parseToolArgs('pas du json'), {});
  assert.deepEqual(LLM.parseToolArgs({ a: 1 }), { a: 1 });
  assert.equal(LLM.toolSignature(toolCall('x', { a: 1 })), LLM.toolSignature(toolCall('x', { a: 1 })));
  assert.notEqual(LLM.toolSignature(toolCall('x', { a: 1 })), LLM.toolSignature(toolCall('x', { a: 2 })));
});

test.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));
