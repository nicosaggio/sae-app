/**
 * Piezas comunes de los PDF "de diseño" de la app (el presupuesto y los informes): página A4, colores de la
 * marca, tipografías (Carlito para el texto y Helvetica para las cifras) y utilidades para escribir texto.
 */
const fs = require('fs');
const path = require('path');
const { errorHttp } = require('./catalogoCalculoService');
const { formatearPesos } = require('./catalogoPdfService');

const CARPETA_ASSETS = path.join(__dirname, '..', '..', 'assets');
const LOGO = path.join(CARPETA_ASSETS, 'anselmi-logo.jpg');

const A4 = { ancho: 595.28, alto: 841.89 };
const MARGEN_X = 42;
const ANCHO = A4.ancho - 2 * MARGEN_X;

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

module.exports = {
  CARPETA_ASSETS,
  LOGO,
  A4,
  MARGEN_X,
  ANCHO,
  COLOR,
  NUM,
  NUM_NEGRITA,
  pesos,
  fechaCorta,
  registrarFuentes,
  escribir,
  ascenso,
  alinearBase,
  alturaDe,
};
