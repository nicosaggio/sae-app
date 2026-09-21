const path = require('path');
const XLSX = require('xlsx');
const { abrirLibro, filaOculta, textoDeCelda, errorDeArchivo } = require('./catalogoImportService');

const HOJA_VALORES = 'VALORES';
const HOJA_CATALOGO = 'CATALOGO';
const COLUMNAS_ITEM = ['B', 'D', 'F'];

const contenido = (libro, ruta) => {
  const entrada = libro.files && libro.files[ruta];
  return entrada && entrada.content ? Buffer.from(entrada.content) : null;
};
const texto = (libro, ruta) => {
  const bytes = contenido(libro, ruta);
  return bytes ? bytes.toString('utf8') : null;
};

const atributo = (etiqueta, nombre) => {
  const m = etiqueta.match(new RegExp(`\\b${nombre}="([^"]*)"`));
  return m ? m[1] : null;
};

/**
 * Las imágenes del catálogo no son dibujos flotantes sino "imágenes en celda" (rich values de
 * Excel 365): ninguna librería las expone, hay que seguir la cadena a mano.
 *   hoja:            <c r="B24" vm="2">                    vm = índice 1-based en valueMetadata
 *   metadata.xml:    valueMetadata/bk[vm-1]/rc[t=XLRICHVALUE] v → futureMetadata/bk[v]/rvb i
 *   rdrichvalue.xml: rv[i] → valor de la clave _rvRel:LocalImageIdentifier (según rdrichvaluestructure)
 *   richValueRel:    rel[n] r:id → *.rels Target → xl/media/imageN.ext
 * @returns {Map<string, string>} dirección de celda ("B24") → ruta dentro del zip ("xl/media/image2.png")
 */
function resolverImagenesEnCelda({ hojaXml, metadataXml, richValueXml, estructuraXml, richValueRelXml, relsXml }) {
  const resultado = new Map();
  if (![hojaXml, metadataXml, richValueXml, estructuraXml, richValueRelXml, relsXml].every(Boolean)) return resultado;

  const tipos = [...metadataXml.matchAll(/<metadataType\b[^>]*>/g)].map((m) => atributo(m[0], 'name'));
  const tipoRich = tipos.indexOf('XLRICHVALUE') + 1;
  if (tipoRich === 0) return resultado;

  const valueMetadata = (metadataXml.match(/<valueMetadata\b[\s\S]*?<\/valueMetadata>/) || [''])[0];
  const bloquesValor = [...valueMetadata.matchAll(/<bk>([\s\S]*?)<\/bk>/g)].map((bk) => {
    const rc = [...bk[1].matchAll(/<rc\b[^>]*>/g)].map((m) => ({ t: Number(atributo(m[0], 't')), v: Number(atributo(m[0], 'v')) }));
    const rich = rc.find((x) => x.t === tipoRich);
    return rich ? rich.v : null;
  });

  const futuro = (metadataXml.match(/<futureMetadata\b[^>]*name="XLRICHVALUE"[\s\S]*?<\/futureMetadata>/) || [''])[0];
  const indiceRichValue = [...futuro.matchAll(/<bk>([\s\S]*?)<\/bk>/g)].map((bk) => {
    const rvb = bk[1].match(/<[a-z0-9]*:?rvb\b[^>]*>/i);
    return rvb ? Number(atributo(rvb[0], 'i')) : null;
  });

  const estructuras = [...estructuraXml.matchAll(/<s\b[^>]*>([\s\S]*?)<\/s>/g)].map((s) =>
    [...s[1].matchAll(/<k\b[^>]*>/g)].map((k) => atributo(k[0], 'n'))
  );
  const richValues = [...richValueXml.matchAll(/<rv\b([^>]*)>([\s\S]*?)<\/rv>/g)].map((rv) => ({
    estructura: Number(atributo(rv[1], 's')),
    valores: [...rv[2].matchAll(/<v>([^<]*)<\/v>/g)].map((v) => v[1]),
  }));
  const relaciones = [...richValueRelXml.matchAll(/<rel\b[^>]*>/g)].map((m) => atributo(m[0], 'r:id'));
  const destinos = new Map();
  for (const m of relsXml.matchAll(/<Relationship\b[^>]*>/g)) destinos.set(atributo(m[0], 'Id'), atributo(m[0], 'Target'));

  const rutaImagenDe = (vm) => {
    const v = bloquesValor[vm - 1];
    if (v === null || v === undefined) return null;
    const idxRv = indiceRichValue[v];
    const rv = richValues[idxRv];
    if (!rv) return null;
    const posicion = (estructuras[rv.estructura] || []).indexOf('_rvRel:LocalImageIdentifier');
    if (posicion < 0) return null;
    const destino = destinos.get(relaciones[Number(rv.valores[posicion])]);
    if (!destino) return null;
    return destino.startsWith('/') ? destino.slice(1) : path.posix.normalize(path.posix.join('xl/richData', destino));
  };

  for (const m of hojaXml.matchAll(/<c\b[^>]*>/g)) {
    const vm = atributo(m[0], 'vm');
    const celda = atributo(m[0], 'r');
    if (!vm || !celda) continue;
    const ruta = rutaImagenDe(Number(vm));
    if (ruta) resultado.set(celda, ruta);
  }
  return resultado;
}

// La ficha de cada ítem es texto enriquecido: el título va en la fuente de la celda (Calibri 14 negrita)
// y las medidas en corridas propias (Calibri 11 normal). Una corrida con <rPr> trae su fuente completa.
const FUENTE_DE_LA_CELDA = { b: true, sz: 14 };

function decodificarXml(s) {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/_x000D_/g, '');
}

/** <si> de sharedStrings.xml → [{ t, b, sz }] con los saltos de línea normalizados. */
function parsearCorridas(siXml) {
  const textoDe = (xml) => [...xml.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map((m) => decodificarXml(m[1])).join('').replace(/\r\n?/g, '\n');
  const bloques = [...siXml.matchAll(/<r>([\s\S]*?)<\/r>/g)];
  const corridas =
    bloques.length === 0
      ? [{ t: textoDe(siXml), ...FUENTE_DE_LA_CELDA }]
      : bloques.map((r) => {
          const rpr = r[1].match(/<rPr>([\s\S]*?)<\/rPr>/);
          if (!rpr) return { t: textoDe(r[1]), ...FUENTE_DE_LA_CELDA };
          const sz = rpr[1].match(/<sz val="([\d.]+)"/);
          return { t: textoDe(r[1]), b: /<b\/>|<b val="(?:1|true)"\/>/.test(rpr[1]), sz: sz ? Number(sz[1]) : 11 };
        });

  const unidas = [];
  for (const c of corridas) {
    if (c.t === '') continue;
    const ultima = unidas[unidas.length - 1];
    if (ultima && ultima.b === c.b && ultima.sz === c.sz) ultima.t += c.t;
    else unidas.push({ ...c });
  }
  if (unidas.length > 0) unidas[unidas.length - 1].t = unidas[unidas.length - 1].t.replace(/\s+$/, '');
  return unidas.filter((c) => c.t !== '');
}

/** Dirección de celda → corridas, para las celdas de la hoja que son texto compartido. */
function extraerCorridas(hojaXml, sharedStringsXml) {
  const mapa = new Map();
  if (!hojaXml || !sharedStringsXml) return mapa;
  const sis = [...sharedStringsXml.matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => m[1]);
  for (const m of hojaXml.matchAll(/<c r="([A-Z]+\d+)"[^>]*\bt="s"[^>]*><v>(\d+)<\/v>/g)) {
    const si = sis[Number(m[2])];
    if (si !== undefined) mapa.set(m[1], parsearCorridas(si));
  }
  return mapa;
}

function rutaDeHoja(libro, nombre) {
  const workbook = texto(libro, 'xl/workbook.xml');
  const rels = texto(libro, 'xl/_rels/workbook.xml.rels');
  if (!workbook || !rels) return null;
  const hoja = [...workbook.matchAll(/<sheet\b[^>]*>/g)].find((m) => atributo(m[0], 'name') === nombre);
  if (!hoja) return null;
  const rid = atributo(hoja[0], 'r:id');
  const rel = [...rels.matchAll(/<Relationship\b[^>]*>/g)].find((m) => atributo(m[0], 'Id') === rid);
  if (!rel) return null;
  const destino = atributo(rel[0], 'Target');
  return destino.startsWith('/') ? destino.slice(1) : path.posix.join('xl', destino);
}

const ENCABEZADOS_VALORES = {
  rubro: 'RUBRO',
  cod: 'COD',
  descripcion: 'DESCRIPCION',
  pase: 'PASE PARCHE',
  porcentaje: 'PORCENTAJE',
  resultado: 'REDULTADO',
  sae: 'SAE',
};

function leerValores(hoja) {
  if (!hoja['!ref']) throw errorDeArchivo(`La hoja ${HOJA_VALORES} está vacía.`);
  const rango = XLSX.utils.decode_range(hoja['!ref']);
  let filaEncabezado = null;
  const col = {};
  for (let r = rango.s.r; r <= Math.min(rango.e.r, rango.s.r + 14) && filaEncabezado === null; r++) {
    const encontradas = {};
    for (let c = rango.s.c; c <= rango.e.c; c++) {
      const t = textoDeCelda(hoja[XLSX.utils.encode_cell({ r, c })]).toUpperCase();
      for (const [clave, nombre] of Object.entries(ENCABEZADOS_VALORES)) {
        if ((t === nombre || (clave === 'resultado' && t === 'RESULTADO')) && encontradas[clave] === undefined) encontradas[clave] = c;
      }
    }
    if (encontradas.cod !== undefined && encontradas.pase !== undefined) {
      filaEncabezado = r;
      Object.assign(col, encontradas);
    }
  }
  if (filaEncabezado === null) {
    throw errorDeArchivo(`No encontré las columnas "COD" y "PASE PARCHE" en la hoja ${HOJA_VALORES}. ¿Cambiaron los encabezados?`);
  }
  for (const [clave, nombre] of [['porcentaje', 'PORCENTAJE'], ['sae', 'SAE']]) {
    if (col[clave] === undefined) throw errorDeArchivo(`En la hoja ${HOJA_VALORES} falta la columna "${nombre}".`);
  }

  const letra = (clave) => (col[clave] === undefined ? null : XLSX.utils.encode_col(col[clave]));
  const celda = (r, clave) => (col[clave] === undefined ? undefined : hoja[XLSX.utils.encode_cell({ r, c: col[clave] })]);
  const datos = (c) => (c ? { v: c.v === undefined ? null : c.v, f: c.f || null } : { v: null, f: null });

  const filas = [];
  const ocultas = [];
  let vacias = 0;
  for (let r = filaEncabezado + 1; r <= rango.e.r; r++) {
    const fila = r + 1;
    if (filaOculta(hoja, fila)) {
      ocultas.push(fila);
      continue;
    }
    const registro = {
      fila,
      rubro: textoDeCelda(celda(r, 'rubro')) || null,
      cod: textoDeCelda(celda(r, 'cod')) || null,
      descripcion: textoDeCelda(celda(r, 'descripcion')) || null,
      pase: datos(celda(r, 'pase')),
      porcentaje: datos(celda(r, 'porcentaje')),
      resultado: datos(celda(r, 'resultado')),
      sae: datos(celda(r, 'sae')),
    };
    const tieneAlgo = registro.rubro || registro.cod || registro.descripcion || (registro.pase.v !== null && registro.pase.v !== '');
    if (!tieneAlgo) {
      vacias++;
      continue;
    }
    filas.push(registro);
  }
  return { filas, ocultas, vacias, columnas: { pase: letra('pase'), sae: letra('sae'), porcentaje: letra('porcentaje') } };
}

/** Descripción de ficha: saltos de línea normalizados y sin espacios sobrantes. */
const normalizarDescripcion = (t) => String(t).replace(/\r\n?/g, '\n').replace(/[ \t]+\n/g, '\n').trim();

function leerPaginas(hoja, imagenesPorCelda, corridasPorCelda = new Map()) {
  const celdaTexto = (col, fila) => textoDeCelda(hoja[`${col}${fila}`]);
  const finFila = hoja['!ref'] ? XLSX.utils.decode_range(hoja['!ref']).e.r + 1 : 0;

  const eventos = [];
  const pies = [];
  for (let fila = 1; fila <= finFila; fila++) {
    if (filaOculta(hoja, fila)) continue;
    const enB = celdaTexto('B', fila);
    if (/^SAE\s*-/i.test(enB)) eventos.push({ fila, tipo: 'titulo', titulo: enB });
    else if (enB.toUpperCase() === 'CODIGO:') eventos.push({ fila, tipo: 'banda' });
    else if (/PRECIOS NO INCLUYEN/i.test(enB)) pies.push({ fila, texto: enB });
  }

  const paginas = [];
  let actual = null;
  const celdasDeItem = new Set();
  for (const evento of eventos) {
    if (evento.tipo === 'titulo') {
      actual = { orden: paginas.length + 1, titulo: evento.titulo, filaTitulo: evento.fila, logoGrande: false, bandas: [] };
      paginas.push(actual);
      continue;
    }
    if (!actual) continue;
    const m = evento.fila;
    const items = [];
    COLUMNAS_ITEM.forEach((col, i) => {
      const codigo = celdaTexto(col, m + 1);
      if (!codigo) return;
      const celdaImagen = `${col}${m + 2}`;
      celdasDeItem.add(celdaImagen);
      const descripcion = celdaTexto(col, m + 3);
      items.push({
        columna: i + 1,
        codigo,
        descripcion: descripcion ? normalizarDescripcion(descripcion) : null,
        corridas: corridasPorCelda.get(`${col}${m + 3}`) || null,
        celdaImagen,
        imagenRuta: imagenesPorCelda.get(celdaImagen) || null,
      });
    });
    if (items.length > 0) actual.bandas.push({ fila: m, items });
  }

  // Logos: imágenes en columna B que no pertenecen a un ítem y están visibles.
  const merges = hoja['!merges'] || [];
  const logos = [];
  const fotosSinItem = [];
  for (const [celda, ruta] of imagenesPorCelda) {
    const { r, c } = XLSX.utils.decode_cell(celda);
    const fila = r + 1;
    if (filaOculta(hoja, fila) || celdasDeItem.has(celda)) continue;
    if (c === 1) {
      const combinada = merges.find((mg) => mg.s.r === r && mg.s.c === c);
      logos.push({ fila, ruta, filasAlto: combinada ? combinada.e.r - combinada.s.r + 1 : 1 });
    } else {
      fotosSinItem.push({ celda, ruta });
    }
  }
  for (const pagina of paginas) {
    const previos = logos.filter((l) => l.fila < pagina.filaTitulo).sort((a, b) => b.fila - a.fila);
    pagina.logoGrande = previos.length > 0 && previos[0].filasAlto > 3;
  }

  const frecuencia = new Map();
  logos.forEach((l) => frecuencia.set(l.ruta, (frecuencia.get(l.ruta) || 0) + 1));
  const logo = [...frecuencia.entries()].sort((a, b) => b[1] - a[1])[0];

  return { paginas, pie: pies.length > 0 ? pies[0].texto : null, logoRuta: logo ? logo[0] : null, fotosSinItem, logosSueltos: logos };
}

const MESES = { enero: 1, febrero: 2, marzo: 3, abril: 4, mayo: 5, junio: 6, julio: 7, agosto: 8, septiembre: 9, setiembre: 9, octubre: 10, noviembre: 11, diciembre: 12 };

/** "válidos hasta el 15 de septiembre de 2026" → "2026-09-15" (o null si no se reconoce). */
function extraerFechaVigencia(pie) {
  const m = String(pie || '').match(/hasta el\s+(\d{1,2})\s+de\s+([a-záéíóú]+)\s+de\s+(\d{4})/i);
  if (!m) return null;
  const mes = MESES[m[2].toLowerCase()];
  if (!mes) return null;
  return `${m[3]}-${String(mes).padStart(2, '0')}-${String(Number(m[1])).padStart(2, '0')}`;
}

/**
 * Lee CATALOGO SAE.xlsx: la hoja VALORES (ítems y reglas), la hoja CATALOGO (páginas, ítems
 * publicados y sus fichas) y las imágenes. Ignora las filas ocultas de todas las hojas.
 */
function leerCatalogoExcel(ruta) {
  const libro = abrirLibro(ruta, { bookFiles: true, cellFormula: true, cellStyles: true, sheets: [HOJA_VALORES, HOJA_CATALOGO] });
  for (const nombre of [HOJA_VALORES, HOJA_CATALOGO]) {
    if (!libro.Sheets[nombre]) {
      throw errorDeArchivo(`El archivo no tiene una hoja "${nombre}". Hojas encontradas: ${libro.SheetNames.join(', ') || '(ninguna)'}.`);
    }
  }

  const valores = leerValores(libro.Sheets[HOJA_VALORES]);

  const rutaCatalogo = rutaDeHoja(libro, HOJA_CATALOGO);
  const imagenesPorCelda = resolverImagenesEnCelda({
    hojaXml: rutaCatalogo && texto(libro, rutaCatalogo),
    metadataXml: texto(libro, 'xl/metadata.xml'),
    richValueXml: texto(libro, 'xl/richData/rdrichvalue.xml'),
    estructuraXml: texto(libro, 'xl/richData/rdrichvaluestructure.xml'),
    richValueRelXml: texto(libro, 'xl/richData/richValueRel.xml'),
    relsXml: texto(libro, 'xl/richData/_rels/richValueRel.xml.rels'),
  });

  const hojaCatalogo = libro.Sheets[HOJA_CATALOGO];
  const corridasPorCelda = extraerCorridas(rutaCatalogo && texto(libro, rutaCatalogo), texto(libro, 'xl/sharedStrings.xml'));
  const catalogo = leerPaginas(hojaCatalogo, imagenesPorCelda, corridasPorCelda);
  const ocultasCatalogo = [];
  if (hojaCatalogo['!rows']) hojaCatalogo['!rows'].forEach((f, i) => f && f.hidden && ocultasCatalogo.push(i + 1));

  return {
    valores,
    paginas: catalogo.paginas,
    pie: catalogo.pie,
    fechaVigencia: extraerFechaVigencia(catalogo.pie),
    logoRuta: catalogo.logoRuta,
    fotosSinItem: catalogo.fotosSinItem,
    ocultas: { valores: valores.ocultas, catalogo: ocultasCatalogo },
    imagenes: {
      celdasConImagen: imagenesPorCelda.size,
      distintas: new Set(imagenesPorCelda.values()).size,
    },
    bytesDeImagen: (rutaZip) => contenido(libro, rutaZip),
  };
}

module.exports = { leerCatalogoExcel, resolverImagenesEnCelda, extraerFechaVigencia, normalizarDescripcion, parsearCorridas, extraerCorridas };
