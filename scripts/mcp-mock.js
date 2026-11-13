'use strict';
// Serveur MCP de démo (JSON-RPC 2.0 sur HTTP) — sert à VÉRIFIER le client MCP de NovaForge.
// Lancement : node scripts/mcp-mock.js  (port 8090)
const http = require('http');
const PORT = process.env.MCP_PORT || 8090;

const server = http.createServer((req, res) => {
  if (req.method !== 'POST') { res.writeHead(405); return res.end(); }
  let b = '';
  req.on('data', (c) => (b += c));
  req.on('end', () => {
    let msg = {};
    try { msg = JSON.parse(b || '{}'); } catch { /* noop */ }
    const id = msg.id || 1;
    const reply = (result) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ jsonrpc: '2.0', id, result }));
    };
    switch (msg.method) {
      case 'initialize':
        return reply({ protocolVersion: '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'mcp-mock', version: '1.0' } });
      case 'tools/list':
        return reply({
          tools: [
            { name: 'get_time', description: 'Renvoie l’heure courante (UTC)', inputSchema: { type: 'object', properties: {} } },
            { name: 'add', description: ' Additionne deux nombres', inputSchema: { type: 'object', properties: { a: { type: 'number' }, b: { type: 'number' } }, required: ['a', 'b'] } },
          ],
        });
      case 'tools/call': {
        const p = msg.params || {};
        if (p.name === 'get_time') return reply({ content: [{ type: 'text', text: new Date().toISOString() }] });
        if (p.name === 'add') {
          const a = Number((p.arguments || {}).a) || 0, c = Number((p.arguments || {}).b) || 0;
          return reply({ content: [{ type: 'text', text: String(a + c) }] });
        }
        return reply({ isError: true, content: [{ type: 'text', text: 'outil inconnu' }] });
      }
      default:
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ jsonrpc: '2.0', id, error: { code: -32601, message: 'méthode inconnue' } }));
    }
  });
});
server.listen(PORT, '0.0.0.0', () => console.log('MCP mock sur http://0.0.0.0:' + PORT));
