const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const carpeta = fs.mkdtempSync(path.join(os.tmpdir(), 'saeapp-siembra-unit-'));
process.env.DB_PATH = path.join(carpeta, 'test.db');
process.env.CATALOGO_IMG_DIR = path.join(carpeta, 'img');

const { db } = require('../src/db/connection');
const { run: migrar } = require('../src/db/migrate');
const { prepararItems } = require('../src/services/catalogoClasificador');
const { aplicarPlan, sembrarCatalogo, reporteACsv, leerAjustes } = require('../src/services/catalogoSiembraService');

test.before(() => migrar());
test.after(() => {
  db.close();
  fs.rmSync(carpeta, { recursive: true, force: true });
});

const LOGO = `${'1'.repeat(40)}.png`;
const FOTO = `${'a'.repeat(40)}.jpg`;

const fila = (n, cod, pase, extra = {}) => ({
  fila: n,
  rubro: extra.rubro ?? 'SISTEMA',
  cod,
  descripcion: `Desc ${cod}`,
  pase: { v: pase.v ?? null, f: pase.f ?? null },
  porcentaje: { v: extra.porcentaje ?? 0.4, f: null },
  resultado: { v: null, f: extra.resultadoF ?? null },
  sae: { v: extra.sae ?? 0, f: null },
});

const baseParche = {
  filas: [{ fila: 3, grupo: 'G', codigo: 'CE-100', descripcion: 'Cenefa', unidad: 'ml', cliente: 1000 }, { fila: 4, grupo: 'G', codigo: 'PB-1', descripcion: 'Panel', unidad: 'c/u', cliente: 2000 }],
  precios: new Map([['CE-100', 1000], ['PB-1', 2000]]),
};

const CORRIDAS = (codigo) => [{ t: `Ficha ${codigo}\n`, b: true, sz: 14 }, { t: 'Ancho: 1 m', b: false, sz: 11 }];
const item = (codigo, columna, imagenRuta = null) => ({ columna, codigo, descripcion: `Ficha ${codigo}\nAncho: 1 m`, corridas: CORRIDAS(codigo), celdaImagen: `X${columna}`, imagenRuta });

const paginas = [
  { orden: 1, titulo: 'SAE - SISTEMA', logoGrande: true, bandas: [{ fila: 22, items: [item('CE-100', 1, 'xl/media/a.gif'), item('CE-150', 2), item('PB-1', 3)] }, { fila: 28, items: [item('TV-43', 1)] }] },
  { orden: 2, titulo: 'SAE - PISOS', logoGrande: false, bandas: [{ fila: 38, items: [item('MC-43', 2)] }] },
];

const valores = {
  columnas: { pase: 'F', sae: 'I', porcentaje: 'G' },
  filas: [
    fila(4, 'CE-100', { v: 1000 }, { sae: 1400 }),
    fila(5, 'CE-150', { v: 1500, f: 'F4*1.5' }, { sae: 2100 }),
    fila(6, 'PB-1', { v: 2000 }, { sae: 2800 }),
    fila(7, 'TV-43', { v: 177900, f: '169000+8900' }, { sae: 355800, porcentaje: 1 }),
    fila(8, 'SIN', {}, { sae: 0 }),
    fila(9, 'MC-43', {}, { sae: 2500, resultadoF: '(68100*I4)/38600' }),
  ],
};

const excel = {
  paginas,
  logoRuta: 'xl/media/logo.png',
  fechaVigencia: '2027-01-31',
  ocultas: { valores: [], catalogo: [212, 213] },
  imagenes: { celdasConImagen: 5, distintas: 3 },
  fotosSinItem: [],
};
const imagenes = () => ({
  archivos: new Map([['xl/media/logo.png', LOGO], ['xl/media/a.gif', FOTO]]),
  resumen: { procesadas: 2, reutilizadas: 0, errores: [], bytesOriginal: 2097152, bytesFinal: 1048576 },
});

const armar = () => {
  const ajustes = leerAjustes();
  return { plan: prepararItems({ valores, paginas, baseParche, ajustes }), excel, baseParche, imagenes: imagenes(), ajustes, reemplazar: false, rutas: { catalogo: 'c.xlsx', baseParche: 'b.xlsx' } };
};

const contar = (tabla) => db.prepare(`SELECT COUNT(*) AS n FROM ${tabla}`).get().n;

test('escribe ítems, referencias, precios, foto de la General, páginas y ajustes, y se verifica contra el Excel', () => {
  db.prepare("INSERT INTO productos (codigo, nombre) VALUES (' ce-100 ', 'Cenefa 1 m')").run();
  const reporte = aplicarPlan(armar());

  assert.deepEqual(reporte.totales, { itemsImportados: 6, itemsPublicados: 5, paginas: 2, posiciones: 5, productosEnlazados: 1, filasSalteadas: 0, vigencia: '2027-01-31' });
  assert.deepEqual(reporte.clasificacion, { base: 2, derivado: 1, manual: 1, sin_precio: 1, proporcional: 1 });
  assert.deepEqual(reporte.verificacion, { coinciden: 6, difieren: [], sinReferencia: 0 });
  assert.equal(contar('catalogo_base_precios'), 2, 'la app se acuerda de la base parche con la que se sembró');
  assert.equal(db.prepare("SELECT cliente_numero FROM catalogo_base_precios WHERE codigo = 'CE-100'").get().cliente_numero, 1000);

  const porCodigo = (codigo) => db.prepare('SELECT * FROM catalogo_items WHERE codigo = ?').get(codigo);
  const ce100 = porCodigo('CE-100');
  const ce150 = porCodigo('CE-150');
  assert.equal(ce150.regla_tipo, 'derivado');
  assert.equal(ce150.regla_item_ref_id, ce100.id, 'la referencia quedó como id, no como número congelado');
  assert.equal(ce150.regla_factor, 1.5);
  assert.deepEqual([ce100.sae, ce150.sae, porCodigo('PB-1').sae, porCodigo('TV-43').sae, porCodigo('MC-43').sae], [1400, 2100, 2800, 355800, 2500]);
  assert.equal(porCodigo('SIN').estado_precio, 'sin_precio');
  assert.equal(porCodigo('SIN').sae, null);
  assert.equal(porCodigo('TV-43').suma_adicional_pie, 1);
  assert.equal(porCodigo('TV-43').porcentaje, 1);
  assert.equal(ce100.porcentaje, null);
  assert.equal(porCodigo('MC-43').regla_item_ref_id, ce100.id);

  assert.equal(ce100.imagen, FOTO);
  assert.equal(ce100.publicado, 1);
  assert.equal(ce100.unidad, 'ml');
  assert.equal(ce100.descripcion_catalogo, 'Ficha CE-100\nAncho: 1 m');
  assert.deepEqual(JSON.parse(ce100.descripcion_formato), [{ t: 'Ficha CE-100\n', b: true, sz: 14 }, { t: 'Ancho: 1 m', b: false, sz: 11 }]);
  assert.equal(porCodigo('SIN').descripcion_formato, null);
  assert.equal(porCodigo('SIN').publicado, 0);
  assert.ok(ce100.producto_id, 'enlazado a productos ignorando mayúsculas y espacios');
  assert.equal(porCodigo('PB-1').producto_id, null);

  const general = db.prepare('SELECT id, fecha_vigencia FROM catalogo_versiones WHERE es_general = 1').get();
  assert.equal(general.fecha_vigencia, '2027-01-31');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM catalogo_version_precios WHERE version_id = ?').get(general.id).n, 6);
  assert.equal(db.prepare('SELECT sae FROM catalogo_version_precios WHERE version_id = ? AND item_id = ?').get(general.id, ce150.id).sae, 2100);

  const paginasDb = db.prepare('SELECT * FROM catalogo_paginas ORDER BY orden').all();
  assert.deepEqual(paginasDb.map((p) => [p.orden, p.titulo, p.logo_grande]), [[1, 'SAE - SISTEMA', 1], [2, 'SAE - PISOS', 0]]);
  const posiciones = db.prepare(
    `SELECT p.orden, po.banda, po.columna, i.codigo FROM catalogo_posiciones po
     JOIN catalogo_paginas p ON p.id = po.pagina_id JOIN catalogo_items i ON i.id = po.item_id ORDER BY p.orden, po.banda, po.columna`
  ).all().map((r) => `${r.orden}.${r.banda}.${r.columna}=${r.codigo}`);
  assert.deepEqual(posiciones, ['1.1.1=CE-100', '1.1.2=CE-150', '1.1.3=PB-1', '1.2.1=TV-43', '2.1.2=MC-43']);

  const ajustes = Object.fromEntries(db.prepare('SELECT clave, valor FROM catalogo_ajustes').all().map((a) => [a.clave, a.valor]));
  assert.equal(ajustes.logo_imagen, LOGO);
  assert.equal(ajustes.fecha_vigencia, '2027-01-31');

  const importacion = db.prepare('SELECT * FROM catalogo_importaciones').get();
  assert.equal(importacion.items_afectados, 6);
  assert.equal(importacion.usuario_id, null);
  assert.equal(JSON.parse(importacion.resumen_json).items.length, 6);
});

test('el reporte describe cada regla y marca lo que difiere de la base parche', () => {
  const reporte = JSON.parse(db.prepare('SELECT resumen_json FROM catalogo_importaciones').get().resumen_json);
  const regla = (codigo) => reporte.items.find((i) => i.codigo === codigo).regla;
  assert.equal(regla('CE-100'), 'base (CE-100)');
  assert.equal(regla('CE-150'), 'derivado de CE-100 ×1.5');
  assert.match(regla('TV-43'), /^manual \$169\.000 \+ pie$/);
  assert.equal(regla('MC-43'), 'proporcional al SAE de CE-100 × 68100/38600');
  assert.equal(regla('SIN'), 'sin precio');
});

test('volver a aplicar con reemplazar no duplica ni falla por las referencias entre ítems', () => {
  const plan = armar();
  plan.reemplazar = true;
  aplicarPlan(plan);
  assert.equal(contar('catalogo_items'), 6);
  assert.equal(contar('catalogo_paginas'), 2);
  assert.equal(contar('catalogo_posiciones'), 5);
  assert.equal(contar('catalogo_version_precios'), 6);
  assert.equal(contar('catalogo_importaciones'), 2);
  assert.equal(contar('catalogo_base_precios'), 2, 'reemplazar no duplica la base guardada');
  const ce150 = db.prepare("SELECT regla_item_ref_id FROM catalogo_items WHERE codigo = 'CE-150'").get();
  assert.equal(db.prepare("SELECT id FROM catalogo_items WHERE codigo = 'CE-100'").get().id, ce150.regla_item_ref_id);
});

test('todo o nada: si la escritura falla a la mitad, la base queda como estaba (también con reemplazar)', () => {
  const antes = db.prepare('SELECT id, codigo, sae FROM catalogo_items ORDER BY id').all();
  const mala = armar();
  mala.reemplazar = true;
  mala.plan.items.push({ ...mala.plan.items[0] }); // código repetido: rompe el UNIQUE después de haber borrado todo
  assert.throws(() => aplicarPlan(mala), /UNIQUE/);
  assert.deepEqual(db.prepare('SELECT id, codigo, sae FROM catalogo_items ORDER BY id').all(), antes);
  assert.equal(contar('catalogo_posiciones'), 5);
});

test('la siembra se rechaza si el catálogo ya tiene ítems, antes de leer ningún archivo', async () => {
  await assert.rejects(
    () => sembrarCatalogo({ rutaCatalogo: 'no-importa.xlsx', rutaBaseParche: 'tampoco.xlsx' }),
    (err) => err.status === 400 && /ya tiene 6 ítems.*--reemplazar/.test(err.message)
  );
});

test('un ítem que referencia a otro que no existe en la base queda en error, no en $ 0', () => {
  db.exec('UPDATE catalogo_items SET regla_tipo = \'base\', regla_codigo_base = \'NO-EXISTE\' WHERE codigo = \'PB-1\'');
  const { calcularPrecios } = require('../src/services/catalogoPreciosService');
  const filas = db.prepare('SELECT * FROM catalogo_items').all();
  const r = calcularPrecios(filas, { precioBase: baseParche.precios, porcentajeGlobal: 0.4 });
  assert.equal(r.get(filas.find((f) => f.codigo === 'PB-1').id).motivo, 'codigo_base_inexistente');
});

test('reporteACsv: BOM, separador ";", una fila por ítem y comillas cuando hace falta', () => {
  const csv = reporteACsv({
    items: [
      { fila: 4, codigo: 'A-1', rubro: 'SISTEMA', regla: 'base', pase_parche: 1000, porcentaje: null, sae_excel: 1400, sae_app: 1400, estado: 'ok', publicado: true, difiere_de_base_parche: false, codigo_tomado_de_base_parche: false, avisos: [] },
      { fila: 5, codigo: 'B;2', rubro: 'X', regla: 'manual', pase_parche: null, porcentaje: 1, sae_excel: 0, sae_app: null, estado: 'sin_precio', publicado: false, difiere_de_base_parche: true, codigo_tomado_de_base_parche: false, avisos: ['uno', 'dos "comillas"'] },
    ],
  });
  assert.ok(csv.startsWith('﻿fila;codigo;rubro;regla;'));
  const lineas = csv.trimEnd().split('\r\n');
  assert.equal(lineas.length, 3);
  assert.equal(lineas[1], '4;A-1;SISTEMA;base;1000;;1400;1400;ok;true;false;false;');
  assert.match(lineas[2], /^5;"B;2";X;manual;;1;0;;sin_precio;false;true;false;"uno \| dos ""comillas"""$/);
});
