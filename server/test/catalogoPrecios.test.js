const test = require('node:test');
const assert = require('node:assert/strict');
const {
  calcularPrecios,
  redondearSae,
  normalizarCodigo,
  grafoDependencias,
  dependientesTransitivos,
  describirMotivo,
} = require('../src/services/catalogoPreciosService');
const fixture = require('./fixtures/catalogo-valores.json');

/** Convierte la fixture (reglas por código) en filas tipo catalogo_items con ids. */
function armarItems(entradas) {
  const idPorCodigo = new Map(entradas.map((it, i) => [normalizarCodigo(it.codigo), i + 1]));
  const id = (codigo) => {
    const encontrado = idPorCodigo.get(normalizarCodigo(codigo));
    assert.ok(encontrado, `la fixture referencia un código que no existe: ${codigo}`);
    return encontrado;
  };
  const items = entradas.map((it, i) => ({
    id: i + 1,
    codigo: it.codigo,
    regla_tipo: it.regla.tipo,
    regla_codigo_base: it.regla.codigo_base ?? null,
    regla_item_ref_id: it.regla.ref ? id(it.regla.ref) : null,
    regla_item_ref2_id: it.regla.ref2 ? id(it.regla.ref2) : null,
    regla_item_ref3_id: it.regla.ref3 ? id(it.regla.ref3) : null,
    regla_factor: it.regla.factor ?? null,
    regla_num: it.regla.num ?? null,
    regla_den: it.regla.den ?? null,
    valor_manual: it.regla.valor ?? null,
    suma_adicional_pie: it.regla.suma_adicional_pie ? 1 : 0,
    porcentaje: it.porcentaje,
  }));
  return { items, id };
}

const opcionesExcel = () => ({
  precioBase: fixture.precioBase,
  porcentajeGlobal: fixture.porcentaje_global,
  multiplo: fixture.multiplo,
  adicionalPie: fixture.adicional_pie,
});

/** Ítem sintético mínimo para los tests de casos puntuales. */
const item = (id, campos) => ({
  id,
  codigo: `T-${id}`,
  regla_tipo: 'manual',
  regla_codigo_base: null,
  regla_item_ref_id: null,
  regla_item_ref2_id: null,
  regla_item_ref3_id: null,
  regla_factor: null,
  regla_num: null,
  regla_den: null,
  valor_manual: null,
  suma_adicional_pie: 0,
  porcentaje: null,
  ...campos,
});

test('los 259 ítems dan el mismo SAE (y el mismo pase parche) que el Excel actual', () => {
  assert.equal(fixture.items.length, 259);
  const { items } = armarItems(fixture.items);
  const resultados = calcularPrecios(items, opcionesExcel());

  const fallos = [];
  fixture.items.forEach((it, i) => {
    const r = resultados.get(i + 1);
    const esperado = it.sae_esperado !== undefined ? it.sae_esperado : it.sae_excel;
    if (esperado === 0) {
      // Un 0 en el Excel es un ítem sin precio: la app no lo convierte en $ 0 en silencio.
      if (r.estado !== 'sin_precio' || r.sae !== null) fallos.push({ codigo: it.codigo, esperado: 'sin_precio', obtenido: r });
      return;
    }
    if (r.estado !== 'ok' || r.sae !== esperado) fallos.push({ codigo: it.codigo, esperado, obtenido: r });
    if (it.pase_excel !== null && r.pase_parche !== null && Math.abs(r.pase_parche - it.pase_excel) > 1e-6) {
      fallos.push({ codigo: it.codigo, paseEsperado: it.pase_excel, paseObtenido: r.pase_parche });
    }
  });
  assert.deepEqual(fallos, []);
});

test('la fixture cubre todos los tipos de regla y los 21 ítems que difieren de BDatos', () => {
  const tipos = new Set(fixture.items.map((it) => it.regla.tipo));
  assert.deepEqual([...tipos].sort(), ['base', 'derivado', 'manual', 'proporcional', 'razon', 'sin_precio']);
  assert.equal(fixture.items.filter((it) => it.difiere_bdatos).length, 21);
});

test('redondeo: siempre hacia arriba, al múltiplo de 100 superior', () => {
  assert.equal(redondearSae(40116.99), 40200);
  assert.equal(redondearSae(40200), 40200);
  assert.equal(redondearSae(40200.01), 40300);
  assert.equal(redondearSae(0), 0);
  assert.equal(redondearSae(1), 100);
  assert.equal(redondearSae(99.5), 100);
  assert.equal(redondearSae(100), 100);
  assert.equal(redondearSae(100.000001), 200);
  // Ruido de punto flotante: 28655 * 1.4 = 40116.99999999999
  assert.equal(redondearSae(28655 * 1.4), 40200);
  assert.equal(redondearSae(28065 * 1.4), 39300);
  // Otro múltiplo configurable
  assert.equal(redondearSae(40116.99, 50), 40150);
  assert.equal(redondearSae(40116.99, 1), 40117);
});

test('cadena de 3 niveles con datos reales: PB-250 -> x -> xx -> xxx', () => {
  const { items, id } = armarItems(fixture.items);
  const normal = calcularPrecios(items, opcionesExcel());
  const base = normal.get(id('PB-250'));
  for (const codigo of ['PB-250 x', 'PB-250 xx', 'PB-250 xxx', 'PB-150x']) {
    assert.equal(normal.get(id(codigo)).sae, base.sae, codigo);
  }

  // Dependencia viva: si sube el precio base, arrastra a toda la cadena.
  const masCaro = calcularPrecios(items, { ...opcionesExcel(), precioBase: { ...fixture.precioBase, 'PB-250': fixture.precioBase['PB-250'] * 2 } });
  assert.ok(masCaro.get(id('PB-250')).sae > base.sae);
  assert.equal(masCaro.get(id('PB-250 xxx')).sae, masCaro.get(id('PB-250')).sae);
});

test('cadena de 3 niveles con factores: los cambios en el origen se propagan', () => {
  const items = [
    item(1, { regla_tipo: 'manual', valor_manual: 1000 }),
    item(2, { regla_tipo: 'derivado', regla_item_ref_id: 1, regla_factor: 1.5 }),
    item(3, { regla_tipo: 'derivado', regla_item_ref_id: 2, regla_factor: 2 }),
    item(4, { regla_tipo: 'derivado', regla_item_ref_id: 3, regla_factor: 0.5 }),
  ];
  const opciones = { precioBase: {}, porcentajeGlobal: 0.4 };
  let r = calcularPrecios(items, opciones);
  assert.equal(r.get(4).pase_parche, 1500);
  assert.equal(r.get(4).sae, 2100);

  items[0].valor_manual = 2000;
  r = calcularPrecios(items, opciones);
  assert.equal(r.get(4).pase_parche, 3000);
  assert.equal(r.get(4).sae, 4200);
});

test('los ítems se resuelven aunque vengan en cualquier orden', () => {
  const items = [
    item(3, { regla_tipo: 'derivado', regla_item_ref_id: 2, regla_factor: 2 }),
    item(2, { regla_tipo: 'derivado', regla_item_ref_id: 1 }),
    item(1, { regla_tipo: 'manual', valor_manual: 500 }),
  ];
  const r = calcularPrecios(items, { precioBase: {}, porcentajeGlobal: 0.4 });
  assert.equal(r.get(3).pase_parche, 1000);
});

test('ciclos: los involucrados quedan en error, los que cuelgan de un ciclo también, el resto sigue', () => {
  const items = [
    item(1, { regla_tipo: 'derivado', regla_item_ref_id: 2 }),
    item(2, { regla_tipo: 'derivado', regla_item_ref_id: 1 }),
    item(3, { regla_tipo: 'derivado', regla_item_ref_id: 1, regla_factor: 2 }),
    item(4, { regla_tipo: 'manual', valor_manual: 1000 }),
    item(5, { regla_tipo: 'derivado', regla_item_ref_id: 5 }),
    item(6, { regla_tipo: 'derivado', regla_item_ref_id: 4, regla_factor: 3 }),
  ];
  const r = calcularPrecios(items, { precioBase: {}, porcentajeGlobal: 0.4 });
  assert.equal(r.get(1).estado, 'error');
  assert.equal(r.get(1).motivo, 'ciclo');
  assert.equal(r.get(2).motivo, 'ciclo');
  assert.equal(r.get(5).motivo, 'ciclo', 'un ítem que se referencia a sí mismo es un ciclo');
  assert.equal(r.get(3).estado, 'error');
  assert.equal(r.get(3).motivo, 'origen_con_error');
  assert.equal(r.get(4).sae, 1400);
  assert.equal(r.get(6).sae, 4200);
});

test('ciclo con proporcional y razon en el medio', () => {
  const items = [
    item(1, { regla_tipo: 'proporcional', regla_item_ref_id: 2, regla_num: 1, regla_den: 1 }),
    item(2, { regla_tipo: 'razon', regla_item_ref_id: 1, regla_item_ref2_id: 3, regla_item_ref3_id: 3 }),
    item(3, { regla_tipo: 'manual', valor_manual: 100 }),
  ];
  const r = calcularPrecios(items, { precioBase: {}, porcentajeGlobal: 0.4 });
  assert.equal(r.get(1).motivo, 'ciclo');
  assert.equal(r.get(2).motivo, 'ciclo');
  assert.equal(r.get(3).sae, 200);
});

test('sin precio: vacío, 0, "S / P" y "proveedor" nunca se convierten en $ 0', () => {
  const items = [
    item(1, { regla_tipo: 'base', regla_codigo_base: 'A' }),
    item(2, { regla_tipo: 'base', regla_codigo_base: 'B' }),
    item(3, { regla_tipo: 'base', regla_codigo_base: 'C' }),
    item(4, { regla_tipo: 'base', regla_codigo_base: 'D' }),
    item(5, { regla_tipo: 'base', regla_codigo_base: 'NO-ESTA' }),
    item(6, { regla_tipo: 'base', regla_codigo_base: 'E' }),
    item(7, { regla_tipo: 'manual', valor_manual: null }),
    item(8, { regla_tipo: 'manual', valor_manual: 0 }),
    item(9, { regla_tipo: 'sin_precio' }),
    item(10, { regla_tipo: 'derivado', regla_item_ref_id: 1, regla_factor: 2 }),
    item(11, { regla_tipo: 'derivado', regla_item_ref_id: 10 }),
    item(12, { regla_tipo: 'proporcional', regla_item_ref_id: 2, regla_num: 1, regla_den: 2 }),
    item(13, { regla_tipo: 'base', regla_codigo_base: 'F' }),
  ];
  const precioBase = new Map([['A', null], ['B', 0], ['C', 'S / P'], ['D', 'proveedor'], ['E', '  '], ['F', 1000]]);
  const r = calcularPrecios(items, { precioBase, porcentajeGlobal: 0.4 });

  const esperados = {
    1: 'precio_vacio', 2: 'precio_cero', 3: 'precio_texto', 4: 'precio_texto', 6: 'precio_vacio',
    7: 'precio_vacio', 8: 'precio_cero', 9: 'sin_precio', 10: 'origen_sin_precio', 11: 'origen_sin_precio', 12: 'origen_sin_precio',
  };
  for (const [idItem, motivo] of Object.entries(esperados)) {
    const res = r.get(Number(idItem));
    assert.equal(res.estado, 'sin_precio', `item ${idItem}`);
    assert.equal(res.motivo, motivo, `item ${idItem}`);
    assert.equal(res.sae, null, `item ${idItem} no debe tener SAE`);
    assert.equal(res.pase_parche, null);
  }
  assert.equal(r.get(5).estado, 'error');
  assert.equal(r.get(5).motivo, 'codigo_base_inexistente');
  assert.equal(r.get(13).sae, 1400);
});

test('el código de la base se compara sin espacios ni mayúsculas, y gana la primera aparición', () => {
  const items = [item(1, { regla_tipo: 'base', regla_codigo_base: 'PB-250 x' })];
  let r = calcularPrecios(items, { precioBase: new Map([[' pb-250 X ', 1000], ['PB-250 x', 9999]]), porcentajeGlobal: 0.4 });
  assert.equal(r.get(1).pase_parche, 1000);

  // Sin regla_codigo_base usa el código del propio ítem
  const sinCodigoBase = [item(1, { regla_tipo: 'base', codigo: 'ab-1' })];
  r = calcularPrecios(sinCodigoBase, { precioBase: { 'AB-1': 500 }, porcentajeGlobal: 0.4 });
  assert.equal(r.get(1).sae, 700);
});

test('regla base con factor', () => {
  const items = [item(1, { regla_tipo: 'base', regla_codigo_base: 'A', regla_factor: 1.2 })];
  const r = calcularPrecios(items, { precioBase: { A: 58670 }, porcentajeGlobal: 0.4 });
  assert.equal(r.get(1).pase_parche, 58670 * 1.2);
  assert.equal(r.get(1).sae, 98600);
});

test('porcentaje por ítem: un porcentaje global distinto no pisa a los TV (100%), salvo "aplicar a todos"', () => {
  const { items, id } = armarItems(fixture.items);
  const general = calcularPrecios(items, opcionesExcel());
  const conCincuentaYCinco = calcularPrecios(items, { ...opcionesExcel(), porcentajeGlobal: 0.55 });

  for (const tv of ['TV-43', 'TV-50', 'TV-65', 'TV-50P']) {
    assert.equal(conCincuentaYCinco.get(id(tv)).sae, general.get(id(tv)).sae, `${tv} conserva su 100%`);
    assert.equal(conCincuentaYCinco.get(id(tv)).porcentaje, 1);
  }
  assert.equal(general.get(id('TV-43')).sae, 355800);

  const pb = id('PB-250');
  assert.equal(conCincuentaYCinco.get(pb).porcentaje, 0.55);
  assert.ok(conCincuentaYCinco.get(pb).sae > general.get(pb).sae);

  const aTodos = calcularPrecios(items, { ...opcionesExcel(), porcentajeGlobal: 0.55, aplicarATodos: true });
  assert.equal(aTodos.get(id('TV-43')).porcentaje, 0.55);
  // (169000 + 8900) * 1.55 = 275745 -> 275800
  assert.equal(aTodos.get(id('TV-43')).sae, 275800);
});

test('porcentaje del 55% con el mismo redondeo a 100', () => {
  const items = [item(1, { valor_manual: 10000 }), item(2, { valor_manual: 28655 })];
  const r = calcularPrecios(items, { precioBase: {}, porcentajeGlobal: 0.55 });
  assert.equal(r.get(1).sae, 15500);
  assert.equal(r.get(2).sae, 44500); // 28655 * 1.55 = 44415.25
});

test('televisores: el adicional del pie se suma a los tres y arrastra a TV-50P', () => {
  const { items, id } = armarItems(fixture.items);
  const sinPie = calcularPrecios(items, { ...opcionesExcel(), adicionalPie: 0 });
  assert.equal(sinPie.get(id('TV-43')).pase_parche, 169000);
  assert.equal(sinPie.get(id('TV-50')).pase_parche, 199900);
  assert.equal(sinPie.get(id('TV-65')).pase_parche, 269900);

  const conPie = calcularPrecios(items, { ...opcionesExcel(), adicionalPie: 10000 });
  assert.equal(conPie.get(id('TV-43')).pase_parche, 179000);
  assert.equal(conPie.get(id('TV-50')).pase_parche, 209900);
  assert.equal(conPie.get(id('TV-50P')).pase_parche, 209900, 'TV-50P depende de TV-50');
  assert.equal(conPie.get(id('TV-50P')).sae, conPie.get(id('TV-50')).sae);
});

test('proporcional (MC-43): sigue al SAE de CUA-050 con el porcentaje de la versión', () => {
  const { items, id } = armarItems(fixture.items);
  const general = calcularPrecios(items, opcionesExcel());
  assert.equal(general.get(id('CUA-050')).sae, 39300);
  assert.equal(general.get(id('MC-43')).sae, 69400);
  assert.equal(general.get(id('MC-43')).pase_parche, null);
  assert.equal(general.get(id('MC-43')).porcentaje, null, 'no lleva markup propio');

  const v55 = calcularPrecios(items, { ...opcionesExcel(), porcentajeGlobal: 0.55 });
  assert.equal(v55.get(id('CUA-050')).sae, 43600);
  assert.equal(v55.get(id('MC-43')).sae, 77000);
});

test('razon (MVN-01): pase(A) * pase(B) / pase(C)', () => {
  const items = [
    item(1, { regla_tipo: 'razon', regla_item_ref_id: 2, regla_item_ref2_id: 3, regla_item_ref3_id: 4 }),
    item(2, { valor_manual: 97085 }),
    item(3, { valor_manual: 63780 }),
    item(4, { valor_manual: 55455 }),
  ];
  const r = calcularPrecios(items, { precioBase: {}, porcentajeGlobal: 0.4 });
  assert.ok(Math.abs(r.get(1).pase_parche - 111659.56721666215) < 1e-6);
  assert.equal(r.get(1).sae, 156400);

  items[3].valor_manual = 0;
  const conCero = calcularPrecios(items, { precioBase: {}, porcentajeGlobal: 0.4 });
  assert.equal(conCero.get(1).estado, 'sin_precio');
});

test('razon con divisor 0 no se cuelga ni da Infinity', () => {
  const items = [
    item(1, { regla_tipo: 'razon', regla_item_ref_id: 2, regla_item_ref2_id: 2, regla_item_ref3_id: 3 }),
    item(2, { valor_manual: 100 }),
    item(3, { regla_tipo: 'base', regla_codigo_base: 'X' }),
  ];
  const r = calcularPrecios(items, { precioBase: { X: 0 }, porcentajeGlobal: 0.4 });
  assert.equal(r.get(1).estado, 'sin_precio');
  assert.equal(r.get(1).sae, null);
});

test('reglas mal armadas quedan en error sin tirar el cálculo del resto', () => {
  const items = [
    item(1, { regla_tipo: 'derivado', regla_item_ref_id: 999 }),
    item(2, { regla_tipo: 'derivado', regla_item_ref_id: null }),
    item(3, { regla_tipo: 'inventada' }),
    item(4, { regla_tipo: 'derivado', regla_item_ref_id: 5, regla_factor: 0 }),
    item(5, { valor_manual: 100 }),
    item(6, { regla_tipo: 'proporcional', regla_item_ref_id: 5, regla_num: 1, regla_den: 0 }),
    item(7, { valor_manual: 100 }),
  ];
  const r = calcularPrecios(items, { precioBase: {}, porcentajeGlobal: 0.4 });
  assert.equal(r.get(1).motivo, 'referencia_inexistente');
  assert.equal(r.get(2).motivo, 'regla_invalida');
  assert.equal(r.get(3).motivo, 'regla_invalida');
  assert.equal(r.get(4).motivo, 'regla_invalida');
  assert.equal(r.get(6).motivo, 'regla_invalida');
  assert.equal(r.get(7).sae, 200);
});

test('opciones inválidas lanzan un Error con status 400 y mensaje en español', () => {
  const malas = [
    { porcentajeGlobal: NaN },
    { porcentajeGlobal: -0.1 },
    { porcentajeGlobal: 0.4, multiplo: 0 },
    { porcentajeGlobal: 0.4, multiplo: 2.5 },
    { porcentajeGlobal: 0.4, adicionalPie: -1 },
  ];
  for (const opciones of malas) {
    assert.throws(() => calcularPrecios([], opciones), (err) => err.status === 400 && /tiene que ser/.test(err.message));
  }
});

test('grafo de dependencias: de quién depende y quién depende de cada ítem', () => {
  const { items, id } = armarItems(fixture.items);
  const grafo = grafoDependencias(items);

  assert.deepEqual(grafo.dependeDe.get(id('PB-250')), []);
  assert.deepEqual(grafo.dependeDe.get(id('PB-250 xx')), [id('PB-250 x')]);
  assert.deepEqual(grafo.dependeDe.get(id('MVN-01')).sort(), [id('MVB-01'), id('MCN-11'), id('MC-01')].sort());
  assert.ok(grafo.dependientes.get(id('CE-100')).includes(id('CE-150')));
  assert.ok(grafo.dependientes.get(id('CE-100')).includes(id('CE-300')));

  const transitivos = dependientesTransitivos(grafo, id('PB-250'));
  for (const codigo of ['PB-250 x', 'PB-250 xx', 'PB-250 xxx', 'PB-150x']) assert.ok(transitivos.includes(id(codigo)), codigo);
  assert.ok(!transitivos.includes(id('PB-250')));

  assert.ok(dependientesTransitivos(grafo, id('CUA-050')).includes(id('MC-43')), 'proporcional también es dependencia');
});

test('dependientesTransitivos termina aunque haya ciclos', () => {
  const items = [
    item(1, { regla_tipo: 'derivado', regla_item_ref_id: 2 }),
    item(2, { regla_tipo: 'derivado', regla_item_ref_id: 1 }),
  ];
  const grafo = grafoDependencias(items);
  assert.deepEqual(dependientesTransitivos(grafo, 1), [2]);
});

test('describirMotivo devuelve texto en español para cada motivo conocido', () => {
  assert.match(describirMotivo('ciclo'), /circular/);
  assert.match(describirMotivo('precio_texto'), /S \/ P/);
  assert.equal(describirMotivo(null), '');
});
