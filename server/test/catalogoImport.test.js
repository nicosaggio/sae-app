const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const XLSX = require('xlsx');
const { leerBaseParche } = require('../src/services/catalogoImportService');

const carpeta = fs.mkdtempSync(path.join(os.tmpdir(), 'saeapp-import-'));
test.after(() => fs.rmSync(carpeta, { recursive: true, force: true }));

const ENCABEZADO = [null, 'GRUPO', 'CODIGO', 'DESCRIPCION', 'UNIDAD', '$ ORIGINAL', '$ ACT.', '$ CLIENTE'];
let contador = 0;

/** Arma un .xlsx temporal con una hoja BDatos (encabezados en la fila 2, como la base parche real). */
function crearBase(filasDatos, { encabezado = ENCABEZADO, hoja = 'BDatos', ocultas = [] } = {}) {
  const ws = XLSX.utils.aoa_to_sheet([[], encabezado, ...filasDatos]);
  if (ocultas.length > 0) {
    ws['!rows'] = [];
    for (const fila of ocultas) ws['!rows'][fila - 1] = { hidden: true };
  }
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, hoja);
  const ruta = path.join(carpeta, `base-${++contador}.xlsx`);
  XLSX.writeFile(wb, ruta);
  return ruta;
}

const fila = (codigo, cliente, extra = {}) => [null, extra.grupo ?? 'GRUPO A', codigo, extra.descripcion ?? `Desc ${codigo}`, extra.unidad ?? 'c/u', 100, 200, cliente];

test('lee código, descripción, unidad y $ CLIENTE, con el código tal cual pero sin espacios sobrantes', () => {
  const base = leerBaseParche(crearBase([fila('AN-01', 10975, { unidad: 'm²', descripcion: 'Alfombra' }), fila('  pb-250 ', 5000)]));
  assert.equal(base.filas.length, 2);
  assert.deepEqual(base.filas[0], { fila: 3, grupo: 'GRUPO A', codigo: 'AN-01', descripcion: 'Alfombra', unidad: 'm²', cliente: 10975 });
  assert.equal(base.filas[1].codigo, 'pb-250', 'se guarda como viene escrito (sin espacios)');
  assert.equal(base.precios.get('PB-250'), 5000, 'la clave del diccionario está normalizada');
});

test('0, vacío, "S / P" y "proveedor" llegan crudos: nunca se convierten en 0', () => {
  const base = leerBaseParche(crearBase([fila('A', 0), fila('B', null), fila('C', 'S / P'), fila('D', 'proveedor'), fila('E', 1234)]));
  assert.equal(base.precios.get('A'), 0);
  assert.equal(base.precios.get('B'), null);
  assert.equal(base.precios.get('C'), 'S / P');
  assert.equal(base.precios.get('D'), 'proveedor');
  assert.equal(base.precios.get('E'), 1234);
  assert.deepEqual(base.resumen, { conCodigo: 5, numericos: 1, ceros: 1, textos: 2, vacios: 1 });
});

test('código repetido: gana la primera aparición y se avisa', () => {
  const base = leerBaseParche(crearBase([fila('MC-49', 0), fila('X', 1), fila('mc-49 ', 88170)]));
  assert.equal(base.precios.get('MC-49'), 0);
  assert.deepEqual(base.duplicados, [{ codigo: 'MC-49', filas: [3, 5] }]);
});

test('las filas ocultas se ignoran', () => {
  const base = leerBaseParche(crearBase([fila('VISIBLE', 1), fila('OCULTA', 2), fila('OTRA', 3)], { ocultas: [4] }));
  assert.deepEqual(base.filas.map((f) => f.codigo), ['VISIBLE', 'OTRA']);
  assert.deepEqual(base.ocultas, [4]);
  assert.equal(base.precios.has('OCULTA'), false);
});

test('las columnas se ubican por el texto del encabezado, aunque cambien de lugar o haya columnas de más', () => {
  const encabezado = ['Extra', '$ CLIENTE', 'X', 'CODIGO', 'DESCRIPCION'];
  const base = leerBaseParche(crearBase([['a', 777, 'x', 'ZZ-1', 'Cosa']], { encabezado }));
  assert.deepEqual(base.filas.map((f) => [f.codigo, f.cliente, f.descripcion]), [['ZZ-1', 777, 'Cosa']]);
});

test('filas sin código pero con precio se cuentan aparte', () => {
  const base = leerBaseParche(crearBase([fila('OK', 5), [null, 'G', null, 'sin código', 'c/u', 1, 2, 999]]));
  assert.deepEqual(base.sinCodigo, [4]);
  assert.equal(base.filas.length, 1);
});

test('errores claros y en español: archivo inexistente, sin hoja BDatos, columnas renombradas, archivo dañado', () => {
  const esperar = (fn, patron) =>
    assert.throws(fn, (err) => err.status === 400 && patron.test(err.message), `debería fallar con ${patron}`);

  esperar(() => leerBaseParche(path.join(carpeta, 'no-existe.xlsx')), /No se encontró el archivo/);
  esperar(() => leerBaseParche(crearBase([fila('A', 1)], { hoja: 'Otra' })), /hoja "BDatos".*Otra/);
  esperar(() => leerBaseParche(crearBase([fila('A', 1)], { encabezado: [null, 'GRUPO', 'CÓDIGO', 'DESCRIPCION', 'UNIDAD', 'x', 'y', 'PRECIO'] })), /"CODIGO" y "\$ CLIENTE"/);

  const danado = path.join(carpeta, 'danado.xlsx');
  fs.writeFileSync(danado, Buffer.concat([Buffer.from('PK\x03\x04'), Buffer.alloc(64, 7)]));
  esperar(() => leerBaseParche(danado), /No se pudo leer el archivo|hoja "BDatos"/);
});
