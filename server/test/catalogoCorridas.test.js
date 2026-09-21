const test = require('node:test');
const assert = require('node:assert/strict');
const { parsearCorridas, extraerCorridas } = require('../src/services/catalogoExcelService');

const MEDIDAS = '<rPr><sz val="11"/><rFont val="Calibri"/><family val="2"/></rPr>';
const NEGRITA = (sz) => `<rPr><b/><sz val="${sz}"/><rFont val="Calibri"/><family val="2"/></rPr>`;

test('título con la fuente de la celda (Calibri 14 negrita) y medidas en Calibri 11 normal', () => {
  const si = `<r><t xml:space="preserve">MOSTRADOR CIEGO BLANCO\r\n</t></r><r>${MEDIDAS}<t>Ancho: 1 m\r\nAlto: 1 m\r\nProd.: 0,50m</t></r>`;
  assert.deepEqual(parsearCorridas(si), [
    { t: 'MOSTRADOR CIEGO BLANCO\n', b: true, sz: 14 },
    { t: 'Ancho: 1 m\nAlto: 1 m\nProd.: 0,50m', b: false, sz: 11 },
  ]);
});

test('corridas contiguas con el mismo formato se unen', () => {
  const si = `<r><t>PUFF SIMPLE\r\n</t></r><r>${NEGRITA(14)}<t>NEGRO</t></r><r>${MEDIDAS}<t>\r\nAncho: 0.40m</t></r>`;
  assert.deepEqual(parsearCorridas(si), [
    { t: 'PUFF SIMPLE\nNEGRO', b: true, sz: 14 },
    { t: '\nAncho: 0.40m', b: false, sz: 11 },
  ]);
});

test('tamaños mezclados (13, 14, 12, 10) se conservan tal cual', () => {
  const si = `<r>${NEGRITA(13)}<t>ESTANTERIA CON GUARDADO</t></r><r>${NEGRITA(14)}<t>\r\n(con cenefa)\r\n</t></r><r><rPr><sz val="10"/></rPr><t>Ancho: 1 m</t></r>`;
  assert.deepEqual(parsearCorridas(si).map((c) => [c.b, c.sz]), [[true, 13], [true, 14], [false, 10]]);
});

test('texto simple (sin corridas) usa la fuente de la celda', () => {
  assert.deepEqual(parsearCorridas('<t>PIEZA LISA</t>'), [{ t: 'PIEZA LISA', b: true, sz: 14 }]);
});

test('entidades XML y saltos raros se decodifican; los espacios del final se recortan; sin sz usa 11', () => {
  const si = `<r><t>TABLA &amp; SILLA &lt;2&gt;_x000D_\n</t></r><r><rPr><rFont val="Calibri"/></rPr><t>Alto: 1 m   </t></r>`;
  assert.deepEqual(parsearCorridas(si), [
    { t: 'TABLA & SILLA <2>\n', b: true, sz: 14 },
    { t: 'Alto: 1 m', b: false, sz: 11 },
  ]);
});

test('extraerCorridas relaciona cada celda de texto compartido con sus corridas', () => {
  const hoja = '<sheetData><row><c r="B25" s="22" t="s"><v>1</v></c><c r="D25" s="22" t="s"><v>0</v></c><c r="F25" s="22"><v>3</v></c></row></sheetData>';
  const compartidos = `<sst><si><t>Solo texto</t></si><si><r><t>UNO\n</t></r><r>${MEDIDAS}<t>detalle</t></r></si></sst>`;
  const mapa = extraerCorridas(hoja, compartidos);
  assert.deepEqual([...mapa.keys()], ['B25', 'D25']);
  assert.equal(mapa.get('B25').length, 2);
  assert.equal(mapa.get('D25')[0].t, 'Solo texto');
  assert.equal(extraerCorridas(null, compartidos).size, 0);
});
