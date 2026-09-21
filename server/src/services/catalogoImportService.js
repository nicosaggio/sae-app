const fs = require('fs');
const XLSX = require('xlsx');
const { normalizarCodigo } = require('./catalogoPreciosService');

const HOJA_BASE = 'BDatos';

function errorDeArchivo(mensaje, status = 400) {
  const err = new Error(mensaje);
  err.status = status;
  return err;
}

/** Abre un .xlsx con mensajes claros en español para los fallos típicos. */
function abrirLibro(origen, opciones) {
  const enMemoria = Buffer.isBuffer(origen);
  if (!enMemoria && (!origen || !fs.existsSync(origen))) {
    throw errorDeArchivo(`No se encontró el archivo: ${origen || '(sin ruta)'}`);
  }
  try {
    return enMemoria ? XLSX.read(origen, { ...opciones, type: 'buffer' }) : XLSX.readFile(origen, opciones);
  } catch (err) {
    if (['EBUSY', 'EPERM', 'EACCES'].includes(err.code)) {
      throw errorDeArchivo('No se pudo abrir el archivo. Si lo tenés abierto en Excel, cerralo y probá de nuevo.');
    }
    throw errorDeArchivo(`No se pudo leer el archivo. ¿Es un .xlsx válido y no está dañado? (${err.message})`);
  }
}

function filaOculta(hoja, fila) {
  const filas = hoja['!rows'];
  return Boolean(filas && filas[fila - 1] && filas[fila - 1].hidden);
}

function textoDeCelda(celda) {
  return celda && celda.v !== undefined && celda.v !== null ? String(celda.v).trim() : '';
}

/** Valor crudo de la celda: número, texto, o null si está vacía. Un error de Excel (#REF!, #N/D) queda como texto. */
function valorCrudo(celda) {
  if (!celda || celda.v === undefined || celda.v === null || celda.v === '') return null;
  if (celda.t === 'e') return celda.w || String(celda.v);
  return celda.v;
}

const ENCABEZADOS = {
  codigo: 'CODIGO',
  cliente: '$ CLIENTE',
  descripcion: 'DESCRIPCION',
  grupo: 'GRUPO',
  unidad: 'UNIDAD',
  original: '$ ORIGINAL',
  actualizado: '$ ACT.',
};

/**
 * Lee la hoja BDatos de la base parche y arma el diccionario código → `$ CLIENTE`.
 * Las columnas se ubican por el texto del encabezado (no por letra), así que sobreviven a que
 * agreguen columnas en el medio. Las filas ocultas se ignoran.
 *
 * @returns {{
 *   precios: Map<string, number|string|null>,  // clave = código normalizado; primera aparición gana
 *   filas: Array<{fila, grupo, codigo, descripcion, unidad, cliente}>,
 *   duplicados: Array<{codigo, filas}>, sinCodigo: number[], ocultas: number[], resumen: object
 * }}
 */
function leerBaseParche(ruta) {
  const libro = abrirLibro(ruta, { cellStyles: true });
  const hoja = libro.Sheets[HOJA_BASE];
  if (!hoja) {
    throw errorDeArchivo(`El archivo no tiene una hoja "${HOJA_BASE}". Hojas encontradas: ${libro.SheetNames.join(', ') || '(ninguna)'}.`);
  }
  if (!hoja['!ref']) throw errorDeArchivo(`La hoja "${HOJA_BASE}" está vacía.`);

  const rango = XLSX.utils.decode_range(hoja['!ref']);
  let filaEncabezado = null;
  const columnas = {};
  for (let r = rango.s.r; r <= Math.min(rango.e.r, rango.s.r + 14) && filaEncabezado === null; r++) {
    const encontradas = {};
    for (let c = rango.s.c; c <= rango.e.c; c++) {
      const texto = textoDeCelda(hoja[XLSX.utils.encode_cell({ r, c })]).toUpperCase();
      for (const [clave, nombre] of Object.entries(ENCABEZADOS)) {
        if (texto === nombre && encontradas[clave] === undefined) encontradas[clave] = c;
      }
    }
    if (encontradas.codigo !== undefined && encontradas.cliente !== undefined) {
      filaEncabezado = r;
      Object.assign(columnas, encontradas);
    }
  }
  if (filaEncabezado === null) {
    const faltan = [ENCABEZADOS.codigo, ENCABEZADOS.cliente].join('" y "');
    throw errorDeArchivo(`No encontré las columnas "${faltan}" en la hoja ${HOJA_BASE}. ¿Cambiaron los encabezados?`);
  }

  const celda = (r, clave) => (columnas[clave] === undefined ? undefined : hoja[XLSX.utils.encode_cell({ r, c: columnas[clave] })]);
  const precios = new Map();
  const filas = [];
  const apariciones = new Map();
  const sinCodigo = [];
  const ocultas = [];
  const resumen = { conCodigo: 0, numericos: 0, ceros: 0, textos: 0, vacios: 0 };

  for (let r = filaEncabezado + 1; r <= rango.e.r; r++) {
    const fila = r + 1;
    if (filaOculta(hoja, fila)) {
      ocultas.push(fila);
      continue;
    }
    const codigo = textoDeCelda(celda(r, 'codigo'));
    const cliente = valorCrudo(celda(r, 'cliente'));
    if (!codigo) {
      if (cliente !== null) sinCodigo.push(fila);
      continue;
    }

    resumen.conCodigo++;
    if (cliente === null) resumen.vacios++;
    else if (typeof cliente === 'string') resumen.textos++;
    else if (cliente === 0) resumen.ceros++;
    else resumen.numericos++;

    const descripcion = textoDeCelda(celda(r, 'descripcion'));
    filas.push({ fila, grupo: textoDeCelda(celda(r, 'grupo')) || null, codigo, descripcion, unidad: textoDeCelda(celda(r, 'unidad')) || null, cliente });

    const clave = normalizarCodigo(codigo);
    if (!apariciones.has(clave)) apariciones.set(clave, []);
    apariciones.get(clave).push(fila);
    if (!precios.has(clave)) precios.set(clave, cliente);
  }

  const duplicados = [];
  for (const [clave, listaFilas] of apariciones) {
    if (listaFilas.length > 1) duplicados.push({ codigo: clave, filas: listaFilas });
  }

  return { precios, filas, duplicados, sinCodigo, ocultas, resumen };
}

module.exports = { leerBaseParche, abrirLibro, filaOculta, textoDeCelda, valorCrudo, errorDeArchivo };
