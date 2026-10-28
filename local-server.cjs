'use strict';
// Servidor local de prueba. Vercel ejecuta los archivos de /api directamente.
const http = require('node:http');
const voice = require('./api/voice-turn.js');
const health = require('./api/health.js');
const companion = require('./api/companion.js');
const PORT = Number(process.env.PORT) || 3000;

const server = http.createServer(async (req, res) => {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 3_450_000) {
      res.writeHead(413, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'Audio demasiado grande.' }));
    }
    chunks.push(chunk);
  }
  req.body = Buffer.concat(chunks).toString('utf8');
  res.status = function (code) { this.statusCode = code; return this; };
  res.json = function (body) { this.end(JSON.stringify(body)); return this; };
  const route = req.url?.split('?')[0];
  if (route === '/api/health') return health(req, res);
  if (route === '/api/voice-turn') return voice(req, res);
  if (route === '/api/companion') return companion(req, res);
  res.status(404).json({ error: 'Ruta inexistente.' });
});
server.listen(PORT, () => console.log(`CERCA API local en http://localhost:${PORT}`));
