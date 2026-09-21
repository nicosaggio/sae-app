const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const carpeta = fs.mkdtempSync(path.join(os.tmpdir(), 'saeapp-img-'));
process.env.DB_PATH = path.join(carpeta, 'test.db');
process.env.CATALOGO_IMG_DIR = path.join(carpeta, 'img');

const { Jimp, JimpMime } = require('jimp');
const { db } = require('../src/db/connection');
const { resolverImagenesEnCelda } = require('../src/services/catalogoExcelService');
const { guardarImagen, rutaDeImagen, ANCHO_MAXIMO } = require('../src/services/catalogoImagenService');

test.after(() => {
  db.close();
  fs.rmSync(carpeta, { recursive: true, force: true });
});

const HOJA = `<worksheet><sheetData><row r="5">
  <c r="B5" s="54" t="e" vm="1"><v>#VALUE!</v></c>
  <c r="B24" s="21" t="e" vm="2"><v>#VALUE!</v></c>
  <c r="D24" vm="3" s="21" t="e"><v>#VALUE!</v></c>
  <c r="F24" s="21" vm="2" t="e"/>
  <c r="B25" s="3"><v>texto</v></c>
</row></sheetData></worksheet>`;
const METADATA = `<metadata><metadataTypes count="1"><metadataType name="XLRICHVALUE" minSupportedVersion="120000"/></metadataTypes>
  <futureMetadata name="XLRICHVALUE" count="3">
    <bk><extLst><ext uri="{x}"><xlrd:rvb i="0"/></ext></extLst></bk>
    <bk><extLst><ext uri="{x}"><xlrd:rvb i="1"/></ext></extLst></bk>
    <bk><extLst><ext uri="{x}"><xlrd:rvb i="2"/></ext></extLst></bk>
  </futureMetadata>
  <valueMetadata count="3"><bk><rc t="1" v="0"/></bk><bk><rc t="1" v="1"/></bk><bk><rc t="1" v="2"/></bk></valueMetadata></metadata>`;
const ESTRUCTURA = '<rvStructures count="1"><s t="_localImage"><k n="_rvRel:LocalImageIdentifier" t="i"/><k n="CalcOrigin" t="i"/></s></rvStructures>';
// Orden de valores a propósito distinto del de las relaciones: la imagen 0 apunta a la relación 2, etc.
const RICH_VALUE = '<rvData count="3"><rv s="0"><v>2</v><v>5</v></rv><rv s="0"><v>0</v><v>5</v></rv><rv s="0"><v>1</v><v>5</v></rv></rvData>';
const REL = '<richValueRels xmlns:r="x"><rel r:id="rId1"/><rel r:id="rId2"/><rel r:id="rId3"/></richValueRels>';
const RELS = `<Relationships>
  <Relationship Id="rId1" Type="t" Target="../media/image1.png"/>
  <Relationship Target="../media/image7.gif" Type="t" Id="rId2"/>
  <Relationship Id="rId3" Type="t" Target="/xl/media/image9.jpeg"/></Relationships>`;

const partes = { hojaXml: HOJA, metadataXml: METADATA, richValueXml: RICH_VALUE, estructuraXml: ESTRUCTURA, richValueRelXml: REL, relsXml: RELS };

test('cadena de imágenes en celda: sigue vm → metadata → rich value → relación → archivo', () => {
  const mapa = resolverImagenesEnCelda(partes);
  assert.deepEqual([...mapa.entries()], [
    ['B5', 'xl/media/image9.jpeg'],
    ['B24', 'xl/media/image1.png'],
    ['D24', 'xl/media/image7.gif'],
    ['F24', 'xl/media/image1.png'],
  ]);
  assert.equal(new Set(mapa.values()).size, 3, 'dos celdas pueden compartir imagen');
});

test('si falta alguna parte del archivo (no hay imágenes en celda) devuelve un mapa vacío en vez de fallar', () => {
  for (const clave of Object.keys(partes)) {
    assert.equal(resolverImagenesEnCelda({ ...partes, [clave]: null }).size, 0, clave);
  }
  assert.equal(resolverImagenesEnCelda({ ...partes, metadataXml: '<metadata/>' }).size, 0);
});

const png = async (ancho, alto, color) => Buffer.from(await new Jimp({ width: ancho, height: alto, color }).getBuffer(JimpMime.png));

test('las fotos se guardan como JPEG de 800 px de ancho máximo, con nombre = sha1 del original', async () => {
  const original = await png(2400, 1200, 0xff0000ff);
  const r = await guardarImagen(original);
  assert.equal(r.archivo, `${crypto.createHash('sha1').update(original).digest('hex')}.jpg`);
  assert.equal(r.reutilizada, false);
  assert.ok(r.bytesFinal > 0);
  const guardada = await Jimp.read(path.join(process.env.CATALOGO_IMG_DIR, r.archivo));
  assert.equal(guardada.width, ANCHO_MAXIMO);
  assert.equal(guardada.height, ANCHO_MAXIMO / 2);
});

test('una foto chica no se agranda', async () => {
  const r = await guardarImagen(await png(300, 200, 0x00ff00ff));
  const guardada = await Jimp.read(path.join(process.env.CATALOGO_IMG_DIR, r.archivo));
  assert.equal(guardada.width, 300);
});

test('la transparencia se aplana sobre blanco (en JPEG quedaría negra)', async () => {
  const r = await guardarImagen(await png(200, 200, 0x00000000));
  const guardada = await Jimp.read(path.join(process.env.CATALOGO_IMG_DIR, r.archivo));
  const { r: rojo, g, b } = { r: guardada.getPixelColor(10, 10) >>> 24, g: (guardada.getPixelColor(10, 10) >>> 16) & 255, b: (guardada.getPixelColor(10, 10) >>> 8) & 255 };
  assert.ok(rojo > 245 && g > 245 && b > 245, `debería ser blanco y es rgb(${rojo}, ${g}, ${b})`);
});

test('la misma imagen no se procesa dos veces', async () => {
  const original = await png(500, 500, 0x123456ff);
  const primera = await guardarImagen(original);
  const segunda = await guardarImagen(original);
  assert.equal(segunda.archivo, primera.archivo);
  assert.equal(segunda.reutilizada, true);
});

test('el logo se guarda tal cual, en PNG, sin recomprimir', async () => {
  const original = await png(2655, 803, 0x00000000);
  const r = await guardarImagen(original, { conservarPng: true });
  assert.match(r.archivo, /^[a-f0-9]{40}\.png$/);
  assert.deepEqual(fs.readFileSync(path.join(process.env.CATALOGO_IMG_DIR, r.archivo)), original);
});

test('bytes que no son una imagen fallan con error en vez de guardar basura', async () => {
  await assert.rejects(() => guardarImagen(Buffer.from('esto no es una imagen')));
  assert.equal(fs.readdirSync(process.env.CATALOGO_IMG_DIR).some((f) => f.includes('basura')), false);
});

test('rutaDeImagen sólo acepta nombres de archivo generados por la app (no se puede salir de la carpeta)', () => {
  const nombre = `${'a'.repeat(40)}.jpg`;
  assert.equal(rutaDeImagen(nombre), path.join(process.env.CATALOGO_IMG_DIR, nombre));
  assert.equal(rutaDeImagen(`${'b'.repeat(40)}.png`) !== null, true);
  for (const malo of ['../secreto.jpg', `..\\${nombre}`, 'logo.jpg', `${'a'.repeat(40)}.gif`, `${nombre}/../x`, '', null, undefined]) {
    assert.equal(rutaDeImagen(malo), null, String(malo));
  }
});
