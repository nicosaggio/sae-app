const PDFDocument = require('pdfkit');
const eventosService = require('./eventosService');

/**
 * Trae, por cada lote del evento, sus productos agregados (sumando cantidad a través de
 * TODOS los presupuestos del lote, ya que para el despacho no importa de qué presupuesto
 * vino cada línea) y subdivididos por rubro.
 */
function obtenerLotesParaExport(db, eventoId) {
  const filas = db
    .prepare(
      `SELECT l.id AS lote_id, l.codigo AS lote_codigo, l.expositor AS lote_expositor,
              prod.rubro, prod.codigo AS producto_codigo, prod.nombre AS producto_nombre,
              pl.cantidad, pl.comentario
       FROM lotes l
       JOIN presupuestos p ON p.lote_id = l.id
       JOIN presupuesto_lineas pl ON pl.presupuesto_id = p.id
       JOIN productos prod ON prod.id = pl.producto_id
       WHERE l.evento_id = ?
       ORDER BY l.codigo, prod.rubro, prod.nombre`
    )
    .all(eventoId);

  const lotesMapa = new Map();
  for (const fila of filas) {
    if (!lotesMapa.has(fila.lote_id)) {
      lotesMapa.set(fila.lote_id, { codigo: fila.lote_codigo, expositor: fila.lote_expositor, rubros: new Map() });
    }
    const lote = lotesMapa.get(fila.lote_id);
    const rubro = fila.rubro || 'Sin rubro';
    if (!lote.rubros.has(rubro)) lote.rubros.set(rubro, new Map());
    const productos = lote.rubros.get(rubro);
    const clave = fila.producto_codigo || fila.producto_nombre;
    if (!productos.has(clave)) {
      productos.set(clave, { codigo: fila.producto_codigo, nombre: fila.producto_nombre, cantidad: 0, comentarios: [] });
    }
    const producto = productos.get(clave);
    producto.cantidad += fila.cantidad;
    if (fila.comentario) producto.comentarios.push(fila.comentario);
  }

  return Array.from(lotesMapa.values()).map((lote) => ({
    codigo: lote.codigo,
    expositor: lote.expositor,
    rubros: Array.from(lote.rubros.entries()).map(([rubro, productos]) => ({
      rubro,
      productos: Array.from(productos.values()),
    })),
  }));
}

function encabezadoEvento(doc, evento) {
  doc.fontSize(18).fillColor('#000').text(evento.nombre, { underline: true });
  doc.moveDown(0.5);
  doc.fontSize(11).fillColor('#444');
  doc.text(`Lugar: ${evento.lugar || '—'}`);
  doc.text(`Fechas: ${evento.fecha_inicio} a ${evento.fecha_fin}`);
  doc.moveDown();
}

const COL_PRODUCTO = 40;
const COL_CODIGO = 380;
const COL_CANTIDAD = 480;
const COL_FIN = 555;

function filaTabla(doc, nombre, codigo, cantidad, opts = {}) {
  const y = doc.y;
  doc.fontSize(10).fillColor(opts.color || '#000');
  doc.text(nombre, COL_PRODUCTO, y, { width: COL_CODIGO - COL_PRODUCTO - 10 });
  doc.text(codigo || '—', COL_CODIGO, y, { width: COL_CANTIDAD - COL_CODIGO - 10 });
  doc.text(String(cantidad), COL_CANTIDAD, y, { width: COL_FIN - COL_CANTIDAD });
  doc.moveDown(0.35);
}

function encabezadoTabla(doc) {
  doc.fontSize(9).fillColor('#666');
  filaTabla(doc, 'PRODUCTO', 'CÓDIGO', 'CANTIDAD', { color: '#666' });
  doc.moveTo(COL_PRODUCTO, doc.y).lineTo(COL_FIN, doc.y).strokeColor('#ccc').stroke();
  doc.moveDown(0.3);
}

/** Recuadro amarillo bien visible para que un comentario no pase desapercibido. */
function comentarioDestacado(doc, texto) {
  const x = COL_PRODUCTO + 10;
  const ancho = COL_FIN - COL_PRODUCTO - 10;
  const textoCompleto = `AVISO: ${texto}`;

  doc.font('Helvetica-Bold').fontSize(9.5);
  const alto = doc.heightOfString(textoCompleto, { width: ancho - 10 }) + 8;
  if (doc.y + alto > doc.page.height - doc.page.margins.bottom) doc.addPage();

  const y = doc.y;
  doc.rect(x - 5, y, ancho + 10, alto).fill('#fef3c7');
  doc.fillColor('#92400e').text(textoCompleto, x, y + 4, { width: ancho - 10 });
  doc.font('Helvetica').fillColor('#000');
  doc.y = y + alto + 5;
}

function dibujarLote(doc, lote) {
  const totalLineas = lote.rubros.reduce((acc, r) => acc + r.productos.length, 0);
  const alturaEstimada = 55 + totalLineas * 20;
  if (doc.y + alturaEstimada > doc.page.height - doc.page.margins.bottom) {
    doc.addPage();
  }

  const yInicio = doc.y;
  doc.rect(COL_PRODUCTO - 5, yInicio, COL_FIN - COL_PRODUCTO + 10, 20).fill('#eef2ff');
  doc.fillColor('#1d4ed8').fontSize(11);
  const titulo = `Lote: ${lote.codigo}` + (lote.expositor ? `   —   Expositor: ${lote.expositor}` : '');
  doc.text(titulo, COL_PRODUCTO, yInicio + 5);
  doc.moveDown(0.6);

  let subtotal = 0;
  for (const grupoRubro of lote.rubros) {
    doc.fontSize(10).fillColor('#374151').text(grupoRubro.rubro, COL_PRODUCTO);
    doc.moveDown(0.2);
    encabezadoTabla(doc);
    for (const producto of grupoRubro.productos) {
      filaTabla(doc, producto.nombre, producto.codigo, producto.cantidad);
      if (producto.comentarios.length > 0) {
        comentarioDestacado(doc, producto.comentarios.join('; '));
      }
      subtotal += producto.cantidad;
    }
    doc.moveDown(0.3);
  }

  doc.fontSize(9).fillColor('#666').text(`Subtotal lote: ${subtotal} unidades`, COL_PRODUCTO);
  doc.moveDown(0.8);
}

function dibujarTotalesEvento(doc, totales) {
  doc.addPage();
  doc.fontSize(15).fillColor('#000').text('TOTALES DEL EVENTO', { underline: true });
  doc.moveDown(0.5);

  if (totales.length === 0) {
    doc.fontSize(11).fillColor('#666').text('Sin productos cargados.');
    return;
  }

  for (const grupo of totales) {
    const alturaEstimada = 40 + grupo.productos.length * 20;
    if (doc.y + alturaEstimada > doc.page.height - doc.page.margins.bottom) doc.addPage();

    doc.fontSize(12).fillColor('#1d4ed8').text(grupo.rubro);
    doc.moveDown(0.3);
    encabezadoTabla(doc);
    for (const producto of grupo.productos) {
      filaTabla(doc, producto.nombre, producto.codigo, producto.cantidad);
    }
    doc.fontSize(9).fillColor('#666').text(`Subtotal ${grupo.rubro}: ${grupo.subtotal} unidades`, COL_PRODUCTO);
    doc.moveDown(0.6);
  }
}

function streamPdf(res, db, eventoId) {
  const evento = eventosService.obtener(eventoId);
  if (!evento) return false;

  const lotes = obtenerLotesParaExport(db, eventoId);
  const totales = eventosService.totalesPorEvento(eventoId);

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="evento-${eventoId}.pdf"`);

  const doc = new PDFDocument({ margin: 40 });
  doc.pipe(res);

  encabezadoEvento(doc, evento);

  if (lotes.length === 0) {
    doc.fontSize(11).fillColor('#666').text('Este evento todavía no tiene pedidos cargados.');
  } else {
    for (const lote of lotes) {
      dibujarLote(doc, lote);
    }
  }

  dibujarTotalesEvento(doc, totales);

  doc.end();
  return true;
}

module.exports = { streamPdf };
