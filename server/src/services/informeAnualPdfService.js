/**
 * Informe de facturación de todo un año (sin IVA), en PDF A4 vertical con el mismo estilo que el presupuesto:
 * el total del año, y cómo se reparte por mes, por rubro y por evento. Los presupuestos cancelados no cuentan
 * (ver eventosService.facturacionAnual). No lleva el desglose por estado de cobro: los estados de los
 * presupuestos viejos no están al día y esa información no sería correcta.
 */
const PDFDocument = require('pdfkit');
const eventosService = require('./eventosService');
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

function nombreDeArchivo(anio) {
  return `Facturación ${anio}.pdf`;
}

// ---------------------------------------------------------------------------------------------
// Encabezados y resumen
// ---------------------------------------------------------------------------------------------

function encabezadoCompleto(doc, anio) {
  doc.image(LOGO, MARGEN_X, 34, { fit: [150, 46] });
  escribir(doc, `FACTURACIÓN ${anio}`, MARGEN_X + 190, 30, { fuente: 'negrita', tamano: 27, color: COLOR.primarioOscuro, width: ANCHO - 190, align: 'right', lineBreak: false });
  escribir(doc, 'Informe anual · importes sin IVA', MARGEN_X + 190, 66, { tamano: 10, color: COLOR.suave, width: ANCHO - 190, align: 'right', lineBreak: false });
  escribir(doc, `Emitido el ${fechaCorta(hoyLocal())}`, MARGEN_X + 190, 80, { tamano: 8.5, color: COLOR.suave, width: ANCHO - 190, align: 'right', lineBreak: false });
  doc.save().lineWidth(2).strokeColor(COLOR.primario).moveTo(MARGEN_X, 100).lineTo(MARGEN_X + ANCHO, 100).stroke().restore();
  return 118;
}

function encabezadoCompacto(doc, anio) {
  doc.image(LOGO, MARGEN_X, 30, { fit: [92, 28] });
  escribir(doc, `INFORME DE FACTURACIÓN  ·  ${anio}`, MARGEN_X + 200, 36, { fuente: 'negrita', tamano: 11, color: COLOR.primarioOscuro, width: ANCHO - 200, align: 'right', lineBreak: false });
  doc.save().lineWidth(1).strokeColor(COLOR.primario).moveTo(MARGEN_X, 66).lineTo(MARGEN_X + ANCHO, 66).stroke().restore();
  return 82;
}

/** El recuadro con el total del año. Devuelve la y de lo que sigue. */
function dibujarResumen(doc, datos, y) {
  const alto = 70;
  doc.save().roundedRect(MARGEN_X, y, ANCHO, alto, 6).fill(COLOR.tarjeta).restore();
  doc.save().roundedRect(MARGEN_X, y, 4, alto, 2).fill(COLOR.primario).restore();
  escribir(doc, 'FACTURACIÓN DEL AÑO (SIN IVA)', MARGEN_X + 18, y + 13, { fuente: 'negrita', tamano: 8.5, color: COLOR.primarioOscuro, lineBreak: false, characterSpacing: 0.8 });
  escribir(doc, monto(datos.total), MARGEN_X + 18, y + 31, { fuente: NUM_NEGRITA, tamano: 26, lineBreak: false });
  const xDerecha = MARGEN_X + ANCHO - 200;
  escribir(doc, `${datos.eventos} ${datos.eventos === 1 ? 'evento' : 'eventos'}`, xDerecha, y + 22, { fuente: 'negrita', tamano: 12, width: 184, align: 'right', lineBreak: false });
  escribir(doc, `${datos.presupuestos} ${datos.presupuestos === 1 ? 'presupuesto' : 'presupuestos'}`, xDerecha, y + 40, { tamano: 10.5, color: COLOR.suave, width: 184, align: 'right', lineBreak: false });

  let siguiente = y + alto + 8;
  const notas = [`Eventos que empiezan en ${datos.anio}, con todos sus presupuestos (no se incluyen los cancelados).`];
  if (datos.lineasSinPrecio > 0) notas.push(`Atención: ${datos.lineasSinPrecio} línea(s) sin precio cargado no están incluidas en el total.`);
  notas.forEach((nota, i) => {
    escribir(doc, nota, MARGEN_X, siguiente, { tamano: 8.5, color: i === 0 ? COLOR.suave : COLOR.aviso, width: ANCHO, lineBreak: false });
    siguiente += 12;
  });
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
  escribir(doc, titulo, MARGEN_X, y, { fuente: 'negrita', tamano: 8.5, color: COLOR.primarioOscuro, lineBreak: false, characterSpacing: 0.8 });
  doc.save().lineWidth(0.5).strokeColor(COLOR.borde).moveTo(MARGEN_X, y + 13).lineTo(MARGEN_X + ANCHO, y + 13).stroke().restore();
  return y + ALTO_TITULO;
}

const FILAS_PARA_CORTAR = 12; // una tabla de hasta tantas filas no se parte entre dos hojas
const FILAS_MINIMAS = 4; // una más larga se corta, pero no antes de dejar al menos estas filas en la hoja

/**
 * Dibuja una tabla con su título. Una tabla corta se mantiene entera en una sola hoja (pasa a la siguiente si no
 * entra); una larga se corta donde haga falta y en la hoja nueva se repite el título y el encabezado.
 */
function dibujarTabla(estado, { titulo, columnas, filas, pie }) {
  const { doc, anio } = estado;
  const altos = filas.map((f) => altoDeFila(doc, columnas, f.celdas));
  const altoPie = pie ? ALTO_FILA + 2 : 0;
  const nuevaHoja = () => {
    doc.addPage({ size: 'A4', margin: 0 });
    estado.y = encabezadoCompacto(doc, anio);
  };

  const sumar = (lista) => lista.reduce((a, b) => a + b, 0);
  const juntas = filas.length <= FILAS_PARA_CORTAR;
  const necesario = ALTO_TITULO + ALTO_ENCABEZADO + (juntas ? sumar(altos) + altoPie : sumar(altos.slice(0, FILAS_MINIMAS)));
  if (estado.y + necesario > LIMITE_INFERIOR) nuevaHoja();

  const continuar = () => {
    nuevaHoja();
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

// ---------------------------------------------------------------------------------------------
// Documento
// ---------------------------------------------------------------------------------------------

function construirPdf(anio) {
  const datos = eventosService.facturacionAnual(anio);
  const doc = new PDFDocument({
    autoFirstPage: false,
    bufferPages: true,
    size: 'A4',
    margin: 0,
    info: { Title: `Facturación ${anio}`, Author: 'Departamento de SAE - Anselmi Industria Publicitaria', Creator: 'SAE-APP' },
  });
  registrarFuentes(doc);

  doc.addPage({ size: 'A4', margin: 0 });
  const estado = { doc, anio: datos.anio, y: 0 };
  estado.y = dibujarResumen(doc, datos, encabezadoCompleto(doc, datos.anio));

  if (datos.presupuestos === 0) {
    escribir(doc, `No hay presupuestos cargados en eventos de ${datos.anio}.`, MARGEN_X, estado.y, { tamano: 10.5, color: COLOR.suave, width: ANCHO, lineBreak: false });
  } else {
    const mayorMes = Math.max(0, ...datos.porMes.map((m) => m.total));
    dibujarTabla(estado, {
      titulo: 'POR MES  (según el mes en que empieza cada evento)',
      columnas: [
        { titulo: 'MES', ancho: 120, alinear: 'left' },
        { titulo: 'EVENTOS', ancho: 62, alinear: 'right', num: true },
        { titulo: 'FACTURACIÓN', ancho: 112, alinear: 'right', num: true },
        { titulo: '% DEL AÑO', ancho: 70, alinear: 'right', num: true },
        { titulo: '', ancho: 147.28, alinear: 'left' },
      ],
      filas: datos.porMes.map((m) => ({
        tenue: m.eventos === 0,
        celdas: [MESES[m.mes - 1], m.eventos ? String(m.eventos) : '—', m.eventos ? monto(m.total) : '—', m.eventos ? porcentaje(m.total, datos.total) : '—', { barra: mayorMes > 0 ? m.total / mayorMes : 0 }],
      })),
      pie: [`Total ${datos.anio}`, String(datos.eventos), monto(datos.total), '', ''],
    });

    dibujarTabla(estado, {
      titulo: 'POR RUBRO',
      columnas: [
        { titulo: 'RUBRO', ancho: 210, alinear: 'left' },
        { titulo: 'UNIDADES', ancho: 90, alinear: 'right', num: true },
        { titulo: 'FACTURACIÓN', ancho: 120, alinear: 'right', num: true },
        { titulo: '% DEL AÑO', ancho: 91.28, alinear: 'right', num: true },
      ],
      filas: datos.porRubro.map((g) => ({ celdas: [g.rubro, unidades(g.cantidad), monto(g.total), porcentaje(g.total, datos.total)] })),
    });

    dibujarTabla(estado, {
      titulo: 'POR EVENTO',
      columnas: [
        { titulo: 'EVENTO', ancho: 215, alinear: 'left', ajusta: true },
        { titulo: 'INICIO', ancho: 66, alinear: 'center', num: true },
        { titulo: 'PRESUP.', ancho: 56, alinear: 'right', num: true },
        { titulo: 'FACTURACIÓN', ancho: 100, alinear: 'right', num: true },
        { titulo: '% DEL AÑO', ancho: 74.28, alinear: 'right', num: true },
      ],
      filas: datos.porEvento.map((e) => ({
        celdas: [
          e.lineasSinPrecio > 0 ? { texto: e.nombre, nota: `Falta precio en ${e.lineasSinPrecio} línea(s)` } : e.nombre,
          fechaCorta(e.fecha_inicio),
          String(e.presupuestos),
          monto(e.total),
          porcentaje(e.total, datos.total),
        ],
      })),
      pie: [`Total ${datos.anio}`, '', String(datos.presupuestos), monto(datos.total), ''],
    });
  }

  // Pie de página con numeración
  const { start, count } = doc.bufferedPageRange();
  for (let i = start; i < start + count; i++) {
    doc.switchToPage(i);
    doc.save().lineWidth(0.5).strokeColor(COLOR.borde).moveTo(MARGEN_X, Y_PIE - 8).lineTo(MARGEN_X + ANCHO, Y_PIE - 8).stroke().restore();
    escribir(doc, `${cotizaciones.TEXTOS.firma[0]}  ·  ${cotizaciones.TEXTOS.firma[1]}`, MARGEN_X, Y_PIE, { tamano: 8.5, color: COLOR.suave, width: ANCHO - 100, lineBreak: false });
    escribir(doc, `Página ${i - start + 1} de ${count}`, MARGEN_X + ANCHO - 100, Y_PIE, { tamano: 8.5, color: COLOR.suave, width: 100, align: 'right', lineBreak: false });
  }
  return doc;
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

/** Responde con el PDF para verlo e imprimirlo en el navegador (en una pestaña nueva). */
async function streamPdf(res, anio) {
  const buffer = await aBuffer(construirPdf(anio));
  const nombre = nombreDeArchivo(anio);
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="${nombre.replace(/[^\x20-\x7e]/g, '_')}"; filename*=UTF-8''${encodeURIComponent(nombre)}`);
  res.setHeader('Content-Length', buffer.length);
  res.end(buffer);
}

module.exports = { construirPdf, streamPdf, nombreDeArchivo };
