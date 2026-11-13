'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { selectRelevant, extractText, convertText } = require('../server/lib/resources');

test('manual resource selection preserves only IDs owned by the caller', () => {
  const rows = [{ id: 'a', user_id: 7 }, { id: 'b', user_id: 8 }];
  assert.deepEqual(selectRelevant(rows, 7, ['a', 'b']), [rows[0]]);
});

test('automatic resource selection ranks relevant filenames and limits results', () => {
  const rows = [
    { id: '1', user_id: 1, name: 'boutique-produits.csv', mime: 'text/csv', size: 20 },
    { id: '2', user_id: 1, name: 'photo-vacances.jpg', mime: 'image/jpeg', size: 20 },
    { id: '3', user_id: 1, name: 'commandes-boutique.pdf', mime: 'application/pdf', size: 20 },
  ];
  const picked = selectRelevant(rows, 1, null, 'Crée une boutique pour gérer les produits et commandes');
  assert.deepEqual(picked.map((x) => x.id), ['1', '3']);
});

test('automatic matching can use extracted text content, not just filenames', () => {
  const rows = [{ id: 'x', user_id: 2, name: 'document-inconnu.txt', mime: 'text/plain', search_text: 'catalogue produits boutique commandes' }];
  assert.deepEqual(selectRelevant(rows, 2, null, 'Créer une boutique et gérer les commandes').map((x) => x.id), ['x']);
});

test('text extraction is bounded and binary content is ignored', () => {
  assert.equal(extractText(Buffer.from('bonjour'), 'text/plain').text, 'bonjour');
  assert.equal(extractText(Buffer.from([0, 1, 2]), 'application/octet-stream').text, '');
});

test('text conversion supports safe plain text and validated JSON only', () => {
  assert.equal(convertText('bonjour', 'text/plain', 'md').content, '# Document importé\n\nbonjour\n');
  assert.throws(() => convertText('{oops', 'application/json', 'json'), /JSON invalide/);
});
