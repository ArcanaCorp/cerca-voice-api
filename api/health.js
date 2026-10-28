'use strict';
module.exports = function health(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ status: 'error', message: 'Método no permitido.' });
  }
  return res.status(200).json({ status: 'ok', service: 'cerca-voice-api', version: '1.1.0' });
};
