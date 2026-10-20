/**
 * Informe de facturación de un evento (sin IVA), en PDF A4 vertical con el mismo estilo que el del año: el total, los
 * totales por rubro y, según la vista que se pida, el detalle de cada rubro por producto ('rubro') o lo que pidió
 * cada lote ('lote'). Los presupuestos cancelados no cuentan (ver eventosService.informeFacturacionEvento).
 */
const { MARGEN_X, ANCHO, COLOR, fechaCorta, escribir } = require('./pdfComun');
const { monto, porcentaje, unidades, nuevoDocumento, encabezadoCompleto, dibujarResumen, dibujarTabla, dibujarTablaAgrupada, agregarPies, nombreSeguro, enviarPdf } = require('./informePdfComun');

const VISTAS = ['rubro', 'lote'];

function nombreDeArchivo(informe, vista) {
  const nombre = nombreSeguro(informe.evento.nombre) || `Evento ${informe.evento.id}`;
  return `Facturación ${nombre}${vista === 'lote' ? ' por lote' : ''}.pdf`;
}

const avisoSinPrecio = (n) => `Falta precio en ${n} línea(s)`;
const conAviso = (texto, lineasSinPrecio) => (lineasSinPrecio > 0 ? { texto, nota: avisoSinPrecio(lineasSinPrecio) } : texto);
/** La cabecera de un lote que sigue en la hoja siguiente: el mismo texto con "(cont.)". */
const conContinuacion = (celda) => (typeof celda === 'string' ? `${celda} (cont.)` : { ...celda, texto: `${celda.texto} (cont.)` });

/** Los rubros del que más factura al que menos (el orden de los totales); el detalle va en orden alfabético. */
const rubrosPorImporte = (informe) => [...informe.porRubro].sort((a, b) => b.total - a.total || a.rubro.localeCompare(b.rubro, 'es'));

function dibujarDetallePorRubro(estado, informe) {
  for (const grupo of informe.porRubro) {
    dibujarTabla(estado, {
      titulo: `DETALLE: ${grupo.rubro.toUpperCase()}`,
      columnas: [
        { titulo: 'PRODUCTO', ancho: 261.28, alinear: 'left', ajusta: true },
        { titulo: 'CÓDIGO', ancho: 90, alinear: 'left' },
        { titulo: 'CANT.', ancho: 70, alinear: 'right', num: true },
        { titulo: 'SUBTOTAL', ancho: 90, alinear: 'right', num: true },
      ],
      filas: grupo.productos.map((p) => ({ celdas: [conAviso(p.nombre, p.lineasSinPrecio), p.codigo || '—', unidades(p.cantidad), monto(p.subtotal)] })),
      pie: [`Total ${grupo.rubro}`, '', unidades(grupo.cantidad), monto(grupo.total)],
    });
  }
}

function dibujarPorLote(estado, informe) {
  dibujarTabla(estado, {
    titulo: 'RESUMEN POR LOTE',
    columnas: [
      { titulo: 'LOTE', ancho: 70, alinear: 'left' },
      { titulo: 'EXPOSITOR', ancho: 195, alinear: 'left', ajusta: true },
      { titulo: 'PRESUP.', ancho: 56, alinear: 'right', num: true },
      { titulo: 'FACTURACIÓN', ancho: 100, alinear: 'right', num: true },
      { titulo: '% DEL EVENTO', ancho: 90.28, alinear: 'right', num: true },
    ],
    filas: informe.porLote.map((l) => ({ celdas: [l.codigo, conAviso(l.expositor || '—', l.lineasSinPrecio), String(l.presupuestos), monto(l.total), porcentaje(l.total, informe.total)] })),
    pie: ['Total', '', String(informe.presupuestos), monto(informe.total), ''],
  });

  const cabecera = (l) => [conAviso(`Lote ${l.codigo}${l.expositor ? ` — ${l.expositor}` : ''}`, l.lineasSinPrecio), l.presupuestos > 1 ? `${l.presupuestos} presupuestos` : '', '', monto(l.total)];
  dibujarTablaAgrupada(estado, {
    titulo: 'PEDIDOS POR LOTE',
    columnas: [
      { titulo: 'PRODUCTO', ancho: 281.28, alinear: 'left', ajusta: true },
      { titulo: 'CÓDIGO', ancho: 90, alinear: 'left' },
      { titulo: 'CANT.', ancho: 60, alinear: 'right', num: true },
      { titulo: 'SUBTOTAL', ancho: 80, alinear: 'right', num: true },
    ],
    grupos: informe.porLote.map((l) => ({
      encabezado: cabecera(l),
      filas: l.productos.length
        ? l.productos.map((p) => [conAviso(p.nombre, p.lineasSinPrecio), p.codigo || '—', unidades(p.cantidad), monto(p.subtotal)])
        : [['Todavía no tiene ítems cargados', '', '', '']],
    })),
    textoContinuacion: (enc) => [conContinuacion(enc[0]), enc[1], enc[2], enc[3]],
  });
}

function construirPdf(informe, vista = 'rubro') {
  const { evento } = informe;
  const doc = nuevoDocumento(`Facturación ${evento.nombre}`);

  doc.addPage({ size: 'A4', margin: 0 });
  const estado = { doc, y: 0, textoCompacto: `INFORME DE FACTURACIÓN  ·  ${evento.nombre.toUpperCase()}` };
  const fechas = evento.fecha_inicio ? `Del ${fechaCorta(evento.fecha_inicio)} al ${fechaCorta(evento.fecha_fin || evento.fecha_inicio)}` : 'Sin fecha cargada';
  const notas = [{ texto: `${fechas}${evento.lugar ? `  ·  ${evento.lugar}` : ''}` }, { texto: 'Con todos sus presupuestos (no se incluyen los cancelados).' }];
  if (informe.lineasSinPrecio > 0) notas.push({ texto: `Atención: ${informe.lineasSinPrecio} línea(s) sin precio cargado no están incluidas en el total.`, aviso: true });
  estado.y = dibujarResumen(
    doc,
    encabezadoCompleto(doc, {
      titulo: evento.nombre.toUpperCase(),
      subtitulo: vista === 'lote' ? 'Facturación por rubro y pedidos por lote · importes sin IVA' : 'Informe de facturación del evento · importes sin IVA',
    }),
    {
      etiqueta: 'FACTURACIÓN DEL EVENTO (SIN IVA)',
      total: informe.total,
      derecha: [`${informe.lotes} ${informe.lotes === 1 ? 'lote' : 'lotes'}`, `${informe.presupuestos} ${informe.presupuestos === 1 ? 'presupuesto' : 'presupuestos'}`],
      notas,
    }
  );

  if (informe.presupuestos === 0) {
    escribir(doc, 'Este evento todavía no tiene presupuestos cargados.', MARGEN_X, estado.y, { tamano: 10.5, color: COLOR.suave, width: ANCHO, lineBreak: false });
  } else {
    dibujarTabla(estado, {
      titulo: 'TOTALES POR RUBRO',
      columnas: [
        { titulo: 'RUBRO', ancho: 210, alinear: 'left', ajusta: true },
        { titulo: 'UNIDADES', ancho: 90, alinear: 'right', num: true },
        { titulo: 'FACTURACIÓN', ancho: 120, alinear: 'right', num: true },
        { titulo: '% DEL EVENTO', ancho: 91.28, alinear: 'right', num: true },
      ],
      filas: rubrosPorImporte(informe).map((g) => ({ celdas: [conAviso(g.rubro, g.lineasSinPrecio), unidades(g.cantidad), monto(g.total), porcentaje(g.total, informe.total)] })),
      pie: ['Total del evento', '', monto(informe.total), ''],
    });
    if (vista === 'lote') dibujarPorLote(estado, informe);
    else dibujarDetallePorRubro(estado, informe);
  }

  agregarPies(doc);
  return doc;
}

/** Responde con el PDF para verlo e imprimirlo en el navegador (en una pestaña nueva). */
async function streamPdf(res, informe, vista = 'rubro') {
  await enviarPdf(res, construirPdf(informe, vista), nombreDeArchivo(informe, vista));
}

module.exports = { VISTAS, construirPdf, streamPdf, nombreDeArchivo };
