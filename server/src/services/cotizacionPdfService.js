/**
 * PDF de un presupuesto cargado desde la app, con pdfkit (sin Chromium: la app se instala sin internet).
 * A4 vertical. Encabezado con el logo, tarjetas con los datos del cliente y del stand, tabla de ítems
 * (el encabezado se repite en cada página), recuadro de totales con IVA discriminado, condiciones y
 * pie con numeración "Página x de y".
 */
const fs = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');
const { PDFDocument: PdfLibDocument, StandardFonts, rgb } = require('pdf-lib');
const { errorHttp } = require('./catalogoCalculoService');
const { formatearPesos, fechaLarga } = require('./catalogoPdfService');
const cotizaciones = require('./cotizacionesService');
const adjuntosService = require('./cotizacionAdjuntosService');
const croquisService = require('./croquisService');
const croquisPdf = require('./croquisPdf');

const CARPETA_ASSETS = path.join(__dirname, '..', '..', 'assets');
const LOGO = path.join(CARPETA_ASSETS, 'anselmi-logo.jpg');

const A4 = { ancho: 595.28, alto: 841.89 };
const MARGEN_X = 42;
const ANCHO = A4.ancho - 2 * MARGEN_X;
const LIMITE_INFERIOR = A4.alto - 66; // debajo de esto va el pie de página
const Y_PIE = A4.alto - 40;

const COLOR = {
  primario: '#A671AA',
  primarioOscuro: '#8B5892',
  texto: '#1F2430',
  suave: '#6B7280',
  borde: '#E0DAE3',
  filaPar: '#F8F4F9',
  tarjeta: '#F8F4F9',
  aviso: '#B45309',
  blanco: '#FFFFFF',
};

// Columnas de la tabla de ítems (suman ANCHO)
const COLUMNAS = [
  { clave: 'codigo', titulo: 'CÓDIGO', ancho: 76, alinear: 'left' },
  { clave: 'descripcion', titulo: 'DESCRIPCIÓN', ancho: 205, alinear: 'left' },
  { clave: 'cantidad', titulo: 'CANT.', ancho: 46, alinear: 'center' },
  { clave: 'unitario', titulo: 'VALOR UNIT.', ancho: 92, alinear: 'right' },
  { clave: 'total', titulo: 'TOTAL', ancho: 92, alinear: 'right' },
];
const PAD = 8;

// Los números (importes, cantidades, códigos, fechas, identificadores) van en Helvetica, que viene
// incluida en el PDF: sus cifras son más limpias y del mismo ancho, así las columnas quedan alineadas.
const NUM = 'Helvetica';
const NUM_NEGRITA = 'Helvetica-Bold';

const pesos = (v) => `$ ${formatearPesos(v)}`;

/** "2026-02-07" → "07/02/2026" */
function fechaCorta(iso) {
  const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : '—';
}

function nombreDeArchivo(c) {
  const base = c.cod_fac ? `Presupuesto ${c.cod_fac}` : `Presupuesto ${c.id}`;
  const limpio = [base, c.evento_nombre].filter(Boolean).join(' - ').replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim();
  return `${limpio}.pdf`;
}

function registrarFuentes(doc) {
  const regular = path.join(CARPETA_ASSETS, 'fonts', 'Carlito-Regular.ttf');
  const negrita = path.join(CARPETA_ASSETS, 'fonts', 'Carlito-Bold.ttf');
  if (!fs.existsSync(regular) || !fs.existsSync(negrita)) throw errorHttp(500, 'Faltan las fuentes en server/assets/fonts (Carlito-Regular.ttf y Carlito-Bold.ttf).');
  doc.registerFont('cuerpo', regular);
  doc.registerFont('negrita', negrita);
}

function escribir(doc, texto, x, y, { fuente = 'cuerpo', tamano = 9.5, color = COLOR.texto, ...opciones } = {}) {
  doc.font(fuente).fontSize(tamano).fillColor(color).text(texto, x, y, opciones);
}

/** Distancia del borde superior del texto a su línea base (cada fuente tiene la suya). */
function ascenso(doc, fuente, tamano) {
  doc.font(fuente).fontSize(tamano);
  return (doc._font.ascender * tamano) / 1000;
}

/** Cuánto hay que bajar un texto en `fuente` para que su base coincida con la de otro en `fuenteRef`. */
function alinearBase(doc, fuente, tamano, fuenteRef = 'cuerpo', tamanoRef = 9.5) {
  return ascenso(doc, fuenteRef, tamanoRef) - ascenso(doc, fuente, tamano);
}

function alturaDe(doc, texto, ancho, { fuente = 'cuerpo', tamano = 9.5 } = {}) {
  if (!texto) return 0;
  return doc.font(fuente).fontSize(tamano).heightOfString(texto, { width: ancho });
}

// ---------------------------------------------------------------------------------------------
// Encabezados
// ---------------------------------------------------------------------------------------------

function encabezadoCompleto(doc, c) {
  doc.image(LOGO, MARGEN_X, 34, { fit: [150, 46] });

  escribir(doc, 'PRESUPUESTO', MARGEN_X + 230, 30, { fuente: 'negrita', tamano: 27, color: COLOR.primarioOscuro, width: ANCHO - 230, align: 'right', lineBreak: false });

  // Datos del presupuesto, a la derecha
  const filas = [
    ['N.º de presupuesto', c.numero ? String(c.numero) : '—'],
    ['Fecha', fechaCorta(c.fecha_carga)],
    ['Válido hasta', fechaCorta(c.fecha_vencimiento)],
    ['Cód. de facturación', c.cod_fac || '—'],
  ];
  const xMeta = MARGEN_X + ANCHO - 210;
  let y = 68;
  for (const [etiqueta, valor] of filas) {
    escribir(doc, etiqueta, xMeta, y + 1.5, { tamano: 8.5, color: COLOR.suave, width: 110, lineBreak: false });
    escribir(doc, valor, xMeta + 90, y + 1.5 + alinearBase(doc, NUM_NEGRITA, 9, 'cuerpo', 8.5), { fuente: NUM_NEGRITA, tamano: 9, width: 120, align: 'right', lineBreak: false });
    y += 14;
  }

  // "Preparado para", a la izquierda debajo del logo
  const destinatario = c.razon_social || c.nombre_stand || c.evento_nombre || 'Sin cliente asignado';
  escribir(doc, 'PREPARADO PARA', MARGEN_X, 92, { fuente: 'negrita', tamano: 7.5, color: COLOR.suave, lineBreak: false, characterSpacing: 0.8 });
  // Un nombre largo baja de letra y ocupa dos renglones en vez de cortarse
  const tamanoDestinatario = alturaDe(doc, destinatario, 270, { fuente: 'negrita', tamano: 13 }) > 18 ? 11 : 13;
  escribir(doc, destinatario, MARGEN_X, 104, { fuente: 'negrita', tamano: tamanoDestinatario, width: 270, height: 28, ellipsis: true });

  doc.save().lineWidth(2).strokeColor(COLOR.primario).moveTo(MARGEN_X, 132).lineTo(MARGEN_X + ANCHO, 132).stroke().restore();
  return 148;
}

function encabezadoCompacto(doc, c) {
  doc.image(LOGO, MARGEN_X, 30, { fit: [92, 28] });
  const referencia = c.cod_fac ? `PRESUPUESTO  ·  ${c.cod_fac}` : 'PRESUPUESTO';
  escribir(doc, referencia, MARGEN_X + 200, 36, { fuente: 'negrita', tamano: 11, color: COLOR.primarioOscuro, width: ANCHO - 200, align: 'right', lineBreak: false });
  doc.save().lineWidth(1).strokeColor(COLOR.primario).moveTo(MARGEN_X, 66).lineTo(MARGEN_X + ANCHO, 66).stroke().restore();
  return 82;
}

// ---------------------------------------------------------------------------------------------
// Tarjetas de datos
// ---------------------------------------------------------------------------------------------

function tarjeta(doc, x, y, ancho, titulo, filas, altoFijo) {
  const relleno = 12;
  const anchoEtiqueta = 66;
  const anchoValor = ancho - 2 * relleno - anchoEtiqueta;
  doc.save().roundedRect(x, y, ancho, altoFijo, 6).fill(COLOR.tarjeta).restore();
  doc.save().roundedRect(x, y, 4, altoFijo, 2).fill(COLOR.primario).restore();
  escribir(doc, titulo, x + relleno + 4, y + 10, { fuente: 'negrita', tamano: 8.5, color: COLOR.primarioOscuro, lineBreak: false, characterSpacing: 0.8 });
  let cursor = y + 28;
  if (filas.length === 0) {
    escribir(doc, 'Sin datos cargados.', x + relleno + 4, cursor, { tamano: 9, color: COLOR.suave, lineBreak: false });
    return;
  }
  for (const [etiqueta, valor, numerico] of filas) {
    const estilo = numerico ? { fuente: NUM, tamano: 9 } : { tamano: 9.5 };
    const alto = alturaDe(doc, valor, anchoValor - 4, estilo);
    escribir(doc, etiqueta, x + relleno + 4, cursor + 1, { tamano: 8.5, color: COLOR.suave, width: anchoEtiqueta - 4, lineBreak: false });
    escribir(doc, valor, x + relleno + anchoEtiqueta, cursor + (numerico ? alinearBase(doc, NUM, 9) : 0), { ...estilo, width: anchoValor - 4 });
    cursor += alto + 4;
  }
}

function altoDeTarjeta(doc, ancho, filas) {
  if (filas.length === 0) return 52;
  const anchoValor = ancho - 24 - 66 - 4;
  return 28 + filas.reduce((suma, [, valor, numerico]) => suma + alturaDe(doc, valor, anchoValor, numerico ? { fuente: NUM, tamano: 9 } : { tamano: 9.5 }) + 4, 0) + 8;
}

function dibujarTarjetas(doc, c, y) {
  const separacion = 14;
  const ancho = (ANCHO - separacion) / 2;
  const con = (filas) => filas.filter(([, valor]) => valor !== null && valor !== undefined && String(valor).trim() !== '');
  // El tercer valor marca los datos numéricos / identificadores, que se escriben con la fuente de los números
  const cliente = con([
    ['Razón social', c.razon_social],
    ['CUIT', c.cuit, true],
    ['Dirección', c.direccion],
    ['Contacto', c.contacto],
    ['Mail', c.mail],
    ['Teléfono', c.telefono, true],
  ]);
  const evento = con([
    ['Expo', c.evento_nombre],
    ['Tipo', c.tipo],
    ['Stand', c.nombre_stand],
    ['N.º de stand', c.lote, true],
    ['Responsable', c.responsable],
    ['ID de cliente', c.id_cliente, true],
  ]);
  const alto = Math.max(altoDeTarjeta(doc, ancho, cliente), altoDeTarjeta(doc, ancho, evento));
  tarjeta(doc, MARGEN_X, y, ancho, 'CLIENTE', cliente, alto);
  tarjeta(doc, MARGEN_X + ancho + separacion, y, ancho, 'EVENTO Y STAND', evento, alto);
  return y + alto;
}

// ---------------------------------------------------------------------------------------------
// Tabla de ítems
// ---------------------------------------------------------------------------------------------

function encabezadoDeTabla(doc, y) {
  doc.save().roundedRect(MARGEN_X, y, ANCHO, 22, 4).fill(COLOR.primarioOscuro).restore();
  let x = MARGEN_X;
  for (const col of COLUMNAS) {
    escribir(doc, col.titulo, x + PAD, y + 7, { fuente: 'negrita', tamano: 8, color: COLOR.blanco, width: col.ancho - 2 * PAD, align: col.alinear, lineBreak: false, characterSpacing: 0.4 });
    x += col.ancho;
  }
  return y + 22;
}

function alturaDeFila(doc, l) {
  const desc = alturaDe(doc, l.descripcion, COLUMNAS[1].ancho - 2 * PAD, { tamano: 9.5 });
  const nota = l.comentario ? alturaDe(doc, l.comentario, COLUMNAS[1].ancho - 2 * PAD, { tamano: 8.5 }) + 2 : 0;
  const codigo = alturaDe(doc, l.codigo, COLUMNAS[0].ancho - 2 * PAD, { fuente: NUM_NEGRITA, tamano: 8.5 });
  return Math.max(24, 12 + Math.max(desc + nota, codigo));
}

function dibujarFila(doc, l, y, par) {
  const alto = alturaDeFila(doc, l);
  if (par) doc.save().rect(MARGEN_X, y, ANCHO, alto).fill(COLOR.filaPar).restore();
  doc.save().lineWidth(0.5).strokeColor(COLOR.borde).moveTo(MARGEN_X, y + alto).lineTo(MARGEN_X + ANCHO, y + alto).stroke().restore();

  let x = MARGEN_X;
  // Los números bajan un poco para que su línea base coincida con la de la descripción
  const celda = (texto, col, opciones = {}) => {
    const bajada = opciones.fuente ? alinearBase(doc, opciones.fuente, opciones.tamano) : 0;
    escribir(doc, texto, x + PAD, y + 6 + bajada, { width: col.ancho - 2 * PAD, align: col.alinear, ...opciones });
  };
  celda(l.codigo, COLUMNAS[0], { fuente: NUM_NEGRITA, tamano: 8.5 });
  x += COLUMNAS[0].ancho;
  celda(l.descripcion, COLUMNAS[1]);
  if (l.comentario) {
    const desc = alturaDe(doc, l.descripcion, COLUMNAS[1].ancho - 2 * PAD, { tamano: 9.5 });
    escribir(doc, l.comentario, x + PAD, y + 6 + desc + 2, { tamano: 8.5, color: COLOR.suave, width: COLUMNAS[1].ancho - 2 * PAD });
  }
  x += COLUMNAS[1].ancho;
  celda(String(l.cantidad), COLUMNAS[2], { fuente: NUM, tamano: 9, lineBreak: false });
  x += COLUMNAS[2].ancho;
  const sinPrecio = l.precio_unitario === null || l.precio_unitario === undefined;
  celda(sinPrecio ? 'Sin precio' : pesos(l.precio_unitario), COLUMNAS[3], sinPrecio ? { color: COLOR.aviso, lineBreak: false } : { fuente: NUM, tamano: 9, lineBreak: false });
  x += COLUMNAS[3].ancho;
  celda(sinPrecio ? '—' : pesos(l.subtotal), COLUMNAS[4], { fuente: NUM_NEGRITA, tamano: 9, lineBreak: false });
  return alto;
}

// ---------------------------------------------------------------------------------------------
// Documento
// ---------------------------------------------------------------------------------------------

/** El croquis dibujado en la app, o null si no hay, está vacío o se eligió que no salga en el PDF. */
function croquisParaElPdf(id) {
  const croquis = croquisService.obtenerDeCotizacion(id);
  if (!croquis || !croquis.incluir_en_pdf) return null;
  const hayDibujo = croquis.paredes.length + croquis.materiales.length + croquis.cotas.length > 0;
  return hayDibujo ? croquis : null;
}

function construirPdf(id) {
  const c = cotizaciones.obtener(id);
  // Croquis y planos adjuntos: salen como anexos al final (los que ya no están en el disco se omiten)
  const anexos = adjuntosService.paraElPdf(id).filter((a) => a.ruta && fs.existsSync(a.ruta));
  const paginasAnexas = adjuntosService.paginasQueOcupan(anexos);
  const doc = new PDFDocument({
    autoFirstPage: false,
    bufferPages: true,
    size: 'A4',
    margin: 0,
    info: { Title: `Presupuesto ${c.cod_fac || c.id}`, Author: 'Departamento de SAE - Anselmi Industria Publicitaria', Creator: 'SAE-APP' },
  });
  registrarFuentes(doc);

  doc.addPage({ size: 'A4', margin: 0 });
  let y = dibujarTarjetas(doc, c, encabezadoCompleto(doc, c)) + 24;

  const paginaNueva = () => {
    doc.addPage({ size: 'A4', margin: 0 });
    return encabezadoCompacto(doc, c);
  };
  const asegurar = (alto) => {
    if (y + alto > LIMITE_INFERIOR) y = paginaNueva();
  };

  // Tabla
  escribir(doc, 'DETALLE DEL PEDIDO', MARGEN_X, y, { fuente: 'negrita', tamano: 8.5, color: COLOR.primarioOscuro, lineBreak: false, characterSpacing: 0.8 });
  y += 15;
  y = encabezadoDeTabla(doc, y);
  if (c.lineas.length === 0) {
    escribir(doc, 'Todavía no se cargaron ítems.', MARGEN_X + PAD, y + 8, { tamano: 9.5, color: COLOR.suave, lineBreak: false });
    y += 30;
  }
  c.lineas.forEach((linea, i) => {
    const alto = alturaDeFila(doc, linea);
    if (y + alto > LIMITE_INFERIOR) {
      y = encabezadoDeTabla(doc, paginaNueva());
    }
    y += dibujarFila(doc, linea, y, i % 2 === 1);
  });
  y += 16;

  // Totales
  const anchoTotales = 236;
  const xTotales = MARGEN_X + ANCHO - anchoTotales;
  const fila = (etiqueta, valor, yFila) => {
    escribir(doc, etiqueta, xTotales + 12, yFila, { tamano: 10, color: COLOR.suave, lineBreak: false });
    escribir(doc, valor, xTotales, yFila + alinearBase(doc, NUM_NEGRITA, 9.5, 'cuerpo', 10), { fuente: NUM_NEGRITA, tamano: 9.5, width: anchoTotales - 12, align: 'right', lineBreak: false });
  };
  const filasTotales = [];
  if (c.totales.descuento > 0) {
    filasTotales.push(['Subtotal', pesos(c.totales.subtotal_bruto)]);
    filasTotales.push([`Descuento ${String(Math.round(c.totales.descuento_porcentaje * 10000) / 100).replace('.', ',')} %`, `-${pesos(c.totales.descuento)}`]);
    filasTotales.push(['Subtotal con descuento', pesos(c.totales.subtotal)]);
  } else {
    filasTotales.push(['Subtotal', pesos(c.totales.subtotal)]);
  }
  filasTotales.push([`IVA ${String(Math.round(c.totales.iva_porcentaje * 10000) / 100).replace('.', ',')} %`, pesos(c.totales.iva)]);
  const altoFilas = filasTotales.length * 18;
  asegurar(96 + (altoFilas - 36));
  filasTotales.forEach(([etiqueta, valor], i) => fila(etiqueta, valor, y + i * 18));
  const ySep = y + altoFilas + 1;
  doc.save().lineWidth(0.5).strokeColor(COLOR.borde).moveTo(xTotales, ySep).lineTo(xTotales + anchoTotales, ySep).stroke().restore();
  doc.save().roundedRect(xTotales, ySep + 7, anchoTotales, 34, 6).fill(COLOR.primarioOscuro).restore();
  escribir(doc, 'TOTAL', xTotales + 14, ySep + 18, { fuente: 'negrita', tamano: 11, color: COLOR.blanco, lineBreak: false, characterSpacing: 0.8 });
  escribir(doc, pesos(c.totales.total), xTotales, ySep + 18 + alinearBase(doc, NUM_NEGRITA, 14, 'negrita', 11), { fuente: NUM_NEGRITA, tamano: 14, color: COLOR.blanco, width: anchoTotales - 14, align: 'right', lineBreak: false });

  // Aclaraciones a la izquierda del total
  const notaIzquierda = ['Importes expresados en pesos argentinos.', 'Los valores unitarios no incluyen IVA.'];
  if (c.totales.lineas_sin_precio > 0) notaIzquierda.push(`Atención: ${c.totales.lineas_sin_precio} ítem(s) sin precio no están incluidos en el total.`);
  escribir(doc, notaIzquierda.join('\n'), MARGEN_X, y + 2, { tamano: 8.5, color: COLOR.suave, width: ANCHO - anchoTotales - 24 });
  y = ySep + 7 + 34 + 26;

  // Condiciones
  const parrafos = parrafosDeCondiciones(c, anexos);
  const anchoTexto = ANCHO;
  const altoCondiciones = 20 + parrafos.reduce((suma, p) => suma + alturaDe(doc, p.texto, anchoTexto, { fuente: p.negrita ? 'negrita' : 'cuerpo', tamano: 8.8 }) + 6, 0);
  asegurar(altoCondiciones);
  escribir(doc, 'CONDICIONES', MARGEN_X, y, { fuente: 'negrita', tamano: 8.5, color: COLOR.primarioOscuro, lineBreak: false, characterSpacing: 0.8 });
  doc.save().lineWidth(0.5).strokeColor(COLOR.borde).moveTo(MARGEN_X, y + 13).lineTo(MARGEN_X + ANCHO, y + 13).stroke().restore();
  y += 20;
  for (const p of parrafos) {
    const opciones = { fuente: p.negrita ? 'negrita' : 'cuerpo', tamano: 8.8, color: p.negrita ? COLOR.texto : COLOR.suave, width: anchoTexto };
    escribir(doc, p.texto, MARGEN_X, y, opciones);
    y += alturaDe(doc, p.texto, anchoTexto, opciones) + 6;
  }

  // Croquis dibujado en la app, si el presupuesto tiene uno y se eligió que salga
  const croquis = croquisParaElPdf(id);
  if (croquis) {
    const plan = croquisPdf.preparar(doc, croquis, new Map(croquis.materiales.filter((m) => m.catalogo_item_id !== null).map((m) => [m.catalogo_item_id, m.codigo])), ANCHO);
    y += 14;
    const ALTO_TITULO = 20;
    let escala = croquisPdf.escalaParaEspacio(plan, LIMITE_INFERIOR - y - ALTO_TITULO);
    if (escala === null) {
      y = paginaNueva();
      escala = plan.escalaIdeal;
    }
    escribir(doc, 'CROQUIS DEL STAND', MARGEN_X, y, { fuente: 'negrita', tamano: 8.5, color: COLOR.primarioOscuro, lineBreak: false, characterSpacing: 0.8 });
    doc.save().lineWidth(0.5).strokeColor(COLOR.borde).moveTo(MARGEN_X, y + 13).lineTo(MARGEN_X + ANCHO, y + 13).stroke().restore();
    y += ALTO_TITULO;
    y += croquisPdf.dibujar(doc, plan, { x: MARGEN_X, y, espacio: LIMITE_INFERIOR - y, escala });
  }

  // Pie de página con numeración
  const { start, count } = doc.bufferedPageRange();
  for (let i = start; i < start + count; i++) {
    doc.switchToPage(i);
    doc.save().lineWidth(0.5).strokeColor(COLOR.borde).moveTo(MARGEN_X, Y_PIE - 8).lineTo(MARGEN_X + ANCHO, Y_PIE - 8).stroke().restore();
    escribir(doc, `${cotizaciones.TEXTOS.firma[0]}  ·  ${cotizaciones.TEXTOS.firma[1]}`, MARGEN_X, Y_PIE, { tamano: 8.5, color: COLOR.suave, width: ANCHO - 100, lineBreak: false });
    escribir(doc, `Página ${i - start + 1} de ${count + paginasAnexas}`, MARGEN_X + ANCHO - 100, Y_PIE, { tamano: 8.5, color: COLOR.suave, width: 100, align: 'right', lineBreak: false });
  }

  return { doc, nombreArchivo: nombreDeArchivo(c), anexos, paginasPresupuesto: count, totalPaginas: count + paginasAnexas, cotizacion: c };
}

/** Párrafos de condiciones: los textos fijos del Excel, la vigencia y las observaciones del presupuesto. */
function tituloDeAnexo(a) {
  return a.titulo || a.nombre_original.replace(/\.[^./\\]+$/, '');
}

function parrafosDeCondiciones(c, anexos = []) {
  const parrafos = [
    { texto: `Este presupuesto tiene validez hasta el ${fechaLarga(c.fecha_vencimiento)}.`, negrita: true },
    { texto: cotizaciones.TEXTOS.alquiler },
    { texto: cotizaciones.TEXTOS.pago },
  ];
  if (c.notas) parrafos.push({ texto: `Observaciones: ${c.notas}` });
  if (anexos.length > 0) {
    const lista = anexos.map((a, i) => `${i + 1}) ${tituloDeAnexo(a)}`).join('; ');
    parrafos.push({ texto: `Se adjuntan al final de este documento: ${lista}.` });
  }
  return parrafos;
}

// ---------------------------------------------------------------------------------------------
// Anexos (croquis y planos adjuntos)
// ---------------------------------------------------------------------------------------------

const hexARgb = (hex) => {
  const n = parseInt(hex.slice(1), 16);
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
};

/** Las fuentes estándar del PDF sólo escriben Latin-1: lo demás (emojis, etc.) se reemplaza por "?". */
const soloLatin1 = (texto) =>
  Array.from(String(texto))
    .map((c) => {
      const n = c.codePointAt(0);
      return (n >= 32 && n <= 126) || (n >= 160 && n <= 255) ? c : '?';
    })
    .join('');

/** Recorta el texto con "…" para que entre en `ancho`. */
function ajustarAlAncho(texto, fuente, tamano, ancho) {
  let salida = soloLatin1(texto);
  if (fuente.widthOfTextAtSize(salida, tamano) <= ancho) return salida;
  while (salida.length > 1 && fuente.widthOfTextAtSize(`${salida}...`, tamano) > ancho) salida = salida.slice(0, -1);
  return `${salida}...`;
}

/** Una página con la imagen (apaisada si la imagen lo es), título arriba y pie con la numeración. */
async function paginaDeImagen(salida, fuentes, anexo, { numeroAnexo, numeroPagina, totalPaginas, referencia }) {
  const bytes = fs.readFileSync(anexo.ruta);
  const imagen = anexo.ruta.endsWith('.png') ? await salida.embedPng(bytes) : await salida.embedJpg(bytes);
  const apaisada = imagen.width > imagen.height;
  const [ancho, alto] = apaisada ? [A4.alto, A4.ancho] : [A4.ancho, A4.alto];
  const pagina = salida.addPage([ancho, alto]);
  const margen = MARGEN_X;
  const anchoUtil = ancho - 2 * margen;

  pagina.drawText(`ANEXO ${numeroAnexo}`, { x: margen, y: alto - 40, size: 8, font: fuentes.negrita, color: hexARgb(COLOR.primarioOscuro) });
  pagina.drawText(ajustarAlAncho(tituloDeAnexo(anexo), fuentes.negrita, 14, anchoUtil * 0.7), { x: margen, y: alto - 58, size: 14, font: fuentes.negrita, color: hexARgb(COLOR.texto) });
  if (referencia) {
    const texto = ajustarAlAncho(referencia, fuentes.normal, 9, anchoUtil * 0.3);
    pagina.drawText(texto, { x: ancho - margen - fuentes.normal.widthOfTextAtSize(texto, 9), y: alto - 58, size: 9, font: fuentes.normal, color: hexARgb(COLOR.suave) });
  }
  pagina.drawLine({ start: { x: margen, y: alto - 68 }, end: { x: ancho - margen, y: alto - 68 }, thickness: 1.5, color: hexARgb(COLOR.primario) });

  // Imagen centrada en el área libre entre el título y el pie
  const areaAlto = alto - 68 - 16 - 62;
  const escala = Math.min(anchoUtil / imagen.width, areaAlto / imagen.height);
  const w = imagen.width * escala;
  const h = imagen.height * escala;
  pagina.drawImage(imagen, { x: margen + (anchoUtil - w) / 2, y: 62 + (areaAlto - h) / 2, width: w, height: h });

  pagina.drawLine({ start: { x: margen, y: 46 }, end: { x: ancho - margen, y: 46 }, thickness: 0.5, color: hexARgb(COLOR.borde) });
  pagina.drawText(soloLatin1(`${cotizaciones.TEXTOS.firma[0]}  ·  ${cotizaciones.TEXTOS.firma[1]}`), { x: margen, y: 32, size: 8.5, font: fuentes.normal, color: hexARgb(COLOR.suave) });
  const numeracion = `Página ${numeroPagina} de ${totalPaginas}`;
  pagina.drawText(numeracion, { x: ancho - margen - fuentes.normal.widthOfTextAtSize(numeracion, 8.5), y: 32, size: 8.5, font: fuentes.normal, color: hexARgb(COLOR.suave) });
}

/** Agrega al final del presupuesto los anexos, en el orden en que se cargaron. */
async function unirAnexos(buffer, anexos, { paginasPresupuesto, totalPaginas, referencia }) {
  const salida = await PdfLibDocument.load(buffer);
  const fuentes = { normal: await salida.embedFont(StandardFonts.Helvetica), negrita: await salida.embedFont(StandardFonts.HelveticaBold) };
  let numeroPagina = paginasPresupuesto;
  for (const [i, anexo] of anexos.entries()) {
    try {
      if (anexo.tipo === 'pdf') {
        const origen = await PdfLibDocument.load(fs.readFileSync(anexo.ruta));
        const paginas = await salida.copyPages(origen, origen.getPageIndices());
        paginas.forEach((p) => salida.addPage(p));
        numeroPagina += paginas.length;
      } else {
        numeroPagina += 1;
        await paginaDeImagen(salida, fuentes, anexo, { numeroAnexo: i + 1, numeroPagina, totalPaginas, referencia });
      }
    } catch (err) {
      console.warn(`Presupuesto: no se pudo agregar el anexo "${anexo.nombre_original}" (${err.message})`);
    }
  }
  return Buffer.from(await salida.save());
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

/** El PDF completo: el presupuesto y, a continuación, sus anexos. */
async function generarPdf(id) {
  const { doc, nombreArchivo, anexos, paginasPresupuesto, totalPaginas, cotizacion } = construirPdf(id);
  const buffer = await aBuffer(doc);
  if (anexos.length === 0) return { buffer, nombreArchivo };
  const referencia = cotizacion.cod_fac ? `Presupuesto ${cotizacion.cod_fac}` : 'Presupuesto';
  return { buffer: await unirAnexos(buffer, anexos, { paginasPresupuesto, totalPaginas, referencia }), nombreArchivo };
}

async function streamPdf(res, id, { enLinea = false } = {}) {
  const { buffer, nombreArchivo } = await generarPdf(id);
  res.setHeader('Content-Type', 'application/pdf');
  const disposicion = enLinea ? 'inline' : 'attachment';
  res.setHeader('Content-Disposition', `${disposicion}; filename="${nombreArchivo.replace(/[^\x20-\x7e]/g, '_')}"; filename*=UTF-8''${encodeURIComponent(nombreArchivo)}`);
  res.setHeader('Content-Length', buffer.length);
  res.end(buffer);
}

module.exports = { construirPdf, generarPdf, streamPdf, nombreDeArchivo, fechaCorta };
