/**
 * Informe de facturación de todo un año, o de un mes de ese año (sin IVA), en PDF A4 vertical con el mismo
 * estilo que el presupuesto: el total, y cómo se reparte por mes (sólo el del año), por rubro y por evento.
 * Los presupuestos cancelados no cuentan (ver eventosService.facturacionAnual). No lleva el desglose por estado
 * de cobro: los estados de los presupuestos viejos no están al día y esa información no sería correcta.
 */
const eventosService = require('./eventosService');
const { MARGEN_X, ANCHO, COLOR, fechaCorta, escribir } = require('./pdfComun');
const { MESES, monto, porcentaje, unidades, nuevoDocumento, encabezadoCompleto, dibujarResumen, dibujarTabla, agregarPies, enviarPdf } = require('./informePdfComun');

function nombreDeArchivo(anio, mes) {
  return mes ? `Facturación ${MESES[mes - 1]} ${anio}.pdf` : `Facturación ${anio}.pdf`;
}

function construirPdf(anio, { mes } = {}) {
  const datos = eventosService.facturacionAnual(anio, { mes });
  const periodo = datos.mes ? `${MESES[datos.mes - 1]} ${datos.anio}` : String(datos.anio);
  const doc = nuevoDocumento(`Facturación ${periodo}`);

  doc.addPage({ size: 'A4', margin: 0 });
  const estado = { doc, y: 0, textoCompacto: `INFORME DE FACTURACIÓN  ·  ${periodo.toUpperCase()}` };
  const notas = [{ texto: `Eventos que empiezan en ${datos.mes ? `${MESES[datos.mes - 1]} de ${datos.anio}` : datos.anio}, con todos sus presupuestos (no se incluyen los cancelados).` }];
  if (datos.lineasSinPrecio > 0) notas.push({ texto: `Atención: ${datos.lineasSinPrecio} línea(s) sin precio cargado no están incluidas en el total.`, aviso: true });
  estado.y = dibujarResumen(
    doc,
    encabezadoCompleto(doc, {
      titulo: datos.mes ? periodo.toUpperCase() : `FACTURACIÓN ${datos.anio}`,
      subtitulo: datos.mes ? 'Informe mensual · importes sin IVA' : 'Informe anual · importes sin IVA',
    }),
    {
      etiqueta: datos.mes ? `FACTURACIÓN DE ${periodo.toUpperCase()} (SIN IVA)` : 'FACTURACIÓN DEL AÑO (SIN IVA)',
      total: datos.total,
      derecha: [`${datos.eventos} ${datos.eventos === 1 ? 'evento' : 'eventos'}`, `${datos.presupuestos} ${datos.presupuestos === 1 ? 'presupuesto' : 'presupuestos'}`],
      notas,
    }
  );

  if (datos.presupuestos === 0) {
    const donde = datos.mes ? `${MESES[datos.mes - 1]} de ${datos.anio}` : datos.anio;
    escribir(doc, `No hay presupuestos cargados en eventos de ${donde}.`, MARGEN_X, estado.y, { tamano: 10.5, color: COLOR.suave, width: ANCHO, lineBreak: false });
  } else {
    const parteDe = datos.mes ? 'MES' : 'AÑO';
    if (!datos.mes) {
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
    }

    dibujarTabla(estado, {
      titulo: 'POR RUBRO',
      columnas: [
        { titulo: 'RUBRO', ancho: 210, alinear: 'left' },
        { titulo: 'UNIDADES', ancho: 90, alinear: 'right', num: true },
        { titulo: 'FACTURACIÓN', ancho: 120, alinear: 'right', num: true },
        { titulo: `% DEL ${parteDe}`, ancho: 91.28, alinear: 'right', num: true },
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
        { titulo: `% DEL ${parteDe}`, ancho: 74.28, alinear: 'right', num: true },
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
      pie: [`Total ${periodo}`, '', String(datos.presupuestos), monto(datos.total), ''],
    });
  }

  agregarPies(doc);
  return doc;
}

/** Responde con el PDF para verlo e imprimirlo en el navegador (en una pestaña nueva). */
async function streamPdf(res, anio, { mes } = {}) {
  await enviarPdf(res, construirPdf(anio, { mes }), nombreDeArchivo(anio, mes));
}

module.exports = { construirPdf, streamPdf, nombreDeArchivo };
