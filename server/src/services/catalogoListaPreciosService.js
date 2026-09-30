/**
 * Lee una lista de precios ya armada para un evento puntual, desde la hoja "DATOS" de una de las
 * planillas de presupuesto (CARGA/PRESUPUESTO/PEDIDO/DATOS/DATOS_BASE — la misma plantilla que arma
 * cada presupuesto individual, reutilizada acá porque ahí adentro queda el precio final por código).
 *
 * A diferencia de la base parche (que trae el costo y acá se le vuelve a aplicar un porcentaje), esto
 * trae el PRECIO FINAL ya decidido por código: se usa tal cual, sin recalcular.
 */
const XLSX = require('xlsx');
const { normalizarCodigo } = require('./catalogoPreciosService');
const { abrirLibro, filaOculta, textoDeCelda, valorCrudo, errorDeArchivo } = require('./catalogoImportService');

const HOJA = 'DATOS';
const ENCABEZADOS_FIJOS = { codigo: 'COD', descripcion: 'DESCRIPCION', rubro: 'RUBRO' };
// La columna con el precio final cambia de nombre según el evento ("SAE MARZO", "SAE CIDEL"...),
// pero siempre empieza con "SAE": se ubica por eso, no por una letra de columna fija.
const PATRON_COLUMNA_PRECIO = /^SAE\b/i;

/**
 * @returns {{
 *   precios: Map<string, number|string|null>,  // clave = código normalizado; primera aparición gana
 *   columnaPrecio: string,                     // el encabezado real encontrado (ej. "SAE CIDEL")
 *   filas: Array<{fila, codigo, descripcion, rubro, precio}>,
 *   duplicados: Array<{codigo, filas}>, sinCodigo: number[], ocultas: number[], resumen: object
 * }}
 */
function leerListaDePrecios(origen) {
  const libro = abrirLibro(origen, { cellStyles: true });
  const hoja = libro.Sheets[HOJA];
  if (!hoja) {
    throw errorDeArchivo(`El archivo no tiene una hoja "${HOJA}". Hojas encontradas: ${libro.SheetNames.join(', ') || '(ninguna)'}.`);
  }
  if (!hoja['!ref']) throw errorDeArchivo(`La hoja "${HOJA}" está vacía.`);

  const rango = XLSX.utils.decode_range(hoja['!ref']);
  let filaEncabezado = null;
  const columnas = {};
  let columnaPrecio = null;
  for (let r = rango.s.r; r <= Math.min(rango.e.r, rango.s.r + 14) && filaEncabezado === null; r++) {
    const encontradas = {};
    let precioEncontrada = null;
    let ambiguo = false;
    for (let c = rango.s.c; c <= rango.e.c; c++) {
      const texto = textoDeCelda(hoja[XLSX.utils.encode_cell({ r, c })]).toUpperCase();
      if (!texto) continue;
      for (const [clave, nombre] of Object.entries(ENCABEZADOS_FIJOS)) {
        if (texto === nombre && encontradas[clave] === undefined) encontradas[clave] = c;
      }
      if (PATRON_COLUMNA_PRECIO.test(texto)) {
        if (precioEncontrada !== null) ambiguo = true;
        else precioEncontrada = { columna: c, texto: textoDeCelda(hoja[XLSX.utils.encode_cell({ r, c })]) };
      }
    }
    if (encontradas.codigo !== undefined && precioEncontrada !== null) {
      if (ambiguo) {
        throw errorDeArchivo(`En la hoja ${HOJA} hay más de una columna que empieza con "SAE" en la fila de encabezados: no sé cuál es el precio final. Dejá una sola.`);
      }
      filaEncabezado = r;
      Object.assign(columnas, encontradas);
      columnas.precio = precioEncontrada.columna;
      columnaPrecio = precioEncontrada.texto;
    }
  }
  if (filaEncabezado === null) {
    throw errorDeArchivo(`No encontré la columna "${ENCABEZADOS_FIJOS.codigo}" junto con una columna de precio que empiece con "SAE" (por ejemplo "SAE CIDEL") en la hoja ${HOJA}. ¿Cambiaron los encabezados?`);
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
    const precio = valorCrudo(celda(r, 'precio'));
    if (!codigo) {
      if (precio !== null) sinCodigo.push(fila);
      continue;
    }

    resumen.conCodigo++;
    if (precio === null) resumen.vacios++;
    else if (typeof precio === 'string') resumen.textos++;
    else if (precio === 0) resumen.ceros++;
    else resumen.numericos++;

    filas.push({ fila, codigo, descripcion: textoDeCelda(celda(r, 'descripcion')) || null, rubro: textoDeCelda(celda(r, 'rubro')) || null, precio });

    const clave = normalizarCodigo(codigo);
    if (!apariciones.has(clave)) apariciones.set(clave, []);
    apariciones.get(clave).push(fila);
    if (!precios.has(clave)) precios.set(clave, precio);
  }

  const duplicados = [];
  for (const [clave, listaFilas] of apariciones) {
    if (listaFilas.length > 1) duplicados.push({ codigo: clave, filas: listaFilas });
  }

  return { precios, columnaPrecio, filas, duplicados, sinCodigo, ocultas, resumen };
}

module.exports = { leerListaDePrecios };
