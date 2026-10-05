/**
 * Dibujo de un croquis en un PDF (pdfkit): paredes, materiales con sus símbolos reales, cotas y el
 * cuadro de comentarios a la derecha. Lo usan el PDF de totales del evento (un croquis por lote) y el
 * PDF del presupuesto, así los dos salen idénticos. Las coordenadas del croquis están en metros.
 */
const simbolosCroquis = require('../data/croquisSimbolos.json');

/** code de catálogo de cada catalogo_item_id usado en estos materiales, para buscar su símbolo. */
function codigosDeMateriales(db, croquis) {
  // Los bloques auxiliares (la columna) no son ítems de catálogo: no tienen catalogo_item_id.
  const ids = [...new Set(croquis.flatMap((c) => c.materiales.map((m) => m.catalogo_item_id)).filter(Number.isInteger))];
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

/**
 * Deja listo un croquis para dibujarlo en un ancho de `anchoTotal` puntos: resuelve el símbolo de cada
 * material (no viene de la DB) para que el encuadre tenga en cuenta su tamaño real —si no, un material
 * cerca del borde queda fuera de la página—, mide el cuadro de comentarios y calcula el tamaño ideal.
 * `c` = { paredes, materiales, cotas, comentarios }; `codigoPorItemId` viene de codigosDeMateriales().
 */
function preparar(doc, c, codigoPorItemId, anchoTotal) {
  const materiales = c.materiales.map((m) => {
    const codigo = m.bloque || codigoPorItemId.get(m.catalogo_item_id);
    const simbolo = codigo ? simbolosCroquis[codigo] : undefined;
    return { ...m, ancho: simbolo?.ancho || 0, profundidad: simbolo?.profundidad || 0, simbolo };
  });
  const caja = cajaDelCroquis({ paredes: c.paredes, materiales, cotas: c.cotas });
  const comentarios = (c.comentarios || '').trim();
  const hayComentarios = comentarios.length > 0;
  const anchoCroquis = hayComentarios ? anchoTotal - COMENTARIOS_ANCHO - COMENTARIOS_SEPARACION : anchoTotal;
  const anchoTexto = COMENTARIOS_ANCHO - 16;
  let altoComentarios = 0;
  if (hayComentarios) {
    doc.font('Helvetica').fontSize(9);
    altoComentarios = doc.heightOfString(comentarios, { width: anchoTexto }) + 30;
  }
  const escalaIdeal = Math.max(1, Math.min(anchoCroquis / caja.w, CROQUIS_ALTO_MAX / caja.h, CROQUIS_ESCALA_MAX));
  return { paredes: c.paredes, cotas: c.cotas, materiales, caja, comentarios, hayComentarios, anchoCroquis, anchoTexto, altoComentarios, escalaIdeal };
}

/**
 * Con `espacio` puntos de alto libres: la escala con la que entra el croquis (el ideal o, si hace falta,
 * achicado hasta CROQUIS_ENCOGER_MIN), o null si no entra y conviene pasarlo a la hoja siguiente.
 */
function escalaParaEspacio(plan, espacio) {
  if (Math.max(plan.caja.h * plan.escalaIdeal, plan.altoComentarios) <= espacio) return plan.escalaIdeal;
  const escalaQueEntra = espacio / plan.caja.h;
  if (plan.altoComentarios <= espacio && escalaQueEntra >= plan.escalaIdeal * CROQUIS_ENCOGER_MIN) return escalaQueEntra;
  return null;
}

/**
 * Dibuja el croquis con su esquina de arriba a la izquierda en (x, y), sin pasarse de `espacio` puntos
 * de alto. `plan` viene de preparar() (con el mismo ancho). Devuelve el alto usado.
 */
function dibujar(doc, plan, { x, y, espacio, escala }) {
  const { caja } = plan;
  const escalaFinal = Math.min(escala, espacio / caja.h);
  const xDibujo = x + (plan.anchoCroquis - caja.w * escalaFinal) / 2;

  doc.save();
  doc.translate(xDibujo, y);
  doc.scale(escalaFinal);
  doc.translate(-caja.x, -caja.y);
  for (const p of plan.paredes) {
    doc.moveTo(p.x1, p.y1).lineTo(p.x2, p.y2).lineWidth(0.03).lineCap('round').strokeColor('#333').stroke();
  }
  for (const m of plan.materiales) {
    if (!m.simbolo) continue;
    doc.save();
    doc.translate(m.x, m.y);
    doc.rotate(m.rotacion || 0, { origin: [m.simbolo.ancho / 2, m.simbolo.profundidad / 2] });
    dibujarSimbolo(doc, m.simbolo);
    doc.restore();
  }
  for (const cota of plan.cotas) dibujarCota(doc, cota, escalaFinal);
  doc.restore();

  let altoBloque = caja.h * escalaFinal;
  if (plan.hayComentarios) {
    const xCaja = x + plan.anchoCroquis + COMENTARIOS_SEPARACION;
    const altoCaja = Math.min(espacio, plan.altoComentarios);
    doc.lineWidth(0.75).strokeColor('#bbb').rect(xCaja, y, COMENTARIOS_ANCHO, altoCaja).stroke();
    doc.font('Helvetica-Bold').fontSize(8).fillColor('#666').text('COMENTARIOS', xCaja + 8, y + 8, { width: plan.anchoTexto });
    doc.font('Helvetica').fontSize(9).fillColor('#000').text(plan.comentarios, xCaja + 8, y + 22, { width: plan.anchoTexto, height: altoCaja - 30, ellipsis: true });
    altoBloque = Math.max(altoBloque, altoCaja);
  }
  doc.fillColor('#000');
  return altoBloque;
}

module.exports = { codigosDeMateriales, geometriaCota, cajaDelCroquis, dibujarSimbolo, dibujarCota, preparar, escalaParaEspacio, dibujar };
