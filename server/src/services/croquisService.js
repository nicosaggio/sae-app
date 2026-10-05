/**
 * Croquis (plano de planta) de un lote o de un presupuesto de la app: paredes sueltas + materiales del catálogo colocados con
 * posición y rotación. La biblioteca de símbolos dibujables (geometría + color, extraída del
 * AutoCAD real de la empresa) vive en data/croquisSimbolos.json — sólo cubre los ítems de
 * catálogo para los que se encontró un símbolo genuino; un ítem sin símbolo no es elegible para
 * dibujar (no se inventa uno parecido).
 *
 * Además hay "bloques auxiliares" (marcados `auxiliar: true` en la biblioteca): cosas que se dibujan
 * pero no se venden, como la columna que se pone en la unión de dos dinteles. No son ítems de
 * catálogo: un material del croquis los referencia por `bloque` en vez de `catalogo_item_id`.
 */
const { db } = require('../db/connection');
const simbolos = require('../data/croquisSimbolos.json');

function error(status, mensaje) {
  const err = new Error(mensaje);
  err.status = status;
  return err;
}

function parseJsonArray(texto) {
  try {
    const v = JSON.parse(texto);
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

/** El símbolo de un bloque auxiliar (que no es un ítem de catálogo), o undefined si `bloque` no es uno. */
function bloqueAuxiliar(bloque) {
  const simbolo = typeof bloque === 'string' ? simbolos[bloque] : undefined;
  return simbolo && simbolo.auxiliar ? simbolo : undefined;
}

function armar(fila, almacen = ALMACEN_LOTE) {
  if (!fila) return null;
  const materiales = parseJsonArray(fila.materiales);
  const ids = [...new Set(materiales.map((m) => m.catalogo_item_id).filter((id) => Number.isInteger(id)))];
  const items = ids.length
    ? db.prepare(`SELECT id, codigo, descripcion FROM catalogo_items WHERE id IN (${ids.map(() => '?').join(',')})`).all(...ids)
    : [];
  const porId = new Map(items.map((i) => [i.id, i]));
  return {
    [almacen.columna]: fila[almacen.columna],
    ...(almacen.conIncluirEnPdf ? { incluir_en_pdf: Boolean(fila.incluir_en_pdf) } : {}),
    paredes: parseJsonArray(fila.paredes),
    materiales: materiales.map((m) => {
      const auxiliar = bloqueAuxiliar(m.bloque);
      const item = porId.get(m.catalogo_item_id);
      const simbolo = auxiliar || (item ? simbolos[item.codigo] : undefined);
      return {
        catalogo_item_id: auxiliar ? null : m.catalogo_item_id,
        bloque: auxiliar ? m.bloque : null,
        x: m.x,
        y: m.y,
        rotacion: m.rotacion || 0,
        codigo: auxiliar ? m.bloque : item ? item.codigo : null,
        descripcion: auxiliar ? auxiliar.descripcion : item ? item.descripcion : null,
        ancho: simbolo ? simbolo.ancho : null,
        profundidad: simbolo ? simbolo.profundidad : null,
      };
    }),
    cotas: parseJsonArray(fila.cotas),
    comentarios: fila.comentarios || '',
    actualizado_en: fila.actualizado_en,
  };
}

function exigirLote(loteId) {
  if (!db.prepare('SELECT id FROM lotes WHERE id = ?').get(loteId)) throw error(404, 'Lote no encontrado');
}

function exigirCotizacion(cotizacionId) {
  if (!db.prepare('SELECT id FROM cotizaciones WHERE id = ?').get(cotizacionId)) throw error(404, 'Presupuesto no encontrado');
}

// El croquis se guarda igual en dos lugares: en el lote (el definitivo, el que sale en los totales del
// evento) y en el presupuesto de la app mientras el lote todavía no existe (se crea al confirmarlo).
// Los nombres de tabla y de columna son constantes de acá, nunca vienen del usuario.
const ALMACEN_LOTE = { tabla: 'lote_croquis', columna: 'lote_id', exigir: exigirLote };
const ALMACEN_COTIZACION = { tabla: 'cotizacion_croquis', columna: 'cotizacion_id', exigir: exigirCotizacion, conIncluirEnPdf: true };

function obtenerDe(almacen, id) {
  almacen.exigir(id);
  return armar(db.prepare(`SELECT * FROM ${almacen.tabla} WHERE ${almacen.columna} = ?`).get(id), almacen);
}

const obtener = (loteId) => obtenerDe(ALMACEN_LOTE, loteId);

function numero(valor, campo) {
  if (typeof valor !== 'number' || !Number.isFinite(valor)) throw error(400, `"${campo}" tiene que ser un número`);
  return valor;
}

function normalizarParedes(paredes) {
  if (!Array.isArray(paredes)) throw error(400, '"paredes" tiene que ser una lista');
  return paredes.map((p) => ({
    x1: numero(p.x1, 'x1'),
    y1: numero(p.y1, 'y1'),
    x2: numero(p.x2, 'x2'),
    y2: numero(p.y2, 'y2'),
  }));
}

function normalizarMateriales(materiales) {
  if (!Array.isArray(materiales)) throw error(400, '"materiales" tiene que ser una lista');
  if (materiales.length === 0) return [];
  const esBloque = (m) => m.bloque !== undefined && m.bloque !== null;
  const ids = [...new Set(materiales.filter((m) => !esBloque(m)).map((m) => m.catalogo_item_id).filter(Number.isInteger))];
  const validos = new Set(
    ids.length ? db.prepare(`SELECT id FROM catalogo_items WHERE id IN (${ids.map(() => '?').join(',')})`).all(...ids).map((r) => r.id) : []
  );
  return materiales.map((m) => {
    const rotacion = m.rotacion === undefined ? 0 : numero(m.rotacion, 'rotacion');
    if (esBloque(m)) {
      if (!bloqueAuxiliar(m.bloque)) throw error(400, 'Uno de los materiales usa un bloque que no existe');
      return { bloque: m.bloque, x: numero(m.x, 'x'), y: numero(m.y, 'y'), rotacion };
    }
    if (!Number.isInteger(m.catalogo_item_id) || !validos.has(m.catalogo_item_id)) {
      throw error(400, 'Uno de los materiales no tiene un ítem de catálogo válido');
    }
    return { catalogo_item_id: m.catalogo_item_id, x: numero(m.x, 'x'), y: numero(m.y, 'y'), rotacion };
  });
}

// Cabe en la columna de la derecha del PDF (unas 30 líneas) sin comerse el croquis.
const COMENTARIOS_MAX = 1000;

/** undefined = no se mandó (se conserva lo que ya había); si se manda, tiene que ser texto. */
function normalizarComentarios(comentarios) {
  if (comentarios === undefined) return undefined;
  if (typeof comentarios !== 'string') throw error(400, '"comentarios" tiene que ser texto');
  const limpio = comentarios.replace(/\r\n?/g, '\n').trim();
  if (limpio.length > COMENTARIOS_MAX) throw error(400, `Los comentarios no pueden pasar de ${COMENTARIOS_MAX} caracteres`);
  return limpio;
}

const COTAS_MAX = 300;

/** Cota alineada: mide de (x1,y1) a (x2,y2) y la línea de cota va desplazada `offset` metros (con signo) en perpendicular. undefined = no se mandó (se conserva lo que ya había). */
function normalizarCotas(cotas) {
  if (cotas === undefined) return undefined;
  if (!Array.isArray(cotas)) throw error(400, '"cotas" tiene que ser una lista');
  if (cotas.length > COTAS_MAX) throw error(400, `No se pueden poner más de ${COTAS_MAX} cotas en un croquis`);
  return cotas.map((c) => ({
    x1: numero(c.x1, 'x1'),
    y1: numero(c.y1, 'y1'),
    x2: numero(c.x2, 'x2'),
    y2: numero(c.y2, 'y2'),
    offset: numero(c.offset, 'offset'),
  }));
}

function guardarEn(almacen, id, { paredes, materiales, cotas, comentarios } = {}, usuario) {
  almacen.exigir(id);
  const paredesJson = JSON.stringify(normalizarParedes(paredes || []));
  const materialesJson = JSON.stringify(normalizarMateriales(materiales || []));
  const cotasLimpias = normalizarCotas(cotas);
  const cotasJson = cotasLimpias === undefined ? null : JSON.stringify(cotasLimpias);
  const comentariosLimpios = normalizarComentarios(comentarios);

  const { tabla, columna } = almacen;
  const existente = db.prepare(`SELECT id FROM ${tabla} WHERE ${columna} = ?`).get(id);
  if (existente) {
    db.prepare(
      `UPDATE ${tabla} SET paredes = ?, materiales = ?, cotas = COALESCE(?, cotas), comentarios = COALESCE(?, comentarios), actualizado_en = datetime('now') WHERE ${columna} = ?`
    ).run(paredesJson, materialesJson, cotasJson, comentariosLimpios ?? null, id);
  } else {
    db.prepare(`INSERT INTO ${tabla} (${columna}, paredes, materiales, cotas, comentarios, creado_por) VALUES (?, ?, ?, ?, ?, ?)`).run(
      id,
      paredesJson,
      materialesJson,
      cotasJson ?? '[]',
      comentariosLimpios ?? '',
      usuario.id
    );
  }
  return obtenerDe(almacen, id);
}

function eliminarDe(almacen, id) {
  almacen.exigir(id);
  db.prepare(`DELETE FROM ${almacen.tabla} WHERE ${almacen.columna} = ?`).run(id);
}

const guardar = (loteId, datos, usuario) => guardarEn(ALMACEN_LOTE, loteId, datos, usuario);
const eliminar = (loteId) => eliminarDe(ALMACEN_LOTE, loteId);

// --- Croquis de un presupuesto de la app (cotización) -------------------------------------------

const obtenerDeCotizacion = (cotizacionId) => obtenerDe(ALMACEN_COTIZACION, cotizacionId);
const guardarDeCotizacion = (cotizacionId, datos, usuario) => guardarEn(ALMACEN_COTIZACION, cotizacionId, datos, usuario);
const eliminarDeCotizacion = (cotizacionId) => eliminarDe(ALMACEN_COTIZACION, cotizacionId);

/** Si el croquis sale o no en el PDF del presupuesto. */
function definirIncluirEnPdf(cotizacionId, incluir) {
  exigirCotizacion(cotizacionId);
  if (typeof incluir !== 'boolean') throw error(400, '"incluir_en_pdf" tiene que ser verdadero o falso');
  const info = db
    .prepare("UPDATE cotizacion_croquis SET incluir_en_pdf = ?, actualizado_en = datetime('now') WHERE cotizacion_id = ?")
    .run(incluir ? 1 : 0, cotizacionId);
  if (info.changes === 0) throw error(404, 'Este presupuesto todavía no tiene un croquis dibujado');
  return obtenerDeCotizacion(cotizacionId);
}

/** Datos de la ficha del presupuesto, sin traer todo el dibujo; null si todavía no dibujaron uno. */
function resumenDeCotizacion(cotizacionId) {
  const fila = db.prepare('SELECT paredes, materiales, cotas, comentarios, incluir_en_pdf FROM cotizacion_croquis WHERE cotizacion_id = ?').get(cotizacionId);
  if (!fila) return null;
  return {
    paredes: parseJsonArray(fila.paredes).length,
    materiales: parseJsonArray(fila.materiales).length,
    cotas: parseJsonArray(fila.cotas).length,
    con_comentarios: Boolean((fila.comentarios || '').trim()),
    incluir_en_pdf: Boolean(fila.incluir_en_pdf),
  };
}

/** Copia el croquis de un presupuesto a otro (al duplicarlo). Devuelve si había algo para copiar. */
function copiarDeCotizacion(origenId, destinoId, usuario) {
  const fila = db.prepare('SELECT * FROM cotizacion_croquis WHERE cotizacion_id = ?').get(origenId);
  if (!fila) return false;
  db.prepare(
    'INSERT INTO cotizacion_croquis (cotizacion_id, paredes, materiales, cotas, comentarios, incluir_en_pdf, creado_por) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).run(destinoId, fila.paredes, fila.materiales, fila.cotas, fila.comentarios, fila.incluir_en_pdf, usuario.id);
  return true;
}

/**
 * Al confirmar el presupuesto el croquis pasa al lote, para que salga en el PDF de totales del evento.
 * Si el lote ya tenía un croquis (de otro presupuesto del mismo stand) no se lo pisa. Devuelve
 * 'copiado', 'lote_ya_tenia' o 'sin_croquis'.
 */
function copiarALote(cotizacionId, loteId, usuario) {
  const fila = db.prepare('SELECT * FROM cotizacion_croquis WHERE cotizacion_id = ?').get(cotizacionId);
  if (!fila) return 'sin_croquis';
  if (db.prepare('SELECT 1 FROM lote_croquis WHERE lote_id = ?').get(loteId)) return 'lote_ya_tenia';
  db.prepare('INSERT INTO lote_croquis (lote_id, paredes, materiales, cotas, comentarios, creado_por) VALUES (?, ?, ?, ?, ?, ?)').run(
    loteId,
    fila.paredes,
    fila.materiales,
    fila.cotas,
    fila.comentarios,
    usuario.id
  );
  return 'copiado';
}

/**
 * Código -> {catalogo_item_id, ancho, profundidad, paths, rubro, descripcion}: los ítems de catálogo
 * activos con símbolo real, más los bloques auxiliares (catalogo_item_id null, `auxiliar: true`).
 */
function simbolosDisponibles() {
  const activos = new Map(db.prepare('SELECT id, codigo, rubro, descripcion FROM catalogo_items WHERE activo = 1').all().map((r) => [r.codigo, r]));
  const salida = {};
  for (const [codigo, simbolo] of Object.entries(simbolos)) {
    if (simbolo.auxiliar) {
      salida[codigo] = { ...simbolo, catalogo_item_id: null };
      continue;
    }
    const item = activos.get(codigo);
    if (item) salida[codigo] = { ...simbolo, catalogo_item_id: item.id, rubro: item.rubro, descripcion: item.descripcion };
  }
  return salida;
}

module.exports = {
  obtener,
  guardar,
  eliminar,
  obtenerDeCotizacion,
  guardarDeCotizacion,
  eliminarDeCotizacion,
  definirIncluirEnPdf,
  resumenDeCotizacion,
  copiarDeCotizacion,
  copiarALote,
  simbolosDisponibles,
};
