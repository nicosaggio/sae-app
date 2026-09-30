const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const XLSX = require('xlsx');
const { leerListaDePrecios } = require('../src/services/catalogoListaPreciosService');

const carpeta = fs.mkdtempSync(path.join(os.tmpdir(), 'saeapp-lista-'));
test.after(() => fs.rmSync(carpeta, { recursive: true, force: true }));

const ENCABEZADO = [null, null, 'RUBRO', 'COD', 'DESCRIPCION', 'AREA PLOTEABLE', 'BASE PARCHE', '$ 0,22', 'SAE CIDEL', 'DIFERENCIA'];
let contador = 0;

/** Arma un .xlsx temporal con una hoja DATOS como la de la planilla de presupuesto real (encabezados en la fila 3). */
function crearLista(filasDatos, { encabezado = ENCABEZADO, hoja = 'DATOS', ocultas = [] } = {}) {
  const ws = XLSX.utils.aoa_to_sheet([[], [], encabezado, ...filasDatos]);
  if (ocultas.length > 0) {
    ws['!rows'] = [];
    for (const fila of ocultas) ws['!rows'][fila - 1] = { hidden: true };
  }
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, hoja);
  const ruta = path.join(carpeta, `lista-${++contador}.xlsx`);
  XLSX.writeFile(wb, ruta);
  return ruta;
}

const fila = (codigo, precio, extra = {}) => [null, null, extra.rubro ?? 'SISTEMA', codigo, extra.descripcion ?? `Desc ${codigo}`, null, extra.base ?? 1000, extra.markup ?? 1220, precio];

test('lee código, descripción y el precio de la columna que empieza con "SAE", venga como se llame', () => {
  const lista = leerListaDePrecios(crearLista([fila('AN-01', 43900, { descripcion: 'Alfombra', rubro: 'PISOS' })]));
  assert.equal(lista.columnaPrecio, 'SAE CIDEL');
  assert.deepEqual(lista.filas[0], { fila: 4, codigo: 'AN-01', descripcion: 'Alfombra', rubro: 'PISOS', precio: 43900 });
  assert.equal(lista.precios.get('AN-01'), 43900);
});

test('encuentra la columna de precio aunque el encabezado sea otro (por ejemplo "SAE MARZO")', () => {
  const encabezadoMarzo = ENCABEZADO.map((h) => (h === 'SAE CIDEL' ? 'SAE MARZO' : h));
  const lista = leerListaDePrecios(crearLista([fila('AN-01', 1000)], { encabezado: encabezadoMarzo }));
  assert.equal(lista.columnaPrecio, 'SAE MARZO');
});

test('si hay más de una columna que empieza con "SAE", avisa que es ambiguo en vez de adivinar', () => {
  const encabezadoDoble = [...ENCABEZADO, 'SAE OTRA'];
  assert.throws(
    () => leerListaDePrecios(crearLista([[...fila('AN-01', 1000), 2000]], { encabezado: encabezadoDoble })),
    /más de una columna que empieza con "SAE"/
  );
});

test('si no hay ninguna columna "COD" + "SAE...", avisa con un mensaje claro', () => {
  const sinPrecio = ENCABEZADO.map((h) => (h === 'SAE CIDEL' ? 'OTRA COSA' : h));
  assert.throws(() => leerListaDePrecios(crearLista([fila('AN-01', 1000)], { encabezado: sinPrecio })), /No encontré la columna "COD"/);
});

test('si la hoja no se llama DATOS, o no existe, el mensaje dice qué hojas hay', () => {
  assert.throws(() => leerListaDePrecios(crearLista([fila('AN-01', 1000)], { hoja: 'Otra' })), /no tiene una hoja "DATOS".*Otra/);
});

test('precio en 0, vacío o texto ("S/P"): se guardan tal cual, no se convierten en un número inventado', () => {
  const lista = leerListaDePrecios(crearLista([fila('CE-0', 0), fila('CE-1', null), fila('CE-2', 'S/P')]));
  assert.equal(lista.precios.get('CE-0'), 0);
  assert.equal(lista.precios.get('CE-1'), null);
  assert.equal(lista.precios.get('CE-2'), 'S/P');
  assert.deepEqual(lista.resumen, { conCodigo: 3, numericos: 0, ceros: 1, textos: 1, vacios: 1 });
});

test('un código repetido: la primera fila gana el precio, pero las dos quedan registradas como duplicado', () => {
  const lista = leerListaDePrecios(crearLista([fila('PB-250', 37700), fila('pb-250 ', 99999)]));
  assert.equal(lista.precios.get('PB-250'), 37700, 'gana la primera aparición');
  assert.deepEqual(lista.duplicados, [{ codigo: 'PB-250', filas: [4, 5] }]);
});

test('una fila con precio pero sin código se cuenta aparte, y las filas ocultas se ignoran', () => {
  const lista = leerListaDePrecios(
    crearLista([fila('AN-01', 1000), [null, null, 'X', null, 'sin código', null, 500, 610, 5000], fila('OCULTA', 7777)], { ocultas: [6] })
  );
  assert.equal(lista.sinCodigo.length, 1);
  assert.equal(lista.ocultas.length, 1);
  assert.equal(lista.precios.has('OCULTA'), false, 'la fila oculta no se lee');
  assert.equal(lista.filas.length, 1, 'sólo AN-01 tiene código: la de "sin código" no entra ahí, y la oculta se ignora del todo');
});

test('el código se guarda tal cual viene escrito, sin espacios sobrantes, pero se busca sin distinguir mayúsculas', () => {
  const lista = leerListaDePrecios(crearLista([fila('  Pb-250 ', 37700)]));
  assert.equal(lista.filas[0].codigo, 'Pb-250', 'se guarda como viene (sin espacios)');
  assert.equal(lista.precios.get('PB-250'), 37700, 'se busca en mayúsculas, normalizado');
});
