/**
 * Piezas comunes de los informes de facturación en PDF (el del año o mes y el de un evento): encabezados, el
 * recuadro con el total, las tablas (que se cortan entre hojas repitiendo el título), el pie con la numeración y
 * el envío al navegador. Usa los colores, fuentes y medidas de pdfComun, con el mismo estilo que el presupuesto.
 */
const PDFDocument = require('pdfkit');
const cotizaciones = require('./cotizacionesService');
const { formatearPesos } = require('./catalogoPdfService');
const { LOGO, A4, MARGEN_X, ANCHO, COLOR, NUM, NUM_NEGRITA, fechaCorta, registrarFuentes, escribir, alturaDe } = require('./pdfComun');

const LIMITE_INFERIOR = A4.alto - 66; // debajo de esto va el pie de página
const Y_PIE = A4.alto - 40;
const PAD = 8;
const ALTO_FILA = 20;
const ALTO_TITULO = 24;
const ALTO_ENCABEZADO = 22;

const MESES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];

const monto = (v) => `$ ${formatearPesos(v, false)}`;
const porcentaje = (parte, total) => (total > 0 ? `${((parte / total) * 100).toFixed(1).replace('.', ',')} %` : '—');

/** 737.35 → "737,35"; 1300.5 → "1.300,5" (formato argentino, sin depender del ICU). */
function unidades(valor) {
  const redondeado = Math.round(valor * 100) / 100;
  const [entero, decimales] = String(Math.abs(redondeado)).split('.');
  const miles = entero.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${redondeado < 0 ? '-' : ''}${miles}${decimales ? `,${decimales}` : ''}`;
}

function hoyLocal() {
  const d = new Date();
  const dos = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${dos(d.getMonth() + 1)}-${dos(d.getDate())}`;
}

/** Un documento A4 vacío, con las fuentes registradas, listo para `addPage`. */
function nuevoDocumento(titulo) {
  const doc = new PDFDocument({
    autoFirstPage: false,
    bufferPages: true,
    size: 'A4',
    margin: 0,
    info: { Title: titulo, Author: 'Departamento de SAE - Anselmi Industria Publicitaria', Creator: 'SAE-APP' },
  });
  registrarFuentes(doc);
  return doc;
}

/** El mayor tamaño de letra (entre `minimo` y `maximo`) con el que `texto` entra en `ancho`. */
function tamanoQueEntra(doc, texto, fuente, maximo, minimo, ancho) {
  let tamano = maximo;
  while (tamano > minimo && doc.font(fuente).fontSize(tamano).widthOfString(texto) > ancho) tamano -= 0.5;
  return tamano;
}

/** `texto` recortado con "…" para que entre en `ancho`. */
function recortar(doc, texto, fuente, tamano, ancho) {
  doc.font(fuente).fontSize(tamano);
  if (doc.widthOfString(texto) <= ancho) return texto;
  let corte = texto;
  while (corte.length > 1 && doc.widthOfString(`${corte}…`) > ancho) corte = corte.slice(0, -1);
  return `${corte.trimEnd()}…`;
}

// ---------------------------------------------------------------------------------------------
// Encabezados y resumen
// ---------------------------------------------------------------------------------------------

/** La primera hoja: logo, el título grande (se achica si es largo), el subtítulo y la fecha de emisión. */
function encabezadoCompleto(doc, { titulo, subtitulo }) {
  const ancho = ANCHO - 190;
  const tamano = tamanoQueEntra(doc, titulo, 'negrita', 27, 15, ancho);
  doc.image(LOGO, MARGEN_X, 34, { fit: [150, 46] });
  escribir(doc, recortar(doc, titulo, 'negrita', tamano, ancho), MARGEN_X + 190, 30 + (27 - tamano) * 0.75, { fuente: 'negrita', tamano, color: COLOR.primarioOscuro, width: ancho, align: 'right', lineBreak: false });
  escribir(doc, subtitulo, MARGEN_X + 190, 66, { tamano: 10, color: COLOR.suave, width: ancho, align: 'right', lineBreak: false });
  escribir(doc, `Emitido el ${fechaCorta(hoyLocal())}`, MARGEN_X + 190, 80, { tamano: 8.5, color: COLOR.suave, width: ancho, align: 'right', lineBreak: false });
  doc.save().lineWidth(2).strokeColor(COLOR.primario).moveTo(MARGEN_X, 100).lineTo(MARGEN_X + ANCHO, 100).stroke().restore();
  return 118;
}

/** Las hojas siguientes: el logo chico y una línea de título. */
function encabezadoCompacto(doc, texto) {
  const ancho = ANCHO - 200;
  doc.image(LOGO, MARGEN_X, 30, { fit: [92, 28] });
  escribir(doc, recortar(doc, texto, 'negrita', 11, ancho), MARGEN_X + 200, 36, { fuente: 'negrita', tamano: 11, color: COLOR.primarioOscuro, width: ancho, align: 'right', lineBreak: false });
  doc.save().lineWidth(1).strokeColor(COLOR.primario).moveTo(MARGEN_X, 66).lineTo(MARGEN_X + ANCHO, 66).stroke().restore();
  return 82;
}

/**
 * El recuadro con el total. `derecha` son dos líneas (la primera en negrita) y `notas` una lista de
 * { texto, aviso } debajo del recuadro; las de aviso van en color de advertencia. Devuelve la y de lo que sigue.
 */
function dibujarResumen(doc, y, { etiqueta, total, derecha, notas }) {
  const alto = 70;
  doc.save().roundedRect(MARGEN_X, y, ANCHO, alto, 6).fill(COLOR.tarjeta).restore();
  doc.save().roundedRect(MARGEN_X, y, 4, alto, 2).fill(COLOR.primario).restore();
  escribir(doc, etiqueta, MARGEN_X + 18, y + 13, { fuente: 'negrita', tamano: 8.5, color: COLOR.primarioOscuro, lineBreak: false, characterSpacing: 0.8 });
  escribir(doc, monto(total), MARGEN_X + 18, y + 31, { fuente: NUM_NEGRITA, tamano: 26, lineBreak: false });
  const xDerecha = MARGEN_X + ANCHO - 200;
  escribir(doc, derecha[0], xDerecha, y + 22, { fuente: 'negrita', tamano: 12, width: 184, align: 'right', lineBreak: false });
  escribir(doc, derecha[1], xDerecha, y + 40, { tamano: 10.5, color: COLOR.suave, width: 184, align: 'right', lineBreak: false });

  let siguiente = y + alto + 8;
  for (const nota of notas) {
    escribir(doc, nota.texto, MARGEN_X, siguiente, { tamano: 8.5, color: nota.aviso ? COLOR.aviso : COLOR.suave, width: ANCHO, lineBreak: false });
    siguiente += 12;
  }
  return siguiente + 10;
}

// ---------------------------------------------------------------------------------------------
// Tablas
// ---------------------------------------------------------------------------------------------

/**
 * Una celda es un texto, o { texto, nota } (el nombre de un evento con un aviso debajo), o { barra } (fracción
 * 0..1 que se dibuja como barra). Las columnas `num` van en Helvetica y las `ajusta` pueden ocupar varios renglones.
 */
function altoDeFila(doc, columnas, celdas) {
  let alto = ALTO_FILA;
  columnas.forEach((col, i) => {
    if (!col.ajusta) return;
    const celda = celdas[i];
    const texto = typeof celda === 'string' ? celda : celda.texto;
    const nota = typeof celda === 'string' ? '' : celda.nota;
    const altoTexto = alturaDe(doc, texto, col.ancho - 2 * PAD, { tamano: 9.5 }) + (nota ? alturaDe(doc, nota, col.ancho - 2 * PAD, { tamano: 8 }) + 1 : 0);
    alto = Math.max(alto, 11 + altoTexto);
  });
  return alto;
}

function dibujarFila(doc, columnas, celdas, y, alto, { par = false, negrita = false, total = false, tenue = false } = {}) {
  if (par) doc.save().rect(MARGEN_X, y, ANCHO, alto).fill(COLOR.filaPar).restore();
  if (total) doc.save().lineWidth(1.2).strokeColor(COLOR.primario).moveTo(MARGEN_X, y).lineTo(MARGEN_X + ANCHO, y).stroke().restore();
  else doc.save().lineWidth(0.5).strokeColor(COLOR.borde).moveTo(MARGEN_X, y + alto).lineTo(MARGEN_X + ANCHO, y + alto).stroke().restore();

  let x = MARGEN_X;
  columnas.forEach((col, i) => {
    const celda = celdas[i];
    const ancho = col.ancho - 2 * PAD;
    if (celda && typeof celda === 'object' && celda.barra !== undefined) {
      doc.save().roundedRect(x + PAD, y + (alto - 6) / 2, ancho, 6, 3).fill('#EFE7F1').restore();
      const lleno = Math.max(0, Math.min(1, celda.barra)) * ancho;
      if (lleno > 0.5) doc.save().roundedRect(x + PAD, y + (alto - 6) / 2, Math.max(lleno, 3), 6, 3).fill(COLOR.primario).restore();
    } else {
      const texto = typeof celda === 'string' ? celda : celda.texto;
      const nota = typeof celda === 'string' ? '' : celda.nota;
      const color = tenue ? COLOR.suave : COLOR.texto;
      const opciones = col.num
        ? { fuente: negrita ? NUM_NEGRITA : NUM, tamano: 9, color, width: ancho, align: col.alinear, lineBreak: false }
        : { fuente: negrita ? 'negrita' : 'cuerpo', tamano: 9.5, color, width: ancho, align: col.alinear, lineBreak: !!col.ajusta };
      const bajada = col.num ? 0.5 : 0;
      escribir(doc, texto, x + PAD, y + 5.5 + bajada, opciones);
      if (nota) escribir(doc, nota, x + PAD, y + 5.5 + alturaDe(doc, texto, ancho, { tamano: 9.5 }) + 1, { tamano: 8, color: COLOR.aviso, width: ancho });
    }
    x += col.ancho;
  });
}

function dibujarEncabezadoDeTabla(doc, columnas, y) {
  doc.save().roundedRect(MARGEN_X, y, ANCHO, ALTO_ENCABEZADO, 4).fill(COLOR.primarioOscuro).restore();
  let x = MARGEN_X;
  for (const col of columnas) {
    escribir(doc, col.titulo, x + PAD, y + 7, { fuente: 'negrita', tamano: 8, color: COLOR.blanco, width: col.ancho - 2 * PAD, align: col.alinear, lineBreak: false, characterSpacing: 0.4 });
    x += col.ancho;
  }
  return y + ALTO_ENCABEZADO;
}

function dibujarTituloDeSeccion(doc, titulo, y) {
  escribir(doc, recortar(doc, titulo, 'negrita', 8.5, ANCHO), MARGEN_X, y, { fuente: 'negrita', tamano: 8.5, color: COLOR.primarioOscuro, lineBreak: false, characterSpacing: 0.8 });
  doc.save().lineWidth(0.5).strokeColor(COLOR.borde).moveTo(MARGEN_X, y + 13).lineTo(MARGEN_X + ANCHO, y + 13).stroke().restore();
  return y + ALTO_TITULO;
}

const FILAS_PARA_CORTAR = 12; // una tabla de hasta tantas filas no se parte entre dos hojas
const FILAS_MINIMAS = 4; // una más larga se corta, pero no antes de dejar al menos estas filas en la hoja

/** `estado` es { doc, y, textoCompacto }: la y donde se sigue dibujando y el título de las hojas siguientes. */
function nuevaHoja(estado) {
  estado.doc.addPage({ size: 'A4', margin: 0 });
  estado.y = encabezadoCompacto(estado.doc, estado.textoCompacto);
}

const sumar = (lista) => lista.reduce((a, b) => a + b, 0);

/**
 * Dibuja una tabla con su título. Una tabla corta se mantiene entera en una sola hoja (pasa a la siguiente si no
 * entra); una larga se corta donde haga falta y en la hoja nueva se repite el título y el encabezado.
 */
function dibujarTabla(estado, { titulo, columnas, filas, pie }) {
  const { doc } = estado;
  const altos = filas.map((f) => altoDeFila(doc, columnas, f.celdas));
  const altoPie = pie ? ALTO_FILA + 2 : 0;

  const juntas = filas.length <= FILAS_PARA_CORTAR;
  const necesario = ALTO_TITULO + ALTO_ENCABEZADO + (juntas ? sumar(altos) + altoPie : sumar(altos.slice(0, FILAS_MINIMAS)));
  if (estado.y + necesario > LIMITE_INFERIOR) nuevaHoja(estado);

  const continuar = () => {
    nuevaHoja(estado);
    estado.y = dibujarTituloDeSeccion(doc, `${titulo} (continuación)`, estado.y);
    estado.y = dibujarEncabezadoDeTabla(doc, columnas, estado.y);
  };

  estado.y = dibujarTituloDeSeccion(doc, titulo, estado.y);
  estado.y = dibujarEncabezadoDeTabla(doc, columnas, estado.y);
  filas.forEach((fila, i) => {
    if (estado.y + altos[i] > LIMITE_INFERIOR) continuar();
    dibujarFila(doc, columnas, fila.celdas, estado.y, altos[i], { par: i % 2 === 1, tenue: fila.tenue });
    estado.y += altos[i];
  });
  if (pie) {
    if (estado.y + altoPie > LIMITE_INFERIOR) continuar();
    estado.y += 2;
    dibujarFila(doc, columnas, pie, estado.y, ALTO_FILA, { negrita: true, total: true });
    estado.y += ALTO_FILA;
  }
  estado.y += 18;
}

/**
 * Una sola tabla con varios grupos (por ejemplo, cada lote con lo que pidió): cada grupo tiene una fila de
 * cabecera (`encabezado`, sombreada y en negrita) y sus `filas`. Un grupo corto no se parte entre hojas; uno largo
 * se corta y en la hoja nueva repite su cabecera con "(cont.)". Cada hoja repite el título de la tabla.
 * `textoContinuacion(encabezado)` devuelve la cabecera de un grupo que sigue en la hoja siguiente.
 */
function dibujarTablaAgrupada(estado, { titulo, columnas, grupos, textoContinuacion }) {
  const { doc } = estado;
  const altoFilas = (grupo) => grupo.filas.map((f) => altoDeFila(doc, columnas, f));
  const altoCabecera = (celdas) => altoDeFila(doc, columnas, celdas);

  const continuar = () => {
    nuevaHoja(estado);
    estado.y = dibujarTituloDeSeccion(doc, `${titulo} (continuación)`, estado.y);
    estado.y = dibujarEncabezadoDeTabla(doc, columnas, estado.y);
  };

  const primero = grupos[0];
  if (primero) {
    const altos = altoFilas(primero);
    const necesario = ALTO_TITULO + ALTO_ENCABEZADO + altoCabecera(primero.encabezado) + sumar(altos.slice(0, FILAS_MINIMAS));
    if (estado.y + necesario > LIMITE_INFERIOR) nuevaHoja(estado);
  }
  estado.y = dibujarTituloDeSeccion(doc, titulo, estado.y);
  estado.y = dibujarEncabezadoDeTabla(doc, columnas, estado.y);

  for (const grupo of grupos) {
    const altos = altoFilas(grupo);
    let cabecera = grupo.encabezado;
    let altoCab = altoCabecera(cabecera);
    const juntas = grupo.filas.length <= FILAS_PARA_CORTAR;
    const necesario = altoCab + (juntas ? sumar(altos) : sumar(altos.slice(0, FILAS_MINIMAS)));
    if (estado.y + necesario > LIMITE_INFERIOR) continuar();

    dibujarFila(doc, columnas, cabecera, estado.y, altoCab, { par: true, negrita: true, total: true });
    estado.y += altoCab;
    grupo.filas.forEach((fila, i) => {
      if (estado.y + altos[i] > LIMITE_INFERIOR) {
        continuar();
        cabecera = textoContinuacion(grupo.encabezado);
        altoCab = altoCabecera(cabecera);
        dibujarFila(doc, columnas, cabecera, estado.y, altoCab, { par: true, negrita: true, total: true });
        estado.y += altoCab;
      }
      dibujarFila(doc, columnas, fila, estado.y, altos[i]);
      estado.y += altos[i];
    });
  }
  estado.y += 18;
}

// ---------------------------------------------------------------------------------------------
// Cierre y envío
// ---------------------------------------------------------------------------------------------

/** Pie de página con la firma del departamento y "Página x de y" en todas las hojas. */
function agregarPies(doc) {
  const { start, count } = doc.bufferedPageRange();
  for (let i = start; i < start + count; i++) {
    doc.switchToPage(i);
    doc.save().lineWidth(0.5).strokeColor(COLOR.borde).moveTo(MARGEN_X, Y_PIE - 8).lineTo(MARGEN_X + ANCHO, Y_PIE - 8).stroke().restore();
    escribir(doc, `${cotizaciones.TEXTOS.firma[0]}  ·  ${cotizaciones.TEXTOS.firma[1]}`, MARGEN_X, Y_PIE, { tamano: 8.5, color: COLOR.suave, width: ANCHO - 100, lineBreak: false });
    escribir(doc, `Página ${i - start + 1} de ${count}`, MARGEN_X + ANCHO - 100, Y_PIE, { tamano: 8.5, color: COLOR.suave, width: 100, align: 'right', lineBreak: false });
  }
}

function aBuffer(doc) {
  return new Promise((resolve, reject) => {
    const partes = [];
    doc.on('data', (d) => partes.push(d));
    doc.on('end', () => resolve(Buffer.concat(partes)));
    doc.on('error', reject);
    doc.end();
  });
}

/** Un nombre de archivo sin los caracteres que Windows no admite ni las comillas que romperían el header. */
function nombreSeguro(texto) {
  return String(texto).replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim();
}

/** Responde con el PDF para verlo e imprimirlo en el navegador (en una pestaña nueva). */
async function enviarPdf(res, doc, nombre) {
  const buffer = await aBuffer(doc);
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="${nombre.replace(/[^\x20-\x7e]/g, '_')}"; filename*=UTF-8''${encodeURIComponent(nombre)}`);
  res.setHeader('Content-Length', buffer.length);
  res.end(buffer);
}

module.exports = {
  MESES,
  monto,
  porcentaje,
  unidades,
  nuevoDocumento,
  encabezadoCompleto,
  dibujarResumen,
  dibujarTabla,
  dibujarTablaAgrupada,
  agregarPies,
  nombreSeguro,
  enviarPdf,
};
