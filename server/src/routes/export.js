const express = require('express');
const { db } = require('../db/connection');
const { requireAuth } = require('../middleware/requireAuth');
const exportService = require('../services/exportService');

const router = express.Router();

router.use(requireAuth);

router.get('/eventos/:id/export/pdf', (req, res) => {
  const ok = exportService.streamPdf(res, db, Number(req.params.id));
  if (!ok) res.status(404).json({ error: 'Evento no encontrado' });
});

module.exports = router;
