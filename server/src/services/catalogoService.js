/**
 * ABM del catálogo: ítems (con su regla de precio y sus dependencias), páginas, ajustes y la
 * pantalla de televisores. Todo cambio que toca precios recalcula la versión General en la misma
 * transacción; las versiones de evento no se tocan solas (son una foto).
 */
const { db, transaction } = require('../db/connection');
const { calcularPrecios, normalizarCodigo, TIPOS_REGLA, grafoDependencias, dependientesTransitivos, describirMotivo } = require('./catalogoPreciosService');
const calculo = require('./catalogoCalculoService');
const { CARPETA_IMAGENES } = require('./catalogoImagenService');

const { errorHttp, validarPorcentaje, validarFechaIso } = calculo;

const tiene = (obj, clave) => obj !== null && typeof obj === 'object' && Object.prototype.hasOwnProperty.call(obj, clave);
const texto = (valor, campo, { max = 200, obligatorio = false } = {}) => {
  if (valor === null || valor === undefined || String(valor).trim() === '') {
    if (obligatorio) throw errorHttp(400, `${campo} es obligatorio`);
    return null;
  }
  const t = String(valor).trim();
  if (t.length > max) throw errorHttp(400, `${campo} no puede pasar de ${max} caracteres`);
  return t;
};
const numero = (valor, campo, { minimo = null, exclusivo = false } = {}) => {
  const n = typeof valor === 'string' && valor.trim() !== '' ? Number(valor.replace(',', '.')) : valor;
  if (typeof n !== 'number' || !Number.isFinite(n)) throw errorHttp(400, `${campo} tiene que ser un número`);
  if (minimo !== null && (exclusivo ? n <= minimo : n < minimo)) {
    throw errorHttp(400, `${campo} tiene que ser ${exclusivo ? 'mayor a' : 'como mínimo'} ${minimo}`);
  }
  return n;
};

// ---------------------------------------------------------------- fichas (texto enriquecido)

const textoPlano = (corridas) => corridas.map((c) => c.t).join('');

/** { titulo, detalle } → corridas: título en Calibri 14 negrita, medidas en Calibri 11 normal, como el catálogo actual. */
function corridasDeFicha({ titulo, detalle } = {}) {
  const t = String(titulo || '').replace(/\r\n?/g, '\n').trim();
  const d = String(detalle || '').replace(/\r\n?/g, '\n').trim();
  const corridas = [];
  if (t) corridas.push({ t: d ? `${t}\n` : t, b: true, sz: 14 });
  if (d) corridas.push({ t: d, b: false, sz: 11 });
  return corridas;
}

function validarCorridas(corridas) {
  if (!Array.isArray(corridas)) throw errorHttp(400, 'El formato de la ficha tiene que ser una lista de tramos');
  return corridas.map((c) => {
    if (!c || typeof c.t !== 'string' || typeof c.b !== 'boolean' || typeof c.sz !== 'number' || c.sz < 6 || c.sz > 60) {
      throw errorHttp(400, 'Cada tramo de la ficha necesita t (texto), b (negrita sí/no) y sz (tamaño entre 6 y 60)');
    }
    return { t: c.t.replace(/\r\n?/g, '\n'), b: c.b, sz: c.sz };
  });
}

/** Mejor esfuerzo para editar: el título son los primeros tramos en negrita, lo demás es el detalle. */
function fichaDeItem(item) {
  let corridas = [];
  try {
    corridas = item.descripcion_formato ? JSON.parse(item.descripcion_formato) : [];
  } catch {
    corridas = [];
  }
  if (corridas.length === 0) return { titulo: item.descripcion_catalogo || '', detalle: '' };
  let i = 0;
  let titulo = '';
  while (i < corridas.length && corridas[i].b) titulo += corridas[i++].t;
  return { titulo: titulo.trim(), detalle: corridas.slice(i).map((c) => c.t).join('').trim() };
}

// ---------------------------------------------------------------- reglas de precio

function describirRegla(item, porId) {
  const cod = (id) => (porId.get(id) ? porId.get(id).codigo : '?');
  const factor = item.regla_factor !== null && item.regla_factor !== 1 ? ` ×${Math.round(item.regla_factor * 1e6) / 1e6}` : '';
  const pesos = (n) => (typeof n === 'number' ? `$${Math.round(n).toLocaleString('es-AR')}` : '—');
  switch (item.regla_tipo) {
    case 'base':
      return `base (${item.regla_codigo_base || item.codigo})${factor}`;
    case 'derivado':
      return `derivado de ${cod(item.regla_item_ref_id)}${factor}`;
    case 'razon':
      return `razón ${cod(item.regla_item_ref_id)} × ${cod(item.regla_item_ref2_id)} / ${cod(item.regla_item_ref3_id)}`;
    case 'proporcional':
      return `proporcional al SAE de ${cod(item.regla_item_ref_id)} × ${item.regla_num}/${item.regla_den}`;
    case 'manual':
      return item.suma_adicional_pie ? `manual ${pesos(item.valor_manual)} + pie` : `manual ${pesos(item.valor_manual)}`;
    default:
      return 'sin precio';
  }
}

function reglaComoObjeto(item, porId) {
  const cod = (id) => (id !== null && porId.get(id) ? porId.get(id).codigo : null);
  return {
    tipo: item.regla_tipo,
    codigo_base: item.regla_codigo_base,
    ref: cod(item.regla_item_ref_id),
    ref2: cod(item.regla_item_ref2_id),
    ref3: cod(item.regla_item_ref3_id),
    factor: item.regla_factor,
    num: item.regla_num,
    den: item.regla_den,
    valor: item.valor_manual,
    suma_adicional_pie: Boolean(item.suma_adicional_pie),
  };
}

function resolverReferencia(valor, campo, propioId) {
  if (valor === null || valor === undefined || valor === '') throw errorHttp(400, `La regla necesita ${campo}`);
  const fila =
    typeof valor === 'number'
      ? db.prepare('SELECT id, codigo FROM catalogo_items WHERE id = ?').get(valor)
      : db.prepare('SELECT id, codigo FROM catalogo_items WHERE codigo = ? COLLATE NOCASE').get(String(valor).trim());
  if (!fila) throw errorHttp(400, `No existe el ítem "${valor}" (${campo} de la regla)`);
  if (propioId !== null && fila.id === propioId) throw errorHttp(400, 'Un ítem no puede depender de sí mismo');
  return fila.id;
}

/** Valida una regla y la convierte en las columnas de catalogo_items (lo que no aplica al tipo queda en NULL). */
function columnasDeRegla(regla, { codigo, propioId = null }) {
  if (!regla || typeof regla !== 'object') throw errorHttp(400, 'Falta la regla de precio');
  if (!TIPOS_REGLA.includes(regla.tipo)) throw errorHttp(400, `Tipo de regla inválido. Los válidos son: ${TIPOS_REGLA.join(', ')}`);
  const col = {
    regla_tipo: regla.tipo,
    regla_codigo_base: null,
    regla_item_ref_id: null,
    regla_item_ref2_id: null,
    regla_item_ref3_id: null,
    regla_factor: null,
    regla_num: null,
    regla_den: null,
    valor_manual: null,
    suma_adicional_pie: 0,
  };
  const factorOpcional = () => {
    if (regla.factor !== null && regla.factor !== undefined && regla.factor !== '') col.regla_factor = numero(regla.factor, 'El factor', { minimo: 0, exclusivo: true });
  };
  switch (regla.tipo) {
    case 'base':
      col.regla_codigo_base = texto(regla.codigo_base, 'El código de la base', { max: 60 }) || codigo;
      factorOpcional();
      break;
    case 'derivado':
      col.regla_item_ref_id = resolverReferencia(regla.ref, 'el ítem de origen', propioId);
      factorOpcional();
      break;
    case 'manual':
      col.valor_manual = numero(regla.valor, 'El precio fijo', { minimo: 0, exclusivo: true });
      col.suma_adicional_pie = regla.suma_adicional_pie ? 1 : 0;
      break;
    case 'proporcional':
      col.regla_item_ref_id = resolverReferencia(regla.ref, 'el ítem de origen', propioId);
      col.regla_num = numero(regla.num, 'El numerador', { minimo: 0, exclusivo: true });
      col.regla_den = numero(regla.den, 'El denominador', { minimo: 0, exclusivo: true });
      break;
    case 'razon':
      col.regla_item_ref_id = resolverReferencia(regla.ref, 'el primer ítem', propioId);
      col.regla_item_ref2_id = resolverReferencia(regla.ref2, 'el segundo ítem', propioId);
      col.regla_item_ref3_id = resolverReferencia(regla.ref3, 'el ítem divisor', propioId);
      break;
    default:
      break;
  }
  return col;
}

/** Después de tocar una regla: que no haya quedado ninguna dependencia circular (si la hay, la transacción se deshace). */
function verificarSinCiclos() {
  const items = calculo.leerItems();
  const resultados = calcularPrecios(items, { precioBase: new Map(), porcentajeGlobal: 0 });
  const enCiclo = items.filter((i) => resultados.get(i.id).motivo === 'ciclo').map((i) => i.codigo);
  if (enCiclo.length > 0) throw errorHttp(400, `Esa regla crea una dependencia circular entre: ${enCiclo.join(', ')}`);
}

// ---------------------------------------------------------------- ítems

function requerirItem(id) {
  const item = db.prepare('SELECT * FROM catalogo_items WHERE id = ?').get(id);
  if (!item) throw errorHttp(404, 'Ítem de catálogo no encontrado');
  return item;
}

function armarItemPlano(item, porId) {
  return {
    id: item.id,
    codigo: item.codigo,
    rubro: item.rubro,
    descripcion: item.descripcion,
    unidad: item.unidad,
    regla_tipo: item.regla_tipo,
    regla_texto: describirRegla(item, porId),
    porcentaje: item.porcentaje,
    pase_parche: item.pase_parche,
    sae: item.sae,
    estado_precio: item.estado_precio,
    motivo_precio: item.motivo_precio,
    motivo_texto: item.motivo_precio ? describirMotivo(item.motivo_precio) : null,
    publicado: item.publicado,
    activo: item.activo,
    imagen: item.imagen,
    producto_id: item.producto_id,
  };
}

function listarItems({ rubro, publicado, q, estado, activo } = {}) {
  const todos = calculo.leerItems();
  const porId = new Map(todos.map((i) => [i.id, i]));
  const buscado = q ? String(q).trim().toUpperCase() : '';
  return todos
    .filter((i) => (activo === 'todos' ? true : activo === '0' || activo === 0 || activo === false ? i.activo === 0 : i.activo === 1))
    .filter((i) => !rubro || i.rubro === rubro)
    .filter((i) => publicado === undefined || publicado === '' || i.publicado === (publicado === '1' || publicado === 1 || publicado === true ? 1 : 0))
    .filter((i) => !estado || i.estado_precio === estado)
    .filter((i) => !buscado || [i.codigo, i.descripcion, i.descripcion_catalogo].some((t) => t && String(t).toUpperCase().includes(buscado)))
    .sort((a, b) => String(a.rubro).localeCompare(String(b.rubro)) || a.codigo.localeCompare(b.codigo, 'es', { numeric: true }))
    .map((i) => armarItemPlano(i, porId));
}

function obtenerItem(id) {
  const item = requerirItem(id);
  const todos = calculo.leerItems();
  const porId = new Map(todos.map((i) => [i.id, i]));
  const grafo = grafoDependencias(todos);
  const lista = (ids) => ids.filter((x) => porId.has(x)).map((x) => ({ id: x, codigo: porId.get(x).codigo }));

  return {
    ...armarItemPlano(item, porId),
    regla: reglaComoObjeto(item, porId),
    ficha: fichaDeItem(item),
    descripcion_catalogo: item.descripcion_catalogo,
    descripcion_formato: item.descripcion_formato ? JSON.parse(item.descripcion_formato) : null,
    depende_de: lista(grafo.dependeDe.get(id) || []),
    dependientes: lista(grafo.dependientes.get(id) || []),
    dependientes_indirectos: lista(dependientesTransitivos(grafo, id)),
    producto: item.producto_id ? db.prepare('SELECT id, codigo, nombre FROM productos WHERE id = ?').get(item.producto_id) || null : null,
    posicion:
      db
        .prepare(
          `SELECT p.id AS pagina_id, p.orden, p.titulo, po.banda, po.columna FROM catalogo_posiciones po
             JOIN catalogo_paginas p ON p.id = po.pagina_id WHERE po.item_id = ?`
        )
        .get(id) || null,
    precios_por_version: db
      .prepare(
        `SELECT v.id AS version_id, v.nombre, vp.sae, vp.estado_precio FROM catalogo_version_precios vp
           JOIN catalogo_versiones v ON v.id = vp.version_id WHERE vp.item_id = ? ORDER BY v.es_general DESC, v.nombre`
      )
      .all(id),
  };
}

/** Descripción de la ficha desde la API: `ficha` {titulo, detalle}, o `descripcion_formato` (tramos) si se quiere control fino. */
function columnasDeFicha(datos) {
  let corridas = null;
  if (tiene(datos, 'descripcion_formato') && datos.descripcion_formato !== null) corridas = validarCorridas(datos.descripcion_formato);
  else if (tiene(datos, 'ficha')) corridas = corridasDeFicha(datos.ficha || {});
  else return null;
  return {
    descripcion_catalogo: corridas.length > 0 ? textoPlano(corridas) : null,
    descripcion_formato: corridas.length > 0 ? JSON.stringify(corridas) : null,
  };
}

function validarProducto(valor) {
  if (valor === null || valor === undefined || valor === '') return null;
  const id = numero(valor, 'El producto');
  if (!db.prepare('SELECT id FROM productos WHERE id = ?').get(id)) throw errorHttp(400, 'El producto indicado no existe');
  return id;
}

function crearItem(datos = {}) {
  const codigo = texto(datos.codigo, 'El código', { max: 60, obligatorio: true });
  if (db.prepare('SELECT id FROM catalogo_items WHERE codigo = ? COLLATE NOCASE').get(codigo)) {
    throw errorHttp(400, `Ya existe un ítem con el código "${codigo}"`);
  }
  const porcentaje = datos.porcentaje === null || datos.porcentaje === undefined || datos.porcentaje === '' ? null : validarPorcentaje(datos.porcentaje);
  const ficha = columnasDeFicha(datos) || { descripcion_catalogo: null, descripcion_formato: null };
  const regla = columnasDeRegla(datos.regla || { tipo: 'sin_precio' }, { codigo });
  const auto = db.prepare('SELECT id FROM productos WHERE upper(trim(codigo)) = ? ORDER BY id LIMIT 1').get(normalizarCodigo(codigo));
  const producto = tiene(datos, 'producto_id') ? validarProducto(datos.producto_id) : auto ? auto.id : null;

  return transaction(() => {
    const info = db
      .prepare(
        `INSERT INTO catalogo_items (codigo, rubro, descripcion, descripcion_catalogo, descripcion_formato, unidad, regla_tipo, regla_codigo_base,
           regla_item_ref_id, regla_item_ref2_id, regla_item_ref3_id, regla_factor, regla_num, regla_den, valor_manual, suma_adicional_pie, porcentaje, producto_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        codigo, texto(datos.rubro, 'El rubro', { max: 60 }), texto(datos.descripcion, 'La descripción', { max: 300 }), ficha.descripcion_catalogo, ficha.descripcion_formato,
        texto(datos.unidad, 'La unidad', { max: 20 }), regla.regla_tipo, regla.regla_codigo_base, regla.regla_item_ref_id, regla.regla_item_ref2_id, regla.regla_item_ref3_id,
        regla.regla_factor, regla.regla_num, regla.regla_den, regla.valor_manual, regla.suma_adicional_pie, porcentaje, producto
      );
    const id = Number(info.lastInsertRowid);
    verificarSinCiclos();
    calculo.recalcularGeneral();
    return obtenerItem(id);
  });
}

function actualizarItem(id, datos = {}) {
  const actual = requerirItem(id);
  const sets = {};

  if (tiene(datos, 'codigo')) {
    const codigo = texto(datos.codigo, 'El código', { max: 60, obligatorio: true });
    const repetido = db.prepare('SELECT id FROM catalogo_items WHERE codigo = ? COLLATE NOCASE AND id <> ?').get(codigo, id);
    if (repetido) throw errorHttp(400, `Ya existe un ítem con el código "${codigo}"`);
    sets.codigo = codigo;
  }
  if (tiene(datos, 'rubro')) sets.rubro = texto(datos.rubro, 'El rubro', { max: 60 });
  if (tiene(datos, 'descripcion')) sets.descripcion = texto(datos.descripcion, 'La descripción', { max: 300 });
  if (tiene(datos, 'unidad')) sets.unidad = texto(datos.unidad, 'La unidad', { max: 20 });
  if (tiene(datos, 'porcentaje')) sets.porcentaje = datos.porcentaje === null || datos.porcentaje === '' ? null : validarPorcentaje(datos.porcentaje);
  if (tiene(datos, 'activo')) sets.activo = datos.activo ? 1 : 0;
  if (tiene(datos, 'producto_id')) sets.producto_id = validarProducto(datos.producto_id);
  const ficha = columnasDeFicha(datos);
  if (ficha) Object.assign(sets, ficha);
  if (tiene(datos, 'regla')) Object.assign(sets, columnasDeRegla(datos.regla, { codigo: sets.codigo || actual.codigo, propioId: id }));

  if (Object.keys(sets).length === 0) return obtenerItem(id);
  if (sets.activo === 0) {
    const dependientes = db
      .prepare(
        `SELECT codigo FROM catalogo_items WHERE id <> ? AND (regla_item_ref_id = ? OR regla_item_ref2_id = ? OR regla_item_ref3_id = ?)`
      )
      .all(id, id, id, id)
      .map((f) => f.codigo);
    if (dependientes.length > 0) throw errorHttp(400, `No se puede dar de baja: de este ítem dependen ${dependientes.join(', ')}. Cambiales la regla primero.`);
  }

  return transaction(() => {
    const columnas = Object.keys(sets);
    db.prepare(`UPDATE catalogo_items SET ${columnas.map((c) => `${c} = ?`).join(', ')}, actualizado_en = datetime('now') WHERE id = ?`).run(...columnas.map((c) => sets[c]), id);
    verificarSinCiclos();
    calculo.recalcularGeneral();
    return obtenerItem(id);
  });
}

function eliminarItem(id) {
  requerirItem(id);
  const dependientes = db
    .prepare(`SELECT codigo FROM catalogo_items WHERE id <> ? AND (regla_item_ref_id = ? OR regla_item_ref2_id = ? OR regla_item_ref3_id = ?)`)
    .all(id, id, id, id)
    .map((f) => f.codigo);
  if (dependientes.length > 0) {
    throw errorHttp(400, `No se puede borrar: de este ítem dependen ${dependientes.join(', ')}. Cambiales la regla primero.`);
  }
  const enPagina = db.prepare('SELECT COUNT(*) AS n FROM catalogo_posiciones WHERE item_id = ?').get(id).n > 0;
  const enVersiones = db
    .prepare('SELECT COUNT(*) AS n FROM catalogo_version_precios vp JOIN catalogo_versiones v ON v.id = vp.version_id WHERE vp.item_id = ? AND v.es_general = 0')
    .get(id).n > 0;

  return transaction(() => {
    if (enPagina || enVersiones) {
      db.prepare("UPDATE catalogo_items SET activo = 0, actualizado_en = datetime('now') WHERE id = ?").run(id);
      return { resultado: 'baja_logica', mensaje: 'El ítem está en el catálogo o en versiones guardadas: se dio de baja (no sale más en el PDF) pero se conserva.' };
    }
    db.prepare('DELETE FROM catalogo_version_precios WHERE item_id = ?').run(id);
    db.prepare('DELETE FROM catalogo_items WHERE id = ?').run(id);
    return { resultado: 'borrado', mensaje: 'Ítem borrado.' };
  });
}

/** Guarda el nombre de archivo de la foto (ya procesada por guardarImagen) en el ítem. */
function asignarImagen(id, archivo) {
  requerirItem(id);
  db.prepare("UPDATE catalogo_items SET imagen = ?, actualizado_en = datetime('now') WHERE id = ?").run(archivo, id);
  return obtenerItem(id);
}

// ---------------------------------------------------------------- páginas

/** Estructura del catálogo con los precios de una versión (por defecto la General) y el formato de cada ficha. */
function obtenerPaginas(versionId) {
  const version = versionId === undefined || versionId === null || Number.isNaN(versionId)
    ? calculo.versionGeneral()
    : db.prepare('SELECT * FROM catalogo_versiones WHERE id = ?').get(versionId);
  if (!version) throw errorHttp(404, 'Versión de catálogo no encontrada');
  const paginas = db.prepare('SELECT * FROM catalogo_paginas ORDER BY orden, id').all();
  const filas = db
    .prepare(
      `SELECT po.pagina_id, po.banda, po.columna, i.id AS item_id, i.codigo, i.descripcion_catalogo, i.descripcion_formato, i.imagen, i.activo, vp.sae, vp.estado_precio
         FROM catalogo_posiciones po JOIN catalogo_items i ON i.id = po.item_id
         LEFT JOIN catalogo_version_precios vp ON vp.item_id = i.id AND vp.version_id = ?
        ORDER BY po.banda, po.columna`
    )
    .all(version.id);
  return paginas.map((p) => ({
    id: p.id,
    orden: p.orden,
    titulo: p.titulo,
    logo_grande: p.logo_grande,
    posiciones: filas
      .filter((f) => f.pagina_id === p.id)
      .map((f) => ({
        banda: f.banda,
        columna: f.columna,
        item: { id: f.item_id, codigo: f.codigo, descripcion_catalogo: f.descripcion_catalogo, descripcion_formato: f.descripcion_formato ? JSON.parse(f.descripcion_formato) : null, imagen: f.imagen, activo: f.activo, sae: f.sae, estado_precio: f.estado_precio },
      })),
  }));
}

/** Reemplaza toda la estructura del catálogo (orden de páginas y qué ítem va en cada celda). Conserva el id de las páginas que ya existían. */
function guardarPaginas(paginas) {
  if (!Array.isArray(paginas)) throw errorHttp(400, 'Falta la lista de páginas');
  const idsExistentes = new Set(db.prepare('SELECT id FROM catalogo_paginas').all().map((p) => p.id));
  const usados = new Set();
  const celdas = new Set();

  const normalizadas = paginas.map((p, i) => {
    const titulo = texto(p && p.titulo, `El título de la página ${i + 1}`, { max: 80, obligatorio: true });
    const logoGrande = p.logo_grande ? 1 : 0;
    if (logoGrande && i > 0) throw errorHttp(400, 'Sólo la primera página puede llevar el logo grande (la portada)');
    const id = p.id === undefined || p.id === null ? null : Number(p.id);
    if (id !== null && !idsExistentes.has(id)) throw errorHttp(400, `La página ${id} no existe`);
    if (id !== null && usados.has(id)) throw errorHttp(400, `La página ${id} está repetida`);
    if (id !== null) usados.add(id);
    const posiciones = (Array.isArray(p.posiciones) ? p.posiciones : []).map((pos) => {
      const banda = Number(pos.banda);
      const columna = Number(pos.columna);
      if (![1, 2].includes(banda) || ![1, 2, 3].includes(columna)) throw errorHttp(400, `Posición inválida en "${titulo}": la banda es 1 o 2 y la columna 1, 2 o 3`);
      const clave = `${i}-${banda}-${columna}`;
      if (celdas.has(clave)) throw errorHttp(400, `En "${titulo}" hay dos ítems en la banda ${banda}, columna ${columna}`);
      celdas.add(clave);
      const itemId = Number(pos.item_id);
      if (!db.prepare('SELECT id FROM catalogo_items WHERE id = ?').get(itemId)) throw errorHttp(400, `El ítem ${pos.item_id} no existe`);
      return { banda, columna, itemId };
    });
    return { id, titulo, logoGrande, posiciones };
  });

  const vistos = new Set();
  for (const p of normalizadas) {
    for (const pos of p.posiciones) {
      if (vistos.has(pos.itemId)) {
        const codigo = db.prepare('SELECT codigo FROM catalogo_items WHERE id = ?').get(pos.itemId).codigo;
        throw errorHttp(400, `El ítem ${codigo} está ubicado más de una vez en el catálogo`);
      }
      vistos.add(pos.itemId);
    }
  }

  return transaction(() => {
    db.exec('DELETE FROM catalogo_posiciones');
    for (const id of idsExistentes) if (!usados.has(id)) db.prepare('DELETE FROM catalogo_paginas WHERE id = ?').run(id);
    normalizadas.forEach((p, i) => {
      let id = p.id;
      if (id === null) id = Number(db.prepare('INSERT INTO catalogo_paginas (orden, titulo, logo_grande) VALUES (?, ?, ?)').run(i + 1, p.titulo, p.logoGrande).lastInsertRowid);
      else db.prepare('UPDATE catalogo_paginas SET orden = ?, titulo = ?, logo_grande = ? WHERE id = ?').run(i + 1, p.titulo, p.logoGrande, id);
      for (const pos of p.posiciones) {
        db.prepare('INSERT INTO catalogo_posiciones (pagina_id, banda, columna, item_id) VALUES (?, ?, ?, ?)').run(id, pos.banda, pos.columna, pos.itemId);
      }
    });
    // "Publicado" = figura en alguna página del catálogo.
    db.exec('UPDATE catalogo_items SET publicado = CASE WHEN id IN (SELECT item_id FROM catalogo_posiciones) THEN 1 ELSE 0 END');
    return obtenerPaginas();
  });
}

// ---------------------------------------------------------------- ajustes

const AVISO_IMAGENES =
  'Las fotos del catálogo se guardan en una carpeta aparte y NO entran en el backup automático (que sólo copia la base de datos). Respaldá esa carpeta por tu cuenta.';

function obtenerAjustes() {
  const a = calculo.leerAjustes();
  return {
    porcentaje_defecto: a.porcentajeDefecto,
    multiplo_redondeo: a.multiplo,
    adicional_pie_tv: a.adicionalPie,
    fecha_vigencia: a.fechaVigencia,
    mostrar_decimales: a.mostrarDecimales,
    pie_legal: a.pieLegal,
    logo_imagen: a.logo,
    carpeta_imagenes: CARPETA_IMAGENES,
    aviso_imagenes: AVISO_IMAGENES,
  };
}

const guardarAjuste = (clave, valor) =>
  db
    .prepare(`INSERT INTO catalogo_ajustes (clave, valor) VALUES (?, ?) ON CONFLICT(clave) DO UPDATE SET valor = excluded.valor, actualizado_en = datetime('now')`)
    .run(clave, String(valor));

function actualizarAjustes(cambios = {}) {
  const nuevos = {};
  if (tiene(cambios, 'porcentaje_defecto')) nuevos.porcentaje_defecto = validarPorcentaje(cambios.porcentaje_defecto, 'El porcentaje por defecto');
  if (tiene(cambios, 'multiplo_redondeo')) {
    const n = numero(cambios.multiplo_redondeo, 'El múltiplo de redondeo', { minimo: 1 });
    if (!Number.isInteger(n) || n > 100000) throw errorHttp(400, 'El múltiplo de redondeo tiene que ser un entero entre 1 y 100000');
    nuevos.multiplo_redondeo = n;
  }
  if (tiene(cambios, 'adicional_pie_tv')) nuevos.adicional_pie_tv = numero(cambios.adicional_pie_tv, 'El adicional del pie', { minimo: 0 });
  if (tiene(cambios, 'fecha_vigencia')) nuevos.fecha_vigencia = validarFechaIso(cambios.fecha_vigencia, 'La fecha de vigencia');
  if (tiene(cambios, 'mostrar_decimales')) nuevos.mostrar_decimales = cambios.mostrar_decimales ? 1 : 0;
  if (tiene(cambios, 'pie_legal')) nuevos.pie_legal = texto(cambios.pie_legal, 'El pie legal', { max: 1000, obligatorio: true });

  return transaction(() => {
    for (const [clave, valor] of Object.entries(nuevos)) guardarAjuste(clave, valor);
    // El porcentaje por defecto ES el de la versión General; la fecha, la de su pie.
    if (tiene(nuevos, 'porcentaje_defecto')) db.prepare('UPDATE catalogo_versiones SET porcentaje_global = ? WHERE es_general = 1').run(nuevos.porcentaje_defecto);
    if (tiene(nuevos, 'fecha_vigencia')) db.prepare('UPDATE catalogo_versiones SET fecha_vigencia = ? WHERE es_general = 1').run(nuevos.fecha_vigencia);
    if (['porcentaje_defecto', 'multiplo_redondeo', 'adicional_pie_tv'].some((k) => tiene(nuevos, k))) calculo.recalcularGeneral();
    return obtenerAjustes();
  });
}

// ---------------------------------------------------------------- televisores

/** Los ítems que suman el pie: se carga a mano el precio de lista de cada uno y un adicional único. */
function obtenerTelevisores() {
  const ajustes = calculo.leerAjustes();
  const todos = calculo.leerItems();
  const porId = new Map(todos.map((i) => [i.id, i]));
  const televisores = todos.filter((i) => i.suma_adicional_pie === 1);
  const grafo = grafoDependencias(todos);
  return {
    adicional_pie: ajustes.adicionalPie,
    items: televisores.map((t) => ({
      id: t.id,
      codigo: t.codigo,
      descripcion: t.descripcion,
      precio_lista: t.valor_manual,
      pase_parche: t.pase_parche,
      porcentaje: t.porcentaje,
      sae: t.sae,
      estado_precio: t.estado_precio,
      derivados: (grafo.dependientes.get(t.id) || []).map((d) => ({ id: d, codigo: porId.get(d).codigo, sae: porId.get(d).sae })),
    })),
  };
}

function actualizarTelevisores({ adicional_pie: adicional, precios } = {}) {
  const cambios = Array.isArray(precios) ? precios : [];
  const validados = cambios.map((p) => {
    const item = db.prepare('SELECT id, suma_adicional_pie FROM catalogo_items WHERE id = ?').get(Number(p.id));
    if (!item || item.suma_adicional_pie !== 1) throw errorHttp(400, `El ítem ${p.id} no es un televisor (no suma el pie)`);
    return { id: item.id, valor: numero(p.precio_lista, 'El precio de lista', { minimo: 0, exclusivo: true }) };
  });
  const nuevoAdicional = adicional === undefined ? null : numero(adicional, 'El adicional del pie', { minimo: 0 });

  return transaction(() => {
    for (const { id, valor } of validados) db.prepare("UPDATE catalogo_items SET valor_manual = ?, actualizado_en = datetime('now') WHERE id = ?").run(valor, id);
    if (nuevoAdicional !== null) guardarAjuste('adicional_pie_tv', nuevoAdicional);
    calculo.recalcularGeneral();
    return obtenerTelevisores();
  });
}

// ---------------------------------------------------------------- historial de importaciones

function listarImportaciones() {
  return db
    .prepare(
      `SELECT c.id, c.archivo, c.fecha, c.items_afectados, c.usuario_id, u.nombre_usuario AS usuario,
              c.historial_version_id, hv.nombre AS historial_version_nombre
         FROM catalogo_importaciones c
         LEFT JOIN usuarios u ON u.id = c.usuario_id
         LEFT JOIN catalogo_versiones hv ON hv.id = c.historial_version_id
        ORDER BY c.id DESC`
    )
    .all();
}

function obtenerImportacion(id) {
  const fila = db.prepare('SELECT * FROM catalogo_importaciones WHERE id = ?').get(id);
  if (!fila) throw errorHttp(404, 'Importación no encontrada');
  return { ...fila, resumen: fila.resumen_json ? JSON.parse(fila.resumen_json) : null, resumen_json: undefined };
}

module.exports = {
  listarItems,
  obtenerItem,
  crearItem,
  actualizarItem,
  eliminarItem,
  asignarImagen,
  obtenerPaginas,
  guardarPaginas,
  obtenerAjustes,
  actualizarAjustes,
  obtenerTelevisores,
  actualizarTelevisores,
  listarImportaciones,
  obtenerImportacion,
  corridasDeFicha,
  fichaDeItem,
  describirRegla,
};
