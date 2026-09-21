const test = require('node:test');
const assert = require('node:assert/strict');
const { prepararItems, normalizarTexto, similitud } = require('../src/services/catalogoClasificador');

const AJUSTES = { porcentajeDefecto: 0.4, adicionalPie: 8900 };
const COLUMNAS = { pase: 'F', sae: 'I', porcentaje: 'G' };

/** Fila de VALORES: pase = { v, f } (valor cacheado + fórmula, si la hay). */
const fila = (n, cod, pase = {}, extra = {}) => ({
  fila: n,
  rubro: extra.rubro ?? 'SISTEMA',
  cod,
  descripcion: 'descripcion' in extra ? extra.descripcion : `Desc ${cod}`,
  pase: { v: pase.v ?? null, f: pase.f ?? null },
  porcentaje: { v: extra.porcentaje ?? 0.4, f: null },
  resultado: { v: null, f: extra.resultadoF ?? null },
  sae: { v: extra.sae ?? null, f: null },
});

const baseParche = (filas) => ({
  filas: filas.map(([codigo, cliente, descripcion = `Base ${codigo}`, unidad = 'c/u']) => ({ fila: 0, grupo: 'G', codigo, descripcion, unidad, cliente })),
  precios: new Map(filas.map(([codigo, cliente]) => [codigo.toUpperCase(), cliente])),
});

const preparar = (filas, { base = baseParche([]), paginas = [], ajustes = AJUSTES } = {}) =>
  prepararItems({ valores: { filas, columnas: COLUMNAS }, paginas, baseParche: base, ajustes });

const reglaDe = (plan, codigo) => plan.items.find((i) => i.codigo === codigo).regla;

test('número literal igual al $ CLIENTE de la base parche → base; distinto o inexistente → manual', () => {
  const plan = preparar(
    [fila(4, 'A', { v: 1000 }), fila(5, 'B', { v: 1000 }), fila(6, 'C', { v: 500 })],
    { base: baseParche([['A', 1000], ['B', 1200]]) }
  );
  assert.deepEqual(reglaDe(plan, 'A'), { tipo: 'base', codigo_base: 'A' });
  assert.deepEqual(reglaDe(plan, 'B'), { tipo: 'manual', valor: 1000 });
  assert.deepEqual(reglaDe(plan, 'C'), { tipo: 'manual', valor: 500 });
  assert.equal(plan.items.find((i) => i.codigo === 'A').difiere_bdatos, false);
  assert.equal(plan.items.find((i) => i.codigo === 'B').difiere_bdatos, true, 'existe en la base con otro valor');
  assert.equal(plan.items.find((i) => i.codigo === 'B').valor_bdatos, 1200);
  assert.equal(plan.items.find((i) => i.codigo === 'C').difiere_bdatos, false, 'no existe en la base: no hay con qué compararlo');
});

test('fórmulas que referencian otra fila quedan como dependencia viva (derivado), con su factor', () => {
  const plan = preparar([
    fila(4, 'CE-100', { v: 1000 }),
    fila(5, 'CE-150', { v: 1500, f: 'F4*1.5' }),
    fila(6, 'CE-X', { v: 1000, f: '+F4' }),
    fila(7, 'GR-050', { v: 500, f: 'F4/2' }),
    fila(8, 'PB-2', { v: 1000, f: 'F4' }),
    fila(9, 'ABS', { v: 1000, f: '$F$4' }),
  ]);
  assert.deepEqual(reglaDe(plan, 'CE-150'), { tipo: 'derivado', ref: 'CE-100', factor: 1.5 });
  assert.deepEqual(reglaDe(plan, 'CE-X'), { tipo: 'derivado', ref: 'CE-100', factor: 1 });
  assert.deepEqual(reglaDe(plan, 'GR-050'), { tipo: 'derivado', ref: 'CE-100', factor: 0.5 });
  assert.deepEqual(reglaDe(plan, 'PB-2'), { tipo: 'derivado', ref: 'CE-100', factor: 1 });
  assert.deepEqual(reglaDe(plan, 'ABS'), { tipo: 'derivado', ref: 'CE-100', factor: 1 });
});

test('un derivado que coincide con la base parche sigue siendo derivado (no se congela la dependencia)', () => {
  const plan = preparar([fila(4, 'O', { v: 1000 }), fila(5, 'D', { v: 1000, f: 'F4' })], { base: baseParche([['O', 1000], ['D', 1000]]) });
  assert.equal(reglaDe(plan, 'D').tipo, 'derivado');
  assert.equal(plan.items.find((i) => i.codigo === 'D').difiere_bdatos, false);
});

test('(F230*F226)/F223 → razon', () => {
  const plan = preparar([
    fila(4, 'MC-01', { v: 55455 }),
    fila(5, 'MCN-11', { v: 63780 }),
    fila(6, 'MVB-01', { v: 97085 }),
    fila(7, 'MVN-01', { v: 111659.56, f: '(F6*F5)/F4' }),
  ]);
  assert.deepEqual(reglaDe(plan, 'MVN-01'), { tipo: 'razon', ref: 'MVB-01', ref2: 'MCN-11', ref3: 'MC-01' });
});

test('constantes: lista + adicional del pie → manual con pie; otra constante → manual con el valor actual', () => {
  const plan = preparar([
    fila(4, 'TV-43', { v: 177900, f: '169000+8900' }),
    fila(5, 'AVN-02', { v: 70404, f: '58670*1.2' }),
    fila(6, 'TV-X', { v: 110000, f: '100000+10000' }),
  ]);
  assert.deepEqual(reglaDe(plan, 'TV-43'), { tipo: 'manual', valor: 169000, suma_adicional_pie: true });
  assert.deepEqual(reglaDe(plan, 'AVN-02'), { tipo: 'manual', valor: 70404 });
  assert.deepEqual(reglaDe(plan, 'TV-X'), { tipo: 'manual', valor: 110000 }, 'no es el adicional configurado');

  const otroPie = preparar([fila(4, 'TV-X', { v: 110000, f: '100000+10000' })], { ajustes: { ...AJUSTES, adicionalPie: 10000 } });
  assert.deepEqual(reglaDe(otroPie, 'TV-X'), { tipo: 'manual', valor: 100000, suma_adicional_pie: true });
});

test('PASE PARCHE vacío con fórmula sobre el SAE de otro ítem en `redultado` → proporcional (MC-43)', () => {
  const plan = preparar([
    fila(4, 'CUA-050', { v: 28065 }, { sae: 39300 }),
    fila(5, 'MC-43', {}, { resultadoF: '(68100*I4)/38600' }),
    fila(6, 'VACIO', {}),
  ]);
  assert.deepEqual(reglaDe(plan, 'MC-43'), { tipo: 'proporcional', ref: 'CUA-050', num: 68100, den: 38600 });
  assert.deepEqual(reglaDe(plan, 'VACIO'), { tipo: 'sin_precio' });
});

test('PASE PARCHE con texto ("S / P") queda sin precio y avisa', () => {
  const plan = preparar([fila(4, 'X', { v: 'S / P' })]);
  assert.deepEqual(reglaDe(plan, 'X'), { tipo: 'sin_precio' });
  assert.match(plan.avisos.join('\n'), /X: El PASE PARCHE es un texto \("S \/ P"\)/);
});

test('fórmula desconocida: no se cuelga, queda manual con el valor actual y avisa', () => {
  const plan = preparar([fila(4, 'X', { v: 1234, f: 'SUM(F1:F3)' })]);
  assert.deepEqual(reglaDe(plan, 'X'), { tipo: 'manual', valor: 1234 });
  assert.match(plan.avisos.join('\n'), /Fórmula no reconocida \(=SUM\(F1:F3\)\)/);
});

test('el porcentaje del Excel igual al por defecto queda en NULL (sigue al global); otro valor se conserva', () => {
  const plan = preparar([fila(4, 'A', { v: 1 }, { porcentaje: 0.4 }), fila(5, 'TV', { v: 1 }, { porcentaje: 1 }), fila(6, 'N', { v: 1 }, { porcentaje: null })]);
  assert.equal(plan.items[0].porcentaje, null);
  assert.equal(plan.items[1].porcentaje, 1);
  assert.equal(plan.items[2].porcentaje, null);

  const conOtroDefecto = preparar([fila(4, 'A', { v: 1 }, { porcentaje: 0.4 })], { ajustes: { ...AJUSTES, porcentajeDefecto: 0.5 } });
  assert.equal(conOtroDefecto.items[0].porcentaje, 0.4);
});

test('códigos duplicados: se conserva la fila que coincide con lo publicado, y si no, la primera', () => {
  const paginas = [{ orden: 1, bandas: [{ items: [{ codigo: 'MM-06N', descripcion: 'MESA BAJA PIE CENTRAL\nDiam 85', imagenRuta: 'xl/media/a.gif', columna: 1 }] }] }];
  const plan = preparar(
    [
      fila(4, 'MM-06N', { v: 35420 }, { descripcion: 'MESA REDONDA CHICA MADERA NEGRA Diam 85cm.' }),
      fila(5, 'MM-06N', { v: 33745 }, { descripcion: 'MESA BAJA PIE CENTRAL DIAMETRO 0,85m (NEGRA)' }),
      fila(6, 'ES-04', { v: 52905 }, { descripcion: 'ESTANTERIA 4 ESTANTES 100*050' }),
      fila(7, 'es-04', { v: 52905 }, { descripcion: 'ESTANTERIA 4 ESTANTES 100*030' }),
    ],
    { paginas }
  );
  assert.deepEqual(plan.items.map((i) => i.fila), [5, 6]);
  assert.deepEqual(plan.salteadas.map((s) => s.fila), [4, 7]);
  assert.match(plan.salteadas[0].motivo, /se conserva la fila 5 \(la que coincide con lo publicado\)/);
  assert.match(plan.salteadas[1].motivo, /se conserva la fila 6 \(la primera\)/);
  assert.equal(plan.items[0].publicado, true);
  assert.equal(plan.items[0].descripcion_catalogo, 'MESA BAJA PIE CENTRAL\nDiam 85');
  assert.equal(plan.items[0].imagen_ruta, 'xl/media/a.gif');
});

test('filas sin código: toman el de la base parche si la descripción coincide con una sola fila', () => {
  const base = baseParche([
    ['MS-16', 38145, 'SILLA GIRATORIA BAJA - NEGRA'],
    ['MS-16B', 38145, 'SILLA GIRATORIA BAJA - BLANCA'],
    ['X-1', 1, 'PUFF ÚNICO'],
    ['X-2', 2, 'Puff  unico'],
    ['CC-380', 198685, 'CONEXION TRIFASICA SIMPLE A 380V'],
  ]);
  const plan = preparar(
    [
      fila(4, null, {}, { descripcion: 'SILLA GIRATORIA BAJA (NEGRA)' }),
      fila(5, null, {}, { descripcion: 'silla giratoria baja (blanca)' }),
      fila(6, null, {}, { descripcion: 'PUFF ÚNICO' }),
      fila(7, null, {}, { descripcion: 'TOMACORRIENTES TRIFASICO' }),
      fila(8, null, { v: 'PRECIOS YACO' }, { descripcion: null }),
    ],
    { base }
  );
  assert.deepEqual(plan.items.map((i) => [i.codigo, i.origen_codigo]), [['MS-16', 'base_parche'], ['MS-16B', 'base_parche']]);
  assert.deepEqual(reglaDe(plan, 'MS-16'), { tipo: 'base', codigo_base: 'MS-16' });
  assert.equal(plan.items[0].sae_excel, null, 'un ítem nuevo no tiene SAE de referencia en el Excel');
  assert.equal(plan.items[0].unidad, 'c/u');
  assert.deepEqual(plan.salteadas.map((s) => [s.fila, s.motivo]), [
    [6, 'sin código y con varios equivalentes en la base parche'],
    [7, 'sin código y sin equivalente en la base parche'],
  ]);
  assert.deepEqual(plan.notas, [{ fila: 8, texto: 'PRECIOS YACO' }]);
});

test('referencia a una fila que no se migra: queda manual con el valor actual y avisa (nunca un precio en blanco)', () => {
  const plan = preparar([
    fila(4, 'D', { v: 500 }),
    fila(5, 'D', { v: 500 }),
    fila(6, 'H', { v: 1000, f: 'F5*2' }),
    fila(7, 'K', { v: 700, f: 'F99' }),
  ]);
  assert.deepEqual(plan.salteadas.map((s) => s.fila), [5]);
  assert.deepEqual(reglaDe(plan, 'H'), { tipo: 'manual', valor: 1000 }, 'apuntaba a la fila duplicada que se saltea');
  assert.deepEqual(reglaDe(plan, 'K'), { tipo: 'manual', valor: 700 });
  assert.match(plan.avisos.join('\n'), /H: Referencia a la fila 5, que no se migra/);
  assert.match(plan.avisos.join('\n'), /K: Referencia a la fila 99, que no se migra/);
});

test('publicados: hereda la ficha y la imagen; un código publicado que no existe en VALORES avisa', () => {
  const paginas = [
    {
      orden: 1,
      bandas: [{ items: [
        { codigo: 'A', descripcion: 'Ficha de A', imagenRuta: 'xl/media/a.png', columna: 1 },
        { codigo: 'FANTASMA', descripcion: 'x', imagenRuta: null, columna: 2 },
      ] }],
    },
  ];
  const plan = preparar([fila(4, 'a', { v: 1 }), fila(5, 'B', { v: 1 })], { paginas });
  const [a, b] = plan.items;
  assert.equal(a.publicado, true);
  assert.equal(a.descripcion_catalogo, 'Ficha de A');
  assert.equal(a.imagen_ruta, 'xl/media/a.png');
  assert.equal(b.publicado, false);
  assert.equal(b.imagen_ruta, null);
  assert.match(plan.avisos.join('\n'), /FANTASMA no existe en VALORES/);
});

test('normalizarTexto y similitud', () => {
  assert.equal(normalizarTexto('  Silla (Negra) – ÚNICA!  '), 'SILLA NEGRA UNICA');
  assert.equal(similitud('MESA BAJA', 'mesa baja'), 1);
  assert.equal(similitud('MESA BAJA', 'SILLA ALTA'), 0);
  assert.equal(similitud('', 'algo'), 0);
  assert.ok(similitud('MESA BAJA PIE', 'MESA BAJA PIE CENTRAL') > similitud('MESA BAJA PIE', 'MESA REDONDA'));
});
