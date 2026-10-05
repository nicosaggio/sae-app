/**
 * Croquis (plano de planta) de un lote: paredes sueltas + materiales del catálogo colocados con
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

function armar(fila) {
  if (!fila) return null;
  const materiales = parseJsonArray(fila.materiales);
  const ids = [...new Set(materiales.map((m) => m.catalogo_item_id).filter((id) => Number.isInteger(id)))];
  const items = ids.length
    ? db.prepare(`SELECT id, codigo, descripcion FROM catalogo_items WHERE id IN (${ids.map(() => '?').join(',')})`).all(...ids)
    : [];
  const porId = new Map(items.map((i) => [i.id, i]));
  return {
    lote_id: fila.lote_id,
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

function obtener(loteId) {
  exigirLote(loteId);
  return armar(db.prepare('SELECT * FROM lote_croquis WHERE lote_id = ?').get(loteId));
}

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

function guardar(loteId, { paredes, materiales, cotas, comentarios } = {}, usuario) {
  exigirLote(loteId);
  const paredesJson = JSON.stringify(normalizarParedes(paredes || []));
  const materialesJson = JSON.stringify(normalizarMateriales(materiales || []));
  const cotasLimpias = normalizarCotas(cotas);
  const cotasJson = cotasLimpias === undefined ? null : JSON.stringify(cotasLimpias);
  const comentariosLimpios = normalizarComentarios(comentarios);

  const existente = db.prepare('SELECT id FROM lote_croquis WHERE lote_id = ?').get(loteId);
  if (existente) {
    db.prepare(
      `UPDATE lote_croquis SET paredes = ?, materiales = ?, cotas = COALESCE(?, cotas), comentarios = COALESCE(?, comentarios), actualizado_en = datetime('now') WHERE lote_id = ?`
    ).run(paredesJson, materialesJson, cotasJson, comentariosLimpios ?? null, loteId);
  } else {
    db.prepare('INSERT INTO lote_croquis (lote_id, paredes, materiales, cotas, comentarios, creado_por) VALUES (?, ?, ?, ?, ?, ?)').run(
      loteId,
      paredesJson,
      materialesJson,
      cotasJson ?? '[]',
      comentariosLimpios ?? '',
      usuario.id
    );
  }
  return obtener(loteId);
}

function eliminar(loteId) {
  exigirLote(loteId);
  db.prepare('DELETE FROM lote_croquis WHERE lote_id = ?').run(loteId);
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

module.exports = { obtener, guardar, eliminar, simbolosDisponibles };
