/**
 * PDF del catálogo SAE con pdfkit (sin Chromium: la app tiene que instalarse sin internet).
 *
 * Replica la impresión de la hoja CATALOGO del Excel: las medidas de cada fila y columna son las
 * de las celdas (puntos a tamaño 100 %) y se multiplican por la escala de impresión del Excel
 * (66 %) sobre A4 vertical con márgenes de 0,25" y 0,75", centrado en horizontal y en vertical.
 * Las medidas se escalan a mano (no con doc.scale) para que pdfkit no corte páginas por su cuenta.
 */
const fs = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');
const { db } = require('../db/connection');
const { rutaDeImagen } = require('./catalogoImagenService');

const CARPETA_FUENTES = path.join(__dirname, '..', '..', 'assets', 'fonts');

const ESCALA = 0.66;
const A4 = { ancho: 595.28, alto: 841.89 };
const MARGEN = { horizontal: 18, vertical: 54 };

// Columnas B:F de la hoja (puntos): 243 px por columna de ítem, 75 px por separador.
const ANCHO_ITEM = 182.25;
const ANCHO_SEPARADOR = 56.25;
const ANCHO_HOJA = 3 * ANCHO_ITEM + 2 * ANCHO_SEPARADOR;
const X_COLUMNA = [0, ANCHO_ITEM + ANCHO_SEPARADOR, 2 * (ANCHO_ITEM + ANCHO_SEPARADOR)];

// Alto de cada fila de la hoja (puntos)
const ALTO = {
  logo: 103.5,
  portada: 972.4,
  espacioInicial: 18.75,
  titulo: 51.75,
  espacioTitulo: 46.5,
  etiqueta: 18.75,
  codigo: 18.75,
  foto: 227.25,
  ficha: 83.25,
  precio: 24.75,
  espacioBanda: 24,
  espacioPie: 24,
  pie: 60,
};
const ALTO_BANDA = ALTO.etiqueta + ALTO.codigo + ALTO.foto + ALTO.ficha + ALTO.precio;

const GROSOR = { fino: 0.75, medio: 1.5 };
const INSET = 1.5;
const INTERLINEADO = 1.22; // Calibri / Carlito: ascendente + descendente + separación de línea

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

function errorDePdf(mensaje, status) {
  const err = new Error(mensaje);
  err.status = status;
  return err;
}

/** "2026-09-15" → "15 de septiembre de 2026" */
function fechaLarga(iso) {
  const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  return `${Number(m[3])} de ${MESES[Number(m[2]) - 1]} de ${m[1]}`;
}

/** 40200 → "40.200,00" (o "40.200" sin decimales). Siempre en formato argentino, sin depender del ICU. */
function formatearPesos(valor, conDecimales = true) {
  const entero = Math.floor(Math.abs(valor));
  const centavos = Math.round((Math.abs(valor) - entero) * 100);
  const miles = String(entero).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return conDecimales ? `${miles},${String(centavos).padStart(2, '0')}` : miles;
}

function nombreDeArchivo(nombreVersion, fecha = new Date()) {
  const limpio = String(nombreVersion).replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim();
  return `CATALOGO SAE - ${limpio} - ${fecha.toISOString().slice(0, 10)}.pdf`;
}

/**
 * Parte las corridas de la ficha en líneas que entran en `ancho`. Respeta los saltos de línea del
 * texto, corta por palabras y admite tamaños y negritas mezclados en una misma línea.
 * @param corridas [{ t, b, sz }]
 * @param medir    (texto, negrita, tamaño) → ancho del texto
 * @returns [{ fragmentos: [{ t, b, sz }], tamano }]  (tamano = el mayor de la línea)
 */
function armarLineas(corridas, ancho, medir) {
  const lineas = [];
  let fragmentos = [];
  let usado = 0;
  let ultimoTamano = corridas.length > 0 ? corridas[0].sz : 11;

  const cerrarLinea = () => {
    const tamano = fragmentos.length > 0 ? Math.max(...fragmentos.map((f) => f.sz)) : ultimoTamano;
    lineas.push({ fragmentos, tamano });
    fragmentos = [];
    usado = 0;
  };
  const agregar = (t, corrida) => {
    const ultimo = fragmentos[fragmentos.length - 1];
    if (ultimo && ultimo.b === corrida.b && ultimo.sz === corrida.sz) ultimo.t += t;
    else fragmentos.push({ t, b: corrida.b, sz: corrida.sz });
  };

  for (const corrida of corridas) {
    ultimoTamano = corrida.sz;
    corrida.t.split('\n').forEach((parrafo, i) => {
      if (i > 0) cerrarLinea();
      for (const pieza of parrafo.split(/(\s+)/)) {
        if (pieza === '') continue;
        const espacio = /^\s+$/.test(pieza);
        const w = medir(pieza, corrida.b, corrida.sz);
        if (espacio && usado === 0) continue;
        if (!espacio && usado > 0 && usado + w > ancho) {
          const ultimo = fragmentos[fragmentos.length - 1];
          if (ultimo) ultimo.t = ultimo.t.replace(/\s+$/, '');
          cerrarLinea();
        }
        agregar(pieza, corrida);
        usado += w;
      }
    });
  }
  if (fragmentos.length > 0) cerrarLinea();
  return lineas;
}

function leerAjustesDePdf() {
  return Object.fromEntries(db.prepare('SELECT clave, valor FROM catalogo_ajustes').all().map((a) => [a.clave, a.valor]));
}

/** Todo lo que el PDF necesita, ya leído de la base. */
function cargarDatos(versionId) {
  const version = db.prepare('SELECT * FROM catalogo_versiones WHERE id = ?').get(versionId);
  if (!version) throw errorDePdf('Versión de catálogo no encontrada', 404);

  const conPrecios = db.prepare('SELECT COUNT(*) AS n FROM catalogo_version_precios WHERE version_id = ?').get(versionId).n;
  const totalItems = db.prepare('SELECT COUNT(*) AS n FROM catalogo_items').get().n;
  if (totalItems > 0 && conPrecios === 0) {
    throw errorDePdf(`La versión "${version.nombre}" todavía no tiene precios calculados. Recalculala antes de exportar.`, 409);
  }

  const ajustes = leerAjustesDePdf();
  const paginas = db.prepare('SELECT * FROM catalogo_paginas ORDER BY orden, id').all();
  const filas = db
    .prepare(
      `SELECT po.pagina_id, po.banda, po.columna, i.id AS item_id, i.codigo, i.descripcion, i.descripcion_catalogo,
              i.descripcion_formato, i.imagen, vp.sae, vp.estado_precio
         FROM catalogo_posiciones po
         JOIN catalogo_items i ON i.id = po.item_id AND i.activo = 1
         LEFT JOIN catalogo_version_precios vp ON vp.item_id = i.id AND vp.version_id = ?`
    )
    .all(versionId);

  const porPagina = new Map(paginas.map((p) => [p.id, { ...p, items: [] }]));
  for (const fila of filas) {
    const pagina = porPagina.get(fila.pagina_id);
    if (pagina) pagina.items.push(fila);
  }

  const plantilla = version.pie_legal || ajustes.pie_legal || '';
  return {
    version,
    paginas: [...porPagina.values()],
    pie: plantilla.replace('{fecha_vigencia}', fechaLarga(version.fecha_vigencia) || '—'),
    logo: ajustes.logo_imagen ? rutaDeImagen(ajustes.logo_imagen) : null,
    conDecimales: ajustes.mostrar_decimales !== '0',
  };
}

function registrarFuentes(doc) {
  const primera = (...nombres) => nombres.map((n) => path.join(CARPETA_FUENTES, n)).find((r) => fs.existsSync(r));
  const regular = primera('Carlito-Regular.ttf');
  const negrita = primera('Carlito-Bold.ttf');
  if (!regular || !negrita) throw errorDePdf('Faltan las fuentes del catálogo en server/assets/fonts (Carlito-Regular.ttf y Carlito-Bold.ttf).', 500);
  doc.registerFont('cuerpo', regular);
  doc.registerFont('cuerpo-negrita', negrita);
  // El Excel usa Aptos Narrow para etiquetas, precios y pie. No es una fuente libre: si se copia
  // AptosNarrow-Bold.ttf a assets/fonts se usa sola; si no, Carlito Bold.
  doc.registerFont('etiqueta-negrita', primera('AptosNarrow-Bold.ttf', 'Carlito-Bold.ttf'));
}

function corridasDe(item) {
  if (item.descripcion_formato) {
    try {
      const corridas = JSON.parse(item.descripcion_formato);
      if (Array.isArray(corridas) && corridas.length > 0) return corridas;
    } catch {
      // formato dañado: se cae al texto plano
    }
  }
  return [{ t: item.descripcion_catalogo || item.descripcion || '', b: true, sz: 14 }];
}

/**
 * Una hoja del Excel impresa: origen (x0, y0) en la página y todas las medidas en puntos de la hoja
 * (100 %), que se escalan al dibujar.
 */
class Hoja {
  constructor(doc, alto) {
    this.doc = doc;
    this.x0 = MARGEN.horizontal + (A4.ancho - 2 * MARGEN.horizontal - ANCHO_HOJA * ESCALA) / 2;
    this.y0 = MARGEN.vertical + (A4.alto - 2 * MARGEN.vertical - alto * ESCALA) / 2;
    doc.addPage({ size: 'A4', margin: 0 });
  }

  X(v) {
    return this.x0 + v * ESCALA;
  }

  Y(v) {
    return this.y0 + v * ESCALA;
  }

  linea(x1, y, x2, grosor) {
    this.doc.save().lineWidth(grosor * ESCALA).strokeColor('#000').moveTo(this.X(x1), this.Y(y)).lineTo(this.X(x2), this.Y(y)).stroke().restore();
  }

  imagen(ruta, x, y, ancho, alto, alineacion = 'center') {
    this.doc.image(ruta, this.X(x), this.Y(y), { fit: [ancho * ESCALA, alto * ESCALA], align: alineacion, valign: 'center' });
  }

  medir(texto, fuente, tamano) {
    return this.doc.font(fuente).fontSize(tamano * ESCALA).widthOfString(texto) / ESCALA;
  }

  /** Texto de una sola línea en una celda. Si no entra, achica el cuerpo antes que cortarlo. */
  texto(texto, x, y, ancho, alto, { fuente, tamano, alineacion = 'left' }) {
    let tam = tamano;
    while (tam > 8 && this.medir(texto, fuente, tam) > ancho - 2 * INSET) tam -= 0.5;
    const d = this.doc.font(fuente).fontSize(tam * ESCALA).fillColor('#000');
    const altoLinea = d.currentLineHeight(true) / ESCALA;
    d.text(texto, this.X(x + INSET), this.Y(y + (alto - altoLinea) / 2), { width: (ancho - 2 * INSET) * ESCALA, align: alineacion, lineBreak: false });
  }

  /** Texto en varias líneas centrado verticalmente (el pie legal). */
  parrafo(texto, x, y, ancho, alto, { fuente, tamano }) {
    const d = this.doc.font(fuente).fontSize(tamano * ESCALA).fillColor('#000');
    const w = (ancho - 2 * INSET) * ESCALA;
    const altoTexto = d.heightOfString(texto, { width: w }) / ESCALA;
    d.text(texto, this.X(x + INSET), this.Y(y + (alto - altoTexto) / 2), { width: w });
  }

  /** Ficha del ítem: texto enriquecido arriba a la izquierda, recortado a la celda como en Excel. */
  ficha(corridas, x, y, ancho, alto) {
    const d = this.doc;
    const lineas = armarLineas(corridas, ancho - 2 * INSET, (t, b, sz) => this.medir(t, b ? 'cuerpo-negrita' : 'cuerpo', sz));
    d.save();
    d.rect(this.X(x), this.Y(y), ancho * ESCALA, alto * ESCALA).clip();
    let yLinea = y;
    for (const linea of lineas) {
      const altoLinea = linea.tamano * INTERLINEADO;
      const ascendente = (fuente, tam) => (d.font(fuente).fontSize(tam * ESCALA)._font.ascender / 1000) * tam;
      const base = Math.max(...linea.fragmentos.map((f) => ascendente(f.b ? 'cuerpo-negrita' : 'cuerpo', f.sz)), 0);
      let xCursor = x + INSET;
      for (const f of linea.fragmentos) {
        const fuente = f.b ? 'cuerpo-negrita' : 'cuerpo';
        d.font(fuente).fontSize(f.sz * ESCALA).fillColor('#000');
        d.text(f.t, this.X(xCursor), this.Y(yLinea + (base - ascendente(fuente, f.sz))), { lineBreak: false });
        xCursor += this.medir(f.t, fuente, f.sz);
      }
      yLinea += altoLinea;
    }
    d.restore();
  }

  /** Precio: "$" pegado a la izquierda y el importe a la derecha, como el formato contable del Excel. */
  precio(item, x, y, conDecimales) {
    const d = this.doc.font('etiqueta-negrita').fontSize(18 * ESCALA).fillColor('#000');
    const relleno = d.widthOfString('-') / ESCALA;
    const yTexto = this.Y(y + (ALTO.precio - d.currentLineHeight(true) / ESCALA) / 2);
    const ancho = (ANCHO_ITEM - relleno) * ESCALA;
    if (typeof item.sae === 'number' && item.estado_precio === 'ok') {
      d.text('$', this.X(x + relleno), yTexto, { lineBreak: false });
      d.text(formatearPesos(item.sae, conDecimales), this.X(x), yTexto, { width: ancho, align: 'right', lineBreak: false });
    } else {
      d.text('S / P', this.X(x), yTexto, { width: ancho, align: 'right', lineBreak: false });
    }
  }
}

function dibujarItem(hoja, item, x, yBanda, datos, faltantes) {
  let y = yBanda;
  hoja.linea(x, y, x + ANCHO_ITEM, GROSOR.fino);
  hoja.texto('CODIGO:', x, y, ANCHO_ITEM, ALTO.etiqueta, { fuente: 'etiqueta-negrita', tamano: 14 });
  y += ALTO.etiqueta;
  hoja.texto(item.codigo, x, y, ANCHO_ITEM, ALTO.codigo, { fuente: 'cuerpo-negrita', tamano: 14 });
  y += ALTO.codigo;

  const rutaFoto = item.imagen ? rutaDeImagen(item.imagen) : null;
  if (rutaFoto && fs.existsSync(rutaFoto)) hoja.imagen(rutaFoto, x + 1, y + 1, ANCHO_ITEM - 2, ALTO.foto - 2);
  else if (item.imagen) faltantes.push(item.imagen);
  y += ALTO.foto;

  hoja.ficha(corridasDe(item), x, y, ANCHO_ITEM, ALTO.ficha);
  y += ALTO.ficha;

  hoja.precio(item, x, y, datos.conDecimales);
  hoja.linea(x, y + ALTO.precio, x + ANCHO_ITEM, GROSOR.medio);
}

function dibujarPortada(doc, datos) {
  const hoja = new Hoja(doc, ALTO.portada);
  if (datos.logo && fs.existsSync(datos.logo)) hoja.imagen(datos.logo, 0, 0, ANCHO_HOJA, ALTO.portada, 'center');
}

function dibujarPagina(doc, pagina, datos, faltantes) {
  // La página con "logo grande" va precedida de una portada y no repite el logo arriba.
  const conLogo = !pagina.logo_grande;
  const alto =
    (conLogo ? ALTO.logo : ALTO.espacioInicial) + ALTO.titulo + ALTO.espacioTitulo + 2 * ALTO_BANDA + ALTO.espacioBanda + ALTO.espacioPie + ALTO.pie;
  const hoja = new Hoja(doc, alto);

  let y = 0;
  if (conLogo) {
    if (datos.logo && fs.existsSync(datos.logo)) hoja.imagen(datos.logo, 0, y, ANCHO_HOJA, ALTO.logo, 'right');
    y += ALTO.logo;
  } else {
    y += ALTO.espacioInicial;
  }

  hoja.texto(pagina.titulo, 0, y, ANCHO_HOJA, ALTO.titulo, { fuente: 'cuerpo-negrita', tamano: 40 });
  hoja.linea(0, y + ALTO.titulo, ANCHO_HOJA, GROSOR.medio);
  y += ALTO.titulo + ALTO.espacioTitulo;

  for (const banda of [1, 2]) {
    for (const item of pagina.items.filter((i) => i.banda === banda)) {
      dibujarItem(hoja, item, X_COLUMNA[item.columna - 1], y, datos, faltantes);
    }
    y += ALTO_BANDA + (banda === 1 ? ALTO.espacioBanda : 0);
  }
  y += ALTO.espacioPie;

  hoja.parrafo(datos.pie, 0, y, ANCHO_HOJA, ALTO.pie, { fuente: 'etiqueta-negrita', tamano: 12 });
}

/**
 * Arma el PDF de una versión del catálogo. Devuelve el documento (todavía sin cerrar) y el nombre sugerido.
 * `faltantes` lista las imágenes que figuran en la base pero no están en disco (se imprime sin foto).
 */
function construirPdf(versionId) {
  const datos = cargarDatos(versionId);
  const doc = new PDFDocument({
    autoFirstPage: false,
    size: 'A4',
    margin: 0,
    info: { Title: `Catálogo SAE - ${datos.version.nombre}`, Creator: 'SAE-APP' },
  });
  registrarFuentes(doc);

  const faltantes = [];
  datos.paginas.forEach((pagina, i) => {
    if (i === 0 && pagina.logo_grande) dibujarPortada(doc, datos);
    dibujarPagina(doc, pagina, datos, faltantes);
  });
  if (datos.paginas.length === 0) {
    doc.addPage({ size: 'A4', margin: 0 });
    doc.font('cuerpo').fontSize(12).text('El catálogo todavía no tiene páginas cargadas.', 72, 72);
  }
  return { doc, nombreArchivo: nombreDeArchivo(datos.version.nombre), faltantes };
}

function streamPdf(res, versionId) {
  const { doc, nombreArchivo, faltantes } = construirPdf(versionId);
  if (faltantes.length > 0) console.warn(`Catálogo PDF: ${faltantes.length} imágenes no están en disco (${faltantes.slice(0, 3).join(', ')}...)`);
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${nombreArchivo.replace(/[^\x20-\x7e]/g, '_')}"; filename*=UTF-8''${encodeURIComponent(nombreArchivo)}`);
  doc.pipe(res);
  doc.end();
}

module.exports = { construirPdf, streamPdf, armarLineas, formatearPesos, fechaLarga, nombreDeArchivo, cargarDatos, ESCALA };
