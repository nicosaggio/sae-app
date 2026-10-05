const PDFDocument = require('pdfkit');
const eventosService = require('./eventosService');
const simbolosCroquis = require('../data/croquisSimbolos.json');

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

/** code de catálogo de cada catalogo_item_id usado en estos materiales, para buscar su símbolo. */
function codigosDeMateriales(db, croquisDeLotes) {
  // Los bloques auxiliares (la columna) no son ítems de catálogo: no tienen catalogo_item_id.
  const ids = [...new Set(croquisDeLotes.flatMap((c) => c.materiales.map((m) => m.catalogo_item_id)).filter(Number.isInteger))];
  if (ids.length === 0) return new Map();
  const filas = db.prepare(`SELECT id, codigo FROM catalogo_items WHERE id IN (${ids.map(() => '?').join(',')})`).all(...ids);
  return new Map(filas.map((f) => [f.id, f.codigo]));
}

/**
 * Geometría de una cota alineada: mide de (x1,y1) a (x2,y2), y la línea de cota va desplazada
 * `offset` metros (con signo) en perpendicular. Es la misma cuenta que hace el editor.
 */
function geometriaCota({ x1, y1, x2, y2, offset }) {
  const largo = Math.hypot(x2 - x1, y2 - y1);
  const ux = largo ? (x2 - x1) / largo : 1;
  const uy = largo ? (y2 - y1) / largo : 0;
  const nx = -uy;
  const ny = ux;
  return { largo, ux, uy, nx, ny, lado: offset < 0 ? -1 : 1, ax: x1 + nx * offset, ay: y1 + ny * offset, bx: x2 + nx * offset, by: y2 + ny * offset };
}

/** Caja EXACTA que contiene paredes + materiales (con su rotación) + cotas, en metros: el dibujo queda encuadrado sin aire de más. */
function cajaDelCroquis({ paredes, materiales, cotas = [] }) {
  const xs = [];
  const ys = [];
  const punto = (x, y) => {
    xs.push(x);
    ys.push(y);
  };
  for (const p of paredes) {
    punto(p.x1, p.y1);
    punto(p.x2, p.y2);
  }
  for (const m of materiales) {
    const w = m.ancho || 0;
    const h = m.profundidad || 0;
    const rad = ((m.rotacion || 0) * Math.PI) / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);
    const cx = m.x + w / 2;
    const cy = m.y + h / 2;
    for (const [dx, dy] of [[-w / 2, -h / 2], [w / 2, -h / 2], [w / 2, h / 2], [-w / 2, h / 2]]) {
      punto(cx + dx * cos - dy * sin, cy + dx * sin + dy * cos);
    }
  }
  // Las cotas llevan texto y marcas alrededor de la línea: se les deja un margen para que no se corten.
  const MARGEN_COTA = 0.25;
  for (const c of cotas) {
    const g = geometriaCota(c);
    for (const [x, y] of [[c.x1, c.y1], [c.x2, c.y2], [g.ax, g.ay], [g.bx, g.by]]) {
      punto(x - MARGEN_COTA, y - MARGEN_COTA);
      punto(x + MARGEN_COTA, y + MARGEN_COTA);
    }
  }
  if (xs.length === 0) return { x: 0, y: 0, w: 1, h: 1 };
  // Un poco de margen para que no se corte el grosor de las líneas.
  const PAD = 0.05;
  const minX = Math.min(...xs) - PAD;
  const minY = Math.min(...ys) - PAD;
  return { x: minX, y: minY, w: Math.max(...xs) + PAD - minX, h: Math.max(...ys) + PAD - minY };
}

/** Dibuja los paths de un símbolo (coordenadas en metros, ya escaladas por el contexto actual del doc). */
function dibujarSimbolo(doc, simbolo) {
  const GROSOR = 0.012; // "metros" de línea a la escala actual del croquis
  for (const p of simbolo.paths) {
    const color = p.c || '#000000';
    if (p.t === 'line') {
      doc.moveTo(p.p[0][0], p.p[0][1]).lineTo(p.p[1][0], p.p[1][1]).lineWidth(GROSOR).strokeColor(color).stroke();
    } else if (p.t === 'poly') {
      doc.moveTo(p.p[0][0], p.p[0][1]);
      for (const [x, y] of p.p.slice(1)) doc.lineTo(x, y);
      if (p.closed) doc.closePath();
      doc.lineWidth(GROSOR).strokeColor(color).stroke();
    } else if (p.t === 'fill') {
      doc.moveTo(p.p[0][0], p.p[0][1]);
      for (const [x, y] of p.p.slice(1)) doc.lineTo(x, y);
      doc.closePath().fillOpacity(0.55).fillColor(color).fill();
      doc.fillOpacity(1);
    } else if (p.t === 'circle') {
      doc.circle(p.c_[0], p.c_[1], p.r).lineWidth(GROSOR).strokeColor(color).stroke();
    }
  }
}

const COLOR_COTA = '#0f766e';

/** Dibuja una cota: líneas de extensión, línea de cota con marcas oblicuas (estilo arquitectura) y la medida. `escala` = puntos por metro del croquis. */
function dibujarCota(doc, cota, escala) {
  const g = geometriaCota(cota);
  if (g.largo < 0.01) return;
  const pt = 1 / escala; // un punto del PDF, en metros del croquis
  const hueco = 3 * pt;
  const sobrante = 5 * pt;
  const marca = 4 * pt;
  const linea = (x1, y1, x2, y2) => doc.moveTo(x1, y1).lineTo(x2, y2).lineWidth(0.7 * pt).lineCap('butt').strokeColor(COLOR_COTA).stroke();

  // Líneas de extensión: desde cerca del punto medido hasta un poco más allá de la línea de cota.
  linea(cota.x1 + g.nx * g.lado * hueco, cota.y1 + g.ny * g.lado * hueco, g.ax + g.nx * g.lado * sobrante, g.ay + g.ny * g.lado * sobrante);
  linea(cota.x2 + g.nx * g.lado * hueco, cota.y2 + g.ny * g.lado * hueco, g.bx + g.nx * g.lado * sobrante, g.by + g.ny * g.lado * sobrante);
  linea(g.ax, g.ay, g.bx, g.by);
  // Marcas oblicuas a 45° en los extremos de la línea de cota.
  const dx = ((g.ux + g.nx) / Math.SQRT2) * marca;
  const dy = ((g.uy + g.ny) / Math.SQRT2) * marca;
  linea(g.ax - dx, g.ay - dy, g.ax + dx, g.ay + dy);
  linea(g.bx - dx, g.by - dy, g.bx + dx, g.by + dy);

  // Texto centrado sobre la línea de cota, del lado de afuera y siempre legible (nunca cabeza abajo).
  const texto = `${g.largo.toFixed(2).replace('.', ',')} m`;
  let angulo = (Math.atan2(g.uy, g.ux) * 180) / Math.PI;
  let lado = g.lado;
  // El texto se lee de izquierda a derecha o, en vertical, de abajo hacia arriba (como en AutoCAD).
  if (angulo >= 90 - 1e-6 || angulo < -90 - 1e-6) {
    angulo += 180;
    lado = -lado;
  }
  doc.save();
  doc.translate((g.ax + g.bx) / 2, (g.ay + g.by) / 2);
  doc.rotate(angulo);
  doc.scale(pt);
  doc.font('Helvetica').fontSize(8).fillColor(COLOR_COTA);
  const ancho = doc.widthOfString(texto);
  const alto = doc.currentLineHeight();
  doc.text(texto, -ancho / 2, lado > 0 ? 2 : -2 - alto, { lineBreak: false });
  doc.restore();
  doc.fillColor('#000');
}

// Tamaño del croquis en el PDF: se dibuja a un tamaño legible pero sin agrandarlo de más (un stand
// chico no necesita ocupar media hoja), así entra más contenido por página.
const CROQUIS_ESCALA_MAX = 80; // puntos por metro
const CROQUIS_ALTO_MAX = 300;
const CROQUIS_ENCOGER_MIN = 0.7; // se lo achica hasta este porcentaje de su tamaño ideal para que entre en lo que queda de la página
const COMENTARIOS_ANCHO = 170;
const COMENTARIOS_SEPARACION = 12;
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

  // Se resuelve acá el símbolo de cada material (no viene de la DB) para que la caja de encuadre
  // tenga en cuenta su tamaño real, si no, un material cerca del borde queda fuera de la página.
  const materiales = c.materiales.map((m) => {
    const codigo = m.bloque || codigoPorItemId.get(m.catalogo_item_id);
    const simbolo = codigo ? simbolosCroquis[codigo] : undefined;
    return { ...m, ancho: simbolo?.ancho || 0, profundidad: simbolo?.profundidad || 0, simbolo };
  });
  const caja = cajaDelCroquis({ paredes: c.paredes, materiales, cotas: c.cotas });

  const x0 = doc.page.margins.left;
  const anchoTotal = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const hayComentarios = c.comentarios.length > 0;
  const anchoCroquis = hayComentarios ? anchoTotal - COMENTARIOS_ANCHO - COMENTARIOS_SEPARACION : anchoTotal;
  const anchoTexto = COMENTARIOS_ANCHO - 16;
  let altoComentarios = 0;
  if (hayComentarios) {
    doc.font('Helvetica').fontSize(9);
    altoComentarios = doc.heightOfString(c.comentarios, { width: anchoTexto }) + 30;
  }

  const escalaIdeal = Math.max(1, Math.min(anchoCroquis / caja.w, CROQUIS_ALTO_MAX / caja.h, CROQUIS_ESCALA_MAX));
  let escala = escalaIdeal;
  let ponerTitulo = conTitulo;
  const espacioAca = fondo - doc.y - ETIQUETA_CROQUIS_ALTO - (conTitulo ? TITULO_LOTE_ALTO : 0);
  if (Math.max(caja.h * escalaIdeal, altoComentarios) > espacioAca) {
    const escalaQueEntra = espacioAca / caja.h;
    if (altoComentarios <= espacioAca && escalaQueEntra >= escalaIdeal * CROQUIS_ENCOGER_MIN) {
      escala = escalaQueEntra;
    } else {
      doc.addPage();
      ponerTitulo = true; // en la hoja nueva se vuelve a decir a qué lote pertenece
    }
  }
  if (ponerTitulo) tituloLote(doc, c.lote_codigo, c.lote_expositor);

  doc.font('Helvetica-Bold').fontSize(9).fillColor('#666').text('CROQUIS', COL_PRODUCTO, doc.y);
  doc.font('Helvetica');
  doc.moveDown(0.4);
  const y0 = doc.y;
  const espacio = fondo - y0;
  escala = Math.min(escala, espacio / caja.h);
  const xDibujo = x0 + (anchoCroquis - caja.w * escala) / 2;

  doc.save();
  doc.translate(xDibujo, y0);
  doc.scale(escala);
  doc.translate(-caja.x, -caja.y);
  for (const p of c.paredes) {
    doc.moveTo(p.x1, p.y1).lineTo(p.x2, p.y2).lineWidth(0.03).lineCap('round').strokeColor('#333').stroke();
  }
  for (const m of materiales) {
    if (!m.simbolo) continue;
    doc.save();
    doc.translate(m.x, m.y);
    doc.rotate(m.rotacion || 0, { origin: [m.simbolo.ancho / 2, m.simbolo.profundidad / 2] });
    dibujarSimbolo(doc, m.simbolo);
    doc.restore();
  }
  for (const cota of c.cotas) dibujarCota(doc, cota, escala);
  doc.restore();

  let altoBloque = caja.h * escala;
  if (hayComentarios) {
    const xCaja = x0 + anchoCroquis + COMENTARIOS_SEPARACION;
    const altoCaja = Math.min(espacio, altoComentarios);
    doc.lineWidth(0.75).strokeColor('#bbb').rect(xCaja, y0, COMENTARIOS_ANCHO, altoCaja).stroke();
    doc.font('Helvetica-Bold').fontSize(8).fillColor('#666').text('COMENTARIOS', xCaja + 8, y0 + 8, { width: anchoTexto });
    doc.font('Helvetica').fontSize(9).fillColor('#000').text(c.comentarios, xCaja + 8, y0 + 22, { width: anchoTexto, height: altoCaja - 30, ellipsis: true });
    altoBloque = Math.max(altoBloque, altoCaja);
  }

  doc.fillColor('#000');
  doc.x = x0;
  doc.y = y0 + altoBloque + SEPARACION_DESPUES;
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

  const sufijoArchivo = rubrosFiltro && rubrosFiltro.length > 0 ? `-${rubrosFiltro.join('-')}` : '';
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="evento-${eventoId}${sufijoArchivo}.pdf"`);

  const doc = new PDFDocument({ margin: 40 });
  doc.pipe(res);

  encabezadoEvento(doc, evento);

  // Cada lote lleva su croquis (si lo dibujaron) debajo de su detalle. Un lote con croquis pero sin
  // detalle en este PDF (no tiene productos) igual se imprime, con su propio título — salvo que se
  // esté filtrando por rubros, donde sólo salen los lotes que aparecen en el listado.
  const croquis = lotesConCroquis(db, eventoId);
  const codigoPorItemId = codigosDeMateriales(db, croquis);
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

module.exports = { streamPdf, cajaDelCroquis, geometriaCota };
