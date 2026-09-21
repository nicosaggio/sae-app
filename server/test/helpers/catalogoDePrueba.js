// Catálogo chico y conocido para los tests de la API. Requiere que DB_PATH ya apunte a una base temporal migrada.
const { prepararItems } = require('../../src/services/catalogoClasificador');
const { aplicarPlan } = require('../../src/services/catalogoSiembraService');
const { leerAjustes } = require('../../src/services/catalogoCalculoService');

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
  filas: [
    { fila: 3, grupo: 'SISTEMA', codigo: 'CE-100', descripcion: 'Cenefa 1 m', unidad: 'ml', cliente: 1000 },
    { fila: 4, grupo: 'SISTEMA', codigo: 'PB-1', descripcion: 'Panel blanco', unidad: 'c/u', cliente: 2000 },
  ],
  precios: new Map([['CE-100', 1000], ['PB-1', 2000]]),
};

const corridas = (codigo) => [{ t: `Ficha ${codigo}\n`, b: true, sz: 14 }, { t: 'Ancho: 1 m', b: false, sz: 11 }];
const item = (codigo, columna) => ({ columna, codigo, descripcion: `Ficha ${codigo}\nAncho: 1 m`, corridas: corridas(codigo), celdaImagen: `X${columna}`, imagenRuta: null });

const paginas = [
  { orden: 1, titulo: 'SAE - SISTEMA', logoGrande: true, bandas: [{ fila: 22, items: [item('CE-100', 1), item('CE-150', 2), item('PB-1', 3)] }, { fila: 28, items: [item('TV-43', 1), item('SIN', 3)] }] },
  { orden: 2, titulo: 'SAE - PISOS', logoGrande: false, bandas: [{ fila: 38, items: [item('MC-43', 1)] }] },
];

const valores = {
  columnas: { pase: 'F', sae: 'I', porcentaje: 'G' },
  filas: [
    fila(4, 'CE-100', { v: 1000 }, { sae: 1400 }),
    fila(5, 'CE-150', { v: 1500, f: 'F4*1.5' }, { sae: 2100 }),
    fila(6, 'CE-200', { v: 2000, f: 'F4*2' }, { sae: 2800 }),
    fila(7, 'PB-1', { v: 2000 }, { sae: 2800 }),
    fila(8, 'TV-43', { v: 177900, f: '169000+8900' }, { sae: 355800, porcentaje: 1 }),
    fila(9, 'TV-50P', { v: 177900, f: 'F8' }, { sae: 355800, porcentaje: 1 }),
    fila(10, 'SIN', {}, { sae: 0 }),
    fila(11, 'MC-43', {}, { sae: 2500, resultadoF: '(68100*I4)/38600' }),
  ],
};

const excel = {
  paginas,
  logoRuta: null,
  fechaVigencia: '2026-09-15',
  ocultas: { valores: [], catalogo: [] },
  imagenes: { celdasConImagen: 0, distintas: 0 },
  fotosSinItem: [],
};

/** Siembra el catálogo de prueba (8 ítems, 2 páginas, la base parche de 2 códigos) con la misma lógica de la siembra real. */
function sembrarCatalogoDePrueba() {
  const ajustes = leerAjustes();
  const plan = prepararItems({ valores, paginas, baseParche, ajustes });
  return aplicarPlan({
    plan,
    excel,
    baseParche,
    imagenes: { archivos: new Map(), resumen: { procesadas: 0, reutilizadas: 0, errores: [], bytesOriginal: 0, bytesFinal: 0 } },
    ajustes,
    reemplazar: false,
    rutas: { catalogo: 'prueba.xlsx', baseParche: 'prueba-base.xlsx' },
  });
}

module.exports = { sembrarCatalogoDePrueba, baseParche };
