/**
 * Cálculo de precios del catálogo SAE. Módulo puro: sin SQL, sin Express, sin fecha ni estado
 * global — recibe datos y devuelve datos, por eso es el que se testea contra el Excel.
 *
 * Cada ítem trae una regla de origen de precio (`regla_tipo`):
 *   base          $ CLIENTE de `regla_codigo_base` en la base parche × `regla_factor` (1 si falta)
 *   derivado      pase parche de `regla_item_ref_id` × `regla_factor`
 *   manual        `valor_manual` (+ el adicional del pie si `suma_adicional_pie`)
 *   proporcional  SAE de `regla_item_ref_id` × `regla_num` / `regla_den` (no lleva markup)
 *   razon         pase(ref) × pase(ref2) / pase(ref3)
 *   sin_precio    se muestra "S / P"
 *
 * Los ítems que referencian a otros forman un grafo: se resuelven en orden topológico y los
 * ciclos quedan marcados como error sin colgar al resto.
 */

const TIPOS_REGLA = ['base', 'derivado', 'manual', 'proporcional', 'razon', 'sin_precio'];
const MULTIPLO_POR_DEFECTO = 100;

const MOTIVOS = {
  sin_precio: 'El ítem está marcado sin precio',
  precio_vacio: 'El precio de origen está vacío',
  precio_cero: 'El precio de origen es 0',
  precio_texto: 'El precio de origen es un texto (por ejemplo "S / P" o "proveedor")',
  precio_invalido: 'El precio de origen no es un número válido',
  origen_sin_precio: 'Depende de un ítem que no tiene precio',
  origen_con_error: 'Depende de un ítem con error',
  codigo_base_inexistente: 'El código no existe en la base parche',
  referencia_inexistente: 'Referencia a un ítem que no existe',
  regla_invalida: 'La regla de precio está incompleta o es inválida',
  ciclo: 'Forma parte de una dependencia circular',
};

function describirMotivo(motivo) {
  return MOTIVOS[motivo] || motivo || '';
}

function normalizarCodigo(codigo) {
  return String(codigo === null || codigo === undefined ? '' : codigo).trim().toUpperCase();
}

/**
 * Igual que el Excel: CEILING.MATH(ROUNDUP(bruto, 0), multiplo) — siempre hacia arriba.
 * El redondeo previo a 6 decimales absorbe el ruido del punto flotante
 * (28655 * 1.4 da 40116.99999999999 y tiene que terminar en 40200, no en 40300).
 */
function redondearSae(bruto, multiplo = MULTIPLO_POR_DEFECTO) {
  if (!Number.isFinite(bruto) || bruto <= 0) return 0;
  const limpio = Math.round(bruto * 1e6) / 1e6;
  return Math.ceil(Math.ceil(limpio) / multiplo) * multiplo;
}

function errorDeValidacion(mensaje) {
  const err = new Error(mensaje);
  err.status = 400;
  return err;
}

function referenciasDe(item) {
  switch (item.regla_tipo) {
    case 'derivado':
    case 'proporcional':
      return [item.regla_item_ref_id];
    case 'razon':
      return [item.regla_item_ref_id, item.regla_item_ref2_id, item.regla_item_ref3_id];
    default:
      return [];
  }
}

function referenciasUnicas(item) {
  return Array.from(new Set(referenciasDe(item).filter((r) => r !== null && r !== undefined)));
}

/** { dependeDe: Map<id, id[]>, dependientes: Map<id, id[]> } — sólo relaciones directas. */
function grafoDependencias(items) {
  const dependeDe = new Map();
  const dependientes = new Map();
  for (const item of items) {
    dependeDe.set(item.id, []);
    dependientes.set(item.id, []);
  }
  for (const item of items) {
    for (const ref of referenciasUnicas(item)) {
      dependeDe.get(item.id).push(ref);
      if (dependientes.has(ref)) dependientes.get(ref).push(item.id);
    }
  }
  return { dependeDe, dependientes };
}

/** Todos los ítems que, directa o indirectamente, cambian de precio si cambia `id`. */
function dependientesTransitivos(grafo, id) {
  const vistos = new Set();
  const pila = [...(grafo.dependientes.get(id) || [])];
  while (pila.length > 0) {
    const actual = pila.pop();
    if (vistos.has(actual) || actual === id) continue;
    vistos.add(actual);
    pila.push(...(grafo.dependientes.get(actual) || []));
  }
  return Array.from(vistos);
}

function sinPrecio(motivo) {
  return { estado: 'sin_precio', pase_parche: null, porcentaje: null, bruto: null, sae: null, motivo };
}

function conError(motivo) {
  return { estado: 'error', pase_parche: null, porcentaje: null, bruto: null, sae: null, motivo };
}

function interpretarPrecioBase(crudo) {
  if (crudo === null || crudo === undefined || (typeof crudo === 'string' && crudo.trim() === '')) {
    return { motivo: 'precio_vacio' };
  }
  if (typeof crudo === 'string') return { motivo: 'precio_texto' };
  if (typeof crudo !== 'number' || !Number.isFinite(crudo) || crudo < 0) return { motivo: 'precio_invalido' };
  if (crudo === 0) return { motivo: 'precio_cero' };
  return { valor: crudo };
}

function porcentajeEfectivo(item, ctx) {
  if (ctx.aplicarATodos) return ctx.porcentajeGlobal;
  return item.porcentaje === null || item.porcentaje === undefined ? ctx.porcentajeGlobal : Number(item.porcentaje);
}

/** Aplica el markup y el redondeo a un pase parche ya resuelto. */
function conMarkup(item, pase, ctx) {
  const porcentaje = porcentajeEfectivo(item, ctx);
  const bruto = pase * (1 + porcentaje);
  return {
    estado: 'ok',
    pase_parche: pase,
    porcentaje,
    bruto,
    sae: redondearSae(bruto, ctx.multiplo),
    motivo: null,
  };
}

/** Devuelve el primer origen que impide calcular (error antes que sin precio), o null si están todos bien. */
function fallaDeOrigen(ids, campo, resultados) {
  let primerSinPrecio = null;
  for (const id of ids) {
    if (id === null || id === undefined) return conError('regla_invalida');
    const origen = resultados.get(id);
    if (!origen) return conError('referencia_inexistente');
    if (origen.estado === 'error') return conError('origen_con_error');
    if (!primerSinPrecio && (origen.estado === 'sin_precio' || origen[campo] === null || origen[campo] === undefined)) {
      primerSinPrecio = sinPrecio('origen_sin_precio');
    }
  }
  return primerSinPrecio;
}

function factorValido(factor) {
  return factor === null || factor === undefined || (Number.isFinite(factor) && factor > 0);
}

function resolver(item, ctx, resultados) {
  if (!TIPOS_REGLA.includes(item.regla_tipo)) return conError('regla_invalida');

  switch (item.regla_tipo) {
    case 'sin_precio':
      return sinPrecio('sin_precio');

    case 'manual': {
      const valor = item.valor_manual;
      if (valor === null || valor === undefined) return sinPrecio('precio_vacio');
      const interpretado = interpretarPrecioBase(valor);
      if (interpretado.motivo) return sinPrecio(interpretado.motivo);
      return conMarkup(item, interpretado.valor + (item.suma_adicional_pie ? ctx.adicionalPie : 0), ctx);
    }

    case 'base': {
      if (!factorValido(item.regla_factor)) return conError('regla_invalida');
      const codigo = normalizarCodigo(item.regla_codigo_base || item.codigo);
      if (!ctx.precioBase.has(codigo)) return conError('codigo_base_inexistente');
      const interpretado = interpretarPrecioBase(ctx.precioBase.get(codigo));
      if (interpretado.motivo) return sinPrecio(interpretado.motivo);
      const factor = item.regla_factor === null || item.regla_factor === undefined ? 1 : item.regla_factor;
      return conMarkup(item, interpretado.valor * factor, ctx);
    }

    case 'derivado': {
      if (!factorValido(item.regla_factor)) return conError('regla_invalida');
      const falla = fallaDeOrigen([item.regla_item_ref_id], 'pase_parche', resultados);
      if (falla) return falla;
      const factor = item.regla_factor === null || item.regla_factor === undefined ? 1 : item.regla_factor;
      return conMarkup(item, resultados.get(item.regla_item_ref_id).pase_parche * factor, ctx);
    }

    case 'proporcional': {
      const num = item.regla_num;
      const den = item.regla_den;
      if (!Number.isFinite(num) || !Number.isFinite(den) || den === 0) return conError('regla_invalida');
      const falla = fallaDeOrigen([item.regla_item_ref_id], 'sae', resultados);
      if (falla) return falla;
      // Ya parte de un SAE (con su markup y redondeo), así que no se le suma porcentaje.
      const bruto = (resultados.get(item.regla_item_ref_id).sae * num) / den;
      return { estado: 'ok', pase_parche: null, porcentaje: null, bruto, sae: redondearSae(bruto, ctx.multiplo), motivo: null };
    }

    case 'razon': {
      const refs = [item.regla_item_ref_id, item.regla_item_ref2_id, item.regla_item_ref3_id];
      const falla = fallaDeOrigen(refs, 'pase_parche', resultados);
      if (falla) return falla;
      const [a, b, c] = refs.map((id) => resultados.get(id).pase_parche);
      if (c === 0) return conError('regla_invalida');
      return conMarkup(item, (a * b) / c, ctx);
    }

    default:
      return conError('regla_invalida');
  }
}

/** ¿`id` puede volver a sí mismo siguiendo referencias sólo entre ítems sin resolver? */
function estaEnCiclo(id, porId, sinResolver) {
  const vistos = new Set();
  const pila = [...referenciasUnicas(porId.get(id))];
  while (pila.length > 0) {
    const actual = pila.pop();
    if (actual === id) return true;
    if (vistos.has(actual) || !sinResolver.has(actual)) continue;
    vistos.add(actual);
    pila.push(...referenciasUnicas(porId.get(actual)));
  }
  return false;
}

/**
 * Resuelve `pase_parche` y `sae` de todos los ítems.
 *
 * @param items    filas de catalogo_items (sólo se usan id, codigo, regla_*, valor_manual,
 *                 suma_adicional_pie y porcentaje; porcentaje NULL = sigue al global)
 * @param opciones { precioBase: Map|objeto código → $ CLIENTE crudo (número, texto o null),
 *                   porcentajeGlobal, aplicarATodos = false, multiplo = 100, adicionalPie = 0 }
 * @returns Map<id, { estado: 'ok'|'sin_precio'|'error', pase_parche, porcentaje, bruto, sae, motivo }>
 */
function calcularPrecios(items, opciones = {}) {
  const { porcentajeGlobal, aplicarATodos = false, multiplo = MULTIPLO_POR_DEFECTO, adicionalPie = 0 } = opciones;

  if (!Number.isFinite(porcentajeGlobal) || porcentajeGlobal < 0) {
    throw errorDeValidacion('El porcentaje global tiene que ser un número mayor o igual a 0');
  }
  if (!Number.isInteger(multiplo) || multiplo < 1) {
    throw errorDeValidacion('El múltiplo de redondeo tiene que ser un entero mayor a 0');
  }
  if (!Number.isFinite(adicionalPie) || adicionalPie < 0) {
    throw errorDeValidacion('El adicional del pie tiene que ser un número mayor o igual a 0');
  }

  // Primera aparición gana, como el XLOOKUP del Excel.
  const precioBase = new Map();
  const entradas = opciones.precioBase instanceof Map ? opciones.precioBase : Object.entries(opciones.precioBase || {});
  for (const [codigo, valor] of entradas) {
    const clave = normalizarCodigo(codigo);
    if (!precioBase.has(clave)) precioBase.set(clave, valor);
  }

  const ctx = { precioBase, porcentajeGlobal, aplicarATodos, multiplo, adicionalPie };
  const porId = new Map(items.map((item) => [item.id, item]));

  const pendientes = new Map();
  const dependientes = new Map();
  for (const item of items) {
    pendientes.set(item.id, 0);
    dependientes.set(item.id, []);
  }
  for (const item of items) {
    for (const ref of referenciasUnicas(item)) {
      if (!porId.has(ref)) continue;
      pendientes.set(item.id, pendientes.get(item.id) + 1);
      dependientes.get(ref).push(item.id);
    }
  }

  const resultados = new Map();
  const cola = items.filter((item) => pendientes.get(item.id) === 0).map((item) => item.id);
  for (let i = 0; i < cola.length; i++) {
    const id = cola[i];
    resultados.set(id, resolver(porId.get(id), ctx, resultados));
    for (const dependiente of dependientes.get(id)) {
      pendientes.set(dependiente, pendientes.get(dependiente) - 1);
      if (pendientes.get(dependiente) === 0) cola.push(dependiente);
    }
  }

  // Lo que no se pudo resolver son ciclos, o ítems que cuelgan de un ciclo.
  const sinResolver = new Set(items.filter((item) => !resultados.has(item.id)).map((item) => item.id));
  for (const id of sinResolver) {
    resultados.set(id, conError(estaEnCiclo(id, porId, sinResolver) ? 'ciclo' : 'origen_con_error'));
  }

  return resultados;
}

module.exports = {
  TIPOS_REGLA,
  MULTIPLO_POR_DEFECTO,
  calcularPrecios,
  redondearSae,
  normalizarCodigo,
  grafoDependencias,
  dependientesTransitivos,
  describirMotivo,
};
