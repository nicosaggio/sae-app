/**
 * Convierte las filas de la hoja VALORES del Excel en ítems de catálogo con su regla de precio.
 * Módulo puro (sin base de datos ni archivos): recibe lo que leyeron catalogoExcelService y
 * catalogoImportService y devuelve el plan de siembra + un reporte de cómo quedó cada ítem.
 */
const { normalizarCodigo } = require('./catalogoPreciosService');

const redondear6 = (n) => Math.round(n * 1e6) / 1e6;
const numerosIguales = (a, b) => typeof a === 'number' && typeof b === 'number' && Math.abs(a - b) < 1e-9;

function normalizarTexto(texto) {
  return String(texto === null || texto === undefined ? '' : texto)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, ' ')
    .trim();
}

/** Parecido entre dos textos (0 a 1), por palabras en común. */
function similitud(a, b) {
  const A = new Set(normalizarTexto(a).split(' ').filter(Boolean));
  const B = new Set(normalizarTexto(b).split(' ').filter(Boolean));
  if (A.size === 0 || B.size === 0) return 0;
  let comunes = 0;
  for (const palabra of A) if (B.has(palabra)) comunes++;
  return comunes / (A.size + B.size - comunes);
}

const primeraLinea = (texto) => String(texto || '').split('\n')[0];
const hayValor = (celda) => celda && celda.v !== null && celda.v !== undefined && celda.v !== '';

/**
 * Clasifica la regla de precio de UNA fila.
 *   número literal igual a $ CLIENTE de la base parche → base
 *   fórmula que referencia otra fila (=F29*1.5, =+F137, =F178/2) → derivado (dependencia viva)
 *   (F230*F226)/F223 → razon
 *   =<lista>+<adicional del pie> → manual + suma_adicional_pie (los TV)
 *   otra constante (=58670*1.2) o número que no coincide con la base → manual
 *   vacío con fórmula proporcional en `redultado` sobre otro SAE (MC-43) → proporcional
 *   vacío → sin_precio
 */
function clasificarRegla({ fila, codigo, pase, resultado, columnas, baseParche, adicionalPie, codigoDeFila, origenBase }) {
  const avisos = [];
  const clave = normalizarCodigo(codigo);
  const enBase = baseParche.precios.has(clave);
  const clienteBase = enBase ? baseParche.precios.get(clave) : null;
  const P = columnas.pase;
  const S = columnas.sae;
  const F = hayValor(pase) ? pase : null;
  const f = F && F.f ? String(F.f).trim() : null;

  const conRef = (nFila) => {
    const cod = codigoDeFila.get(nFila);
    if (!cod) avisos.push(`Referencia a la fila ${nFila}, que no se migra: quedó como precio fijo con el valor actual`);
    return cod || null;
  };
  const comoManualConValorActual = () => ({ tipo: 'manual', valor: F && typeof F.v === 'number' ? redondear6(F.v) : null });

  let regla;
  let m;
  if (origenBase) {
    regla = { tipo: 'base', codigo_base: codigo };
  } else if (f && (m = f.match(new RegExp(`^\\+?\\$?${P}\\$?(\\d+)(?:\\*([\\d.]+)|/([\\d.]+))?$`)))) {
    const ref = conRef(Number(m[1]));
    regla = ref ? { tipo: 'derivado', ref, factor: m[2] ? Number(m[2]) : m[3] ? 1 / Number(m[3]) : 1 } : comoManualConValorActual();
  } else if (f && (m = f.match(new RegExp(`^\\(${P}(\\d+)\\*${P}(\\d+)\\)/${P}(\\d+)$`)))) {
    const refs = [conRef(Number(m[1])), conRef(Number(m[2])), conRef(Number(m[3]))];
    regla = refs.every(Boolean) ? { tipo: 'razon', ref: refs[0], ref2: refs[1], ref3: refs[2] } : comoManualConValorActual();
  } else if (f && (m = f.match(/^([\d.]+)\+([\d.]+)$/)) && numerosIguales(Number(m[2]), adicionalPie)) {
    regla = { tipo: 'manual', valor: Number(m[1]), suma_adicional_pie: true };
  } else if (f && /^[\d.+*/() ]+$/.test(f)) {
    regla = comoManualConValorActual();
  } else if (f) {
    avisos.push(`Fórmula no reconocida (=${f}): quedó como precio fijo con el valor actual`);
    regla = comoManualConValorActual();
  } else if (F && typeof F.v === 'number') {
    regla = enBase && numerosIguales(clienteBase, F.v) ? { tipo: 'base', codigo_base: codigo } : { tipo: 'manual', valor: F.v };
  } else if (F) {
    avisos.push(`El PASE PARCHE es un texto ("${F.v}"): queda sin precio`);
    regla = { tipo: 'sin_precio' };
  } else if (resultado && resultado.f && (m = String(resultado.f).match(new RegExp(`^\\(([\\d.]+)\\*${S}(\\d+)\\)/([\\d.]+)$`)))) {
    const ref = conRef(Number(m[2]));
    regla = ref ? { tipo: 'proporcional', ref, num: Number(m[1]), den: Number(m[3]) } : { tipo: 'sin_precio' };
  } else {
    regla = { tipo: 'sin_precio' };
  }

  if (regla.tipo === 'manual' && regla.valor === null) regla = { tipo: 'sin_precio' };

  const difiereBase = !origenBase && enBase && regla.tipo !== 'base' && clienteBase !== (F ? F.v : null);
  return { regla, difiereBase, clienteBase: enBase ? clienteBase : undefined, avisos };
}

/**
 * @param valores      resultado de leerCatalogoExcel().valores
 * @param paginas      resultado de leerCatalogoExcel().paginas
 * @param baseParche   resultado de leerBaseParche()
 * @param ajustes      { porcentajeDefecto, adicionalPie }
 */
function prepararItems({ valores, paginas, baseParche, ajustes }) {
  const avisos = [];
  const salteadas = [];
  const notas = [];
  const columnas = valores.columnas;

  const publicados = new Map();
  for (const pagina of paginas) {
    for (const banda of pagina.bandas) {
      for (const it of banda.items) {
        const clave = normalizarCodigo(it.codigo);
        if (publicados.has(clave)) avisos.push(`El código ${it.codigo} aparece más de una vez en el catálogo (página ${pagina.orden})`);
        else publicados.set(clave, it);
      }
    }
  }

  // Filas sin código: si la descripción coincide con UNA fila de la base parche, se toma su código.
  const basePorDescripcion = new Map();
  for (const filaBase of baseParche.filas) {
    const clave = normalizarTexto(filaBase.descripcion);
    if (!clave) continue;
    if (!basePorDescripcion.has(clave)) basePorDescripcion.set(clave, []);
    basePorDescripcion.get(clave).push(filaBase);
  }

  const filas = [];
  for (const fila of valores.filas) {
    if (fila.cod) {
      filas.push({ ...fila, codigo: fila.cod, origenBase: false });
      continue;
    }
    if (!fila.descripcion) {
      const texto = fila.pase && typeof fila.pase.v === 'string' ? fila.pase.v : null;
      notas.push({ fila: fila.fila, texto: texto || '(fila sin código ni descripción)' });
      continue;
    }
    const candidatos = basePorDescripcion.get(normalizarTexto(fila.descripcion)) || [];
    if (candidatos.length === 1) {
      filas.push({ ...fila, codigo: candidatos[0].codigo, origenBase: true });
      avisos.push(`Fila ${fila.fila} (${fila.descripcion}) no tenía código: se tomó ${candidatos[0].codigo} de la base parche`);
    } else {
      salteadas.push({
        fila: fila.fila,
        codigo: null,
        descripcion: fila.descripcion,
        motivo: candidatos.length === 0 ? 'sin código y sin equivalente en la base parche' : 'sin código y con varios equivalentes en la base parche',
      });
    }
  }

  // Códigos repetidos: se conserva la fila que coincide con lo publicado (o la primera).
  const grupos = new Map();
  for (const fila of filas) {
    const clave = normalizarCodigo(fila.codigo);
    if (!grupos.has(clave)) grupos.set(clave, []);
    grupos.get(clave).push(fila);
  }
  const conservadas = [];
  for (const [clave, grupo] of grupos) {
    if (grupo.length === 1) {
      conservadas.push(grupo[0]);
      continue;
    }
    let elegida = grupo[0];
    const publicado = publicados.get(clave);
    if (publicado) {
      let mejor = -1;
      for (const fila of grupo) {
        const puntaje = similitud(primeraLinea(publicado.descripcion), fila.descripcion);
        if (puntaje > mejor) {
          mejor = puntaje;
          elegida = fila;
        }
      }
    }
    conservadas.push(elegida);
    for (const fila of grupo) {
      if (fila === elegida) continue;
      salteadas.push({
        fila: fila.fila,
        codigo: fila.codigo,
        descripcion: fila.descripcion,
        motivo: `código duplicado: se conserva la fila ${elegida.fila}${publicado ? ' (la que coincide con lo publicado)' : ' (la primera)'}`,
      });
    }
  }
  conservadas.sort((a, b) => a.fila - b.fila);

  const codigoDeFila = new Map(conservadas.map((f) => [f.fila, f.codigo]));
  const items = conservadas.map((fila) => {
    const { regla, difiereBase, clienteBase, avisos: avisosItem } = clasificarRegla({
      fila: fila.fila,
      codigo: fila.codigo,
      pase: fila.pase,
      resultado: fila.resultado,
      columnas,
      baseParche,
      adicionalPie: ajustes.adicionalPie,
      codigoDeFila,
      origenBase: fila.origenBase,
    });
    const pct = fila.porcentaje && typeof fila.porcentaje.v === 'number' ? fila.porcentaje.v : null;
    const clave = normalizarCodigo(fila.codigo);
    const publicado = publicados.get(clave) || null;
    const unidad = baseParche.filas.find((b) => normalizarCodigo(b.codigo) === clave);
    const saeExcel = fila.sae && typeof fila.sae.v === 'number' ? fila.sae.v : null;

    return {
      fila: fila.fila,
      codigo: fila.codigo,
      rubro: fila.rubro,
      descripcion: fila.descripcion,
      descripcion_catalogo: publicado ? publicado.descripcion : null,
      descripcion_corridas: publicado ? publicado.corridas || null : null,
      unidad: unidad ? unidad.unidad : null,
      porcentaje: pct === null || numerosIguales(pct, ajustes.porcentajeDefecto) ? null : pct,
      regla,
      origen_codigo: fila.origenBase ? 'base_parche' : 'excel',
      pase_excel: fila.pase && typeof fila.pase.v === 'number' ? redondear6(fila.pase.v) : null,
      sae_excel: fila.origenBase ? null : saeExcel,
      difiere_bdatos: difiereBase,
      valor_bdatos: clienteBase,
      publicado: Boolean(publicado),
      imagen_ruta: publicado ? publicado.imagenRuta : null,
      avisos: avisosItem,
    };
  });

  for (const item of items) for (const aviso of item.avisos) avisos.push(`${item.codigo}: ${aviso}`);

  const codigosItems = new Set(items.map((i) => normalizarCodigo(i.codigo)));
  for (const [clave, it] of publicados) {
    if (!codigosItems.has(clave)) avisos.push(`El código publicado ${it.codigo} no existe en VALORES: no se puede ubicar en el catálogo`);
  }

  return { items, salteadas, avisos, notas };
}

module.exports = { prepararItems, clasificarRegla, normalizarTexto, similitud };
