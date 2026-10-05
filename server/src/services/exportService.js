const PDFDocument = require('pdfkit');
const eventosService = require('./eventosService');
const croquisPdf = require('./croquisPdf');

/**
 * Trae, por cada lote del evento, sus productos agregados (sumando cantidad a través de
 * TODOS los presupuestos del lote, ya que para el despacho no importa de qué presupuesto
 * vino cada línea) y subdivididos por rubro.
 */
function obtenerLotesParaExport(db, eventoId, rubrosFiltro) {
  let sql = `SELECT l.id AS lote_id, l.codigo AS lote_codigo, l.expositor AS lote_expositor,
              prod.rubro, prod.codigo AS producto_codigo, prod.nombre AS producto_nombre,
              pl.cantidad, pl.comentario
       FROM lotes l
       JOIN presupuestos p ON p.lote_id = l.id
       JOIN presupuesto_lineas pl ON pl.presupuesto_id = p.id
       JOIN productos prod ON prod.id = pl.producto_id
       WHERE l.evento_id = ?`;
  const params = [eventoId];
  if (rubrosFiltro && rubrosFiltro.length > 0) {
    sql += ` AND COALESCE(prod.rubro, 'Sin rubro') IN (${rubrosFiltro.map(() => '?').join(',')})`;
    params.push(...rubrosFiltro);
  }
  // Orden numérico natural (1, 2, 3… 10, 11) en vez de alfabético (1, 10, 11… 2, 3):
  // CAST a INTEGER toma el número inicial del código ("23C" -> 23, "-" -> 0) como
  // criterio principal, y el código completo como desempate para el resto.
  sql += ' ORDER BY CAST(l.codigo AS INTEGER), l.codigo, prod.rubro, prod.nombre';
  const filas = db.prepare(sql).all(...params);

  const lotesMapa = new Map();
  for (const fila of filas) {
    if (!lotesMapa.has(fila.lote_id)) {
      lotesMapa.set(fila.lote_id, { id: fila.lote_id, codigo: fila.lote_codigo, expositor: fila.lote_expositor, rubros: new Map() });
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
    id: lote.id,
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
  doc.text(`Fechas: ${evento.fecha_inicio ? `${evento.fecha_inicio} a ${evento.fecha_fin}` : '(sin definir)'}`);
  doc.moveDown();
}

const COL_PRODUCTO = 40;
const COL_CODIGO = 380;
const COL_CANTIDAD = 480;
const COL_FIN = 555;
const ANCHO_NOMBRE = COL_CODIGO - COL_PRODUCTO - 10;
// Los productos van con sangría respecto del título del rubro, para que se lea como
// contenido "dentro" del rubro y no al mismo nivel que el encabezado de sección.
const SANGRIA_PRODUCTO = 14;
// Mismo violeta de marca que usa el resto de la app, para que el nombre del rubro
// resalte — solo la palabra (texto en negrita+color con fondo leve, sin ocupar el
// renglón entero como el título del lote).
const COLOR_RUBRO = '#8b5892';
const COLOR_RUBRO_FONDO = '#f3e9f4';

/** Dibuja el nombre del rubro en negrita+violeta con un fondo leve recortado al ancho
 *  exacto de la palabra (no de todo el renglón). Deja doc.y al final del texto. */
function rubroResaltado(doc, texto, x, fontSize) {
  doc.font('Helvetica-Bold').fontSize(fontSize);
  const ancho = doc.widthOfString(texto);
  const alto = doc.currentLineHeight();
  const y = doc.y;
  const padX = 4;
  const padY = 2;
  doc.rect(x - padX, y - padY, ancho + padX * 2, alto + padY * 2).fill(COLOR_RUBRO_FONDO);
  doc.fillColor(COLOR_RUBRO).text(texto, x, y);
  doc.font('Helvetica').fillColor('#000');
  doc.y = y + alto;
}

/** Nombres de producto largos ocupan varias líneas — hay que sumar esa altura real,
 *  si no la fila siguiente se dibuja encima de la cola del texto envuelto. */
function filaTabla(doc, nombre, codigo, cantidad, opts = {}) {
  const indent = opts.indent || 0;
  const xNombre = COL_PRODUCTO + indent;
  const anchoNombre = ANCHO_NOMBRE - indent;
  const y = doc.y;
  doc.fontSize(10).fillColor(opts.color || '#000');
  const altura = doc.heightOfString(String(nombre), { width: anchoNombre });
  doc.text(nombre, xNombre, y, { width: anchoNombre });
  doc.text(codigo || '—', COL_CODIGO, y, { width: COL_CANTIDAD - COL_CODIGO - 10 });
  doc.text(String(cantidad), COL_CANTIDAD, y, { width: COL_FIN - COL_CANTIDAD });
  doc.y = y + altura;
  doc.moveDown(0.35);
}

/** Altura real (con wrap) de una lista de productos, para estimar saltos de página. */
function alturaProductos(doc, productos) {
  doc.fontSize(10);
  return productos.reduce(
    (acc, p) => acc + doc.heightOfString(String(p.nombre), { width: ANCHO_NOMBRE - SANGRIA_PRODUCTO }) + 8,
    0
  );
}

function encabezadoTabla(doc) {
  doc.fontSize(9).fillColor('#666');
  filaTabla(doc, 'PRODUCTO', 'CÓDIGO', 'CANTIDAD', { color: '#666', indent: SANGRIA_PRODUCTO });
  doc.moveTo(COL_PRODUCTO, doc.y).lineTo(COL_FIN, doc.y).strokeColor('#ccc').stroke();
  doc.moveDown(0.3);
}

/** Recuadro amarillo bien visible para que un comentario no pase desapercibido. */
function comentarioDestacado(doc, texto) {
  const x = COL_PRODUCTO + SANGRIA_PRODUCTO + 10;
  const ancho = COL_FIN - COL_PRODUCTO - SANGRIA_PRODUCTO - 10;
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

/** Franja azul con el código y el expositor del lote. */
function tituloLote(doc, codigo, expositor) {
  const yInicio = doc.y;
  doc.rect(COL_PRODUCTO - 5, yInicio, COL_FIN - COL_PRODUCTO + 10, 20).fill('#eef2ff');
  doc.fillColor('#1d4ed8').fontSize(11);
  const titulo = `Lote: ${codigo}` + (expositor ? `   —   Expositor: ${expositor}` : '');
  doc.text(titulo, COL_PRODUCTO, yInicio + 5);
  doc.moveDown(0.6);
}

function dibujarLote(doc, lote) {
  const alturaEstimada = lote.rubros.reduce((acc, r) => acc + 25 + alturaProductos(doc, r.productos), 55);
  if (doc.y + alturaEstimada > doc.page.height - doc.page.margins.bottom) {
    doc.addPage();
  }

  tituloLote(doc, lote.codigo, lote.expositor);

  let subtotal = 0;
  for (const grupoRubro of lote.rubros) {
    rubroResaltado(doc, grupoRubro.rubro, COL_PRODUCTO, 10);
    doc.moveDown(0.2);
    encabezadoTabla(doc);
    for (const producto of grupoRubro.productos) {
      filaTabla(doc, producto.nombre, producto.codigo, producto.cantidad, { indent: SANGRIA_PRODUCTO });
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
    const alturaEstimada = 40 + alturaProductos(doc, grupo.productos);
    if (doc.y + alturaEstimada > doc.page.height - doc.page.margins.bottom) doc.addPage();

    rubroResaltado(doc, grupo.rubro, COL_PRODUCTO, 12);
    doc.moveDown(0.3);
    encabezadoTabla(doc);
    for (const producto of grupo.productos) {
      filaTabla(doc, producto.nombre, producto.codigo, producto.cantidad, { indent: SANGRIA_PRODUCTO });
    }
    doc.fontSize(9).fillColor('#666').text(`Subtotal ${grupo.rubro}: ${grupo.subtotal} unidades`, COL_PRODUCTO);
    doc.moveDown(0.6);
  }
}

/** Lotes del evento que tienen un croquis dibujado (ver croquisService.js), con sus paredes/materiales ya parseados. */
function lotesConCroquis(db, eventoId) {
  const filas = db
    .prepare(
      `SELECT lc.paredes, lc.materiales, lc.cotas, lc.comentarios, l.id AS lote_id, l.codigo AS lote_codigo, l.expositor AS lote_expositor
       FROM lote_croquis lc JOIN lotes l ON l.id = lc.lote_id
       WHERE l.evento_id = ?
       ORDER BY CAST(l.codigo AS INTEGER), l.codigo`
    )
    .all(eventoId);
  return filas.map((f) => ({
    lote_id: f.lote_id,
    lote_codigo: f.lote_codigo,
    lote_expositor: f.lote_expositor,
    comentarios: (f.comentarios || '').trim(),
    paredes: JSON.parse(f.paredes || '[]'),
    materiales: JSON.parse(f.materiales || '[]'),
    cotas: JSON.parse(f.cotas || '[]'),
  }));
}

const TITULO_LOTE_ALTO = 26;
const ETIQUETA_CROQUIS_ALTO = 15;
const SEPARACION_DESPUES = 10;

/**
 * Dibuja el croquis de un lote a continuación de lo que ya está en el PDF, con el cuadro de
 * comentarios a la derecha si el lote tiene. Nunca se parte entre páginas: si no entra en lo que
 * queda de la hoja se lo achica un poco y, si igual quedaría muy chico, pasa a la hoja siguiente.
 * conTitulo: el lote no tiene detalle de productos en este PDF, así que lleva su propia franja de título.
 */
function dibujarCroquisDeLote(doc, c, codigoPorItemId, { conTitulo }) {
  const fondo = doc.page.height - doc.page.margins.bottom;
  const x0 = doc.page.margins.left;
  const anchoTotal = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const plan = croquisPdf.preparar(doc, c, codigoPorItemId, anchoTotal);

  let ponerTitulo = conTitulo;
  const espacioAca = fondo - doc.y - ETIQUETA_CROQUIS_ALTO - (conTitulo ? TITULO_LOTE_ALTO : 0);
  let escala = croquisPdf.escalaParaEspacio(plan, espacioAca);
  if (escala === null) {
    doc.addPage();
    ponerTitulo = true; // en la hoja nueva se vuelve a decir a qué lote pertenece
    escala = plan.escalaIdeal;
  }
  if (ponerTitulo) tituloLote(doc, c.lote_codigo, c.lote_expositor);

  doc.font('Helvetica-Bold').fontSize(9).fillColor('#666').text('CROQUIS', COL_PRODUCTO, doc.y);
  doc.font('Helvetica');
  doc.moveDown(0.4);
  const y0 = doc.y;
  const alto = croquisPdf.dibujar(doc, plan, { x: x0, y: y0, espacio: fondo - y0, escala });

  doc.x = x0;
  doc.y = y0 + alto + SEPARACION_DESPUES;
}

// Mismo orden que el SQL de los lotes (CAST(codigo AS INTEGER), codigo): "2" < "10" < "23C".
function compararCodigosDeLote(a, b) {
  const na = parseInt(a, 10) || 0;
  const nb = parseInt(b, 10) || 0;
  if (na !== nb) return na - nb;
  return a < b ? -1 : a > b ? 1 : 0;
}

function streamPdf(res, db, eventoId, rubrosFiltro) {
  const evento = eventosService.obtener(eventoId);
  if (!evento) return false;

  const lotes = obtenerLotesParaExport(db, eventoId, rubrosFiltro);
  let totales = eventosService.totalesPorEvento(eventoId);
  if (rubrosFiltro && rubrosFiltro.length > 0) {
    const permitidos = new Set(rubrosFiltro);
    totales = totales.filter((grupo) => permitidos.has(grupo.rubro));
  }

  // El sufijo viene de la URL (?rubros=...): sólo letras, números y guiones, para no meter comillas ni saltos de línea en el header.
  const sufijoArchivo = rubrosFiltro && rubrosFiltro.length > 0 ? `-${rubrosFiltro.join('-').replace(/[^A-Za-z0-9_-]+/g, '_')}` : '';
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="evento-${eventoId}${sufijoArchivo}.pdf"`);

  const doc = new PDFDocument({ margin: 40 });
  doc.pipe(res);

  encabezadoEvento(doc, evento);

  // Cada lote lleva su croquis (si lo dibujaron) debajo de su detalle. Un lote con croquis pero sin
  // detalle en este PDF (no tiene productos) igual se imprime, con su propio título — salvo que se
  // esté filtrando por rubros, donde sólo salen los lotes que aparecen en el listado.
  const croquis = lotesConCroquis(db, eventoId);
  const codigoPorItemId = croquisPdf.codigosDeMateriales(db, croquis);
  const croquisPorLote = new Map(croquis.map((c) => [c.lote_id, c]));
  const bloques = lotes.map((lote) => ({ lote, croquis: croquisPorLote.get(lote.id) }));
  if (!(rubrosFiltro && rubrosFiltro.length > 0)) {
    const conDetalle = new Set(lotes.map((l) => l.id));
    for (const c of croquis) if (!conDetalle.has(c.lote_id)) bloques.push({ lote: null, croquis: c });
    const codigoDe = (b) => String(b.lote ? b.lote.codigo : b.croquis.lote_codigo);
    bloques.sort((a, b) => compararCodigosDeLote(codigoDe(a), codigoDe(b)));
  }

  if (bloques.length === 0) {
    doc.fontSize(11).fillColor('#666').text('Este evento todavía no tiene pedidos cargados.');
  } else {
    for (const bloque of bloques) {
      if (bloque.lote) dibujarLote(doc, bloque.lote);
      if (bloque.croquis) dibujarCroquisDeLote(doc, bloque.croquis, codigoPorItemId, { conTitulo: !bloque.lote });
    }
  }

  dibujarTotalesEvento(doc, totales);

  doc.end();
  return true;
}

module.exports = { streamPdf, cajaDelCroquis: croquisPdf.cajaDelCroquis, geometriaCota: croquisPdf.geometriaCota };
