const { db, transaction } = require('../db/connection');
const { calcularPrecios, normalizarCodigo } = require('./catalogoPreciosService');
const { prepararItems } = require('./catalogoClasificador');
const { leerCatalogoExcel } = require('./catalogoExcelService');
const { leerBaseParche } = require('./catalogoImportService');
const { guardarImagen } = require('./catalogoImagenService');
const { errorHttp, leerAjustes, guardarBasePrecios } = require('./catalogoCalculoService');

const errorDeSiembra = (mensaje, status = 400) => errorHttp(status, mensaje);

const formatoPeso = (n) => (typeof n === 'number' ? `$${Math.round(n).toLocaleString('es-AR')}` : '—');

/** Texto corto de la regla, para el reporte. */
function describirRegla(regla) {
  const factor = (x) => (x !== undefined && x !== 1 ? ` ×${Math.round(x * 1e6) / 1e6}` : '');
  switch (regla.tipo) {
    case 'base':
      return `base (${regla.codigo_base})`;
    case 'derivado':
      return `derivado de ${regla.ref}${factor(regla.factor)}`;
    case 'razon':
      return `razón ${regla.ref} × ${regla.ref2} / ${regla.ref3}`;
    case 'proporcional':
      return `proporcional al SAE de ${regla.ref} × ${regla.num}/${regla.den}`;
    case 'manual':
      return regla.suma_adicional_pie ? `manual ${formatoPeso(regla.valor)} + pie` : `manual ${formatoPeso(regla.valor)}`;
    default:
      return 'sin precio';
  }
}

async function procesarImagenes(excel, plan, { carpetaImagenes, log }) {
  const resumen = { procesadas: 0, reutilizadas: 0, errores: [], bytesOriginal: 0, bytesFinal: 0 };
  const archivos = new Map();
  const pendientes = new Set(plan.items.map((i) => i.imagen_ruta).filter(Boolean));
  const total = pendientes.size + (excel.logoRuta ? 1 : 0);
  let hechas = 0;

  const procesar = async (ruta, conservarPng) => {
    hechas++;
    const bytes = excel.bytesDeImagen(ruta);
    if (!bytes) {
      resumen.errores.push(`${ruta}: no está dentro del archivo`);
      return;
    }
    try {
      const r = await guardarImagen(bytes, { conservarPng, carpeta: carpetaImagenes });
      archivos.set(ruta, r.archivo);
      if (r.reutilizada) resumen.reutilizadas++;
      else resumen.procesadas++;
      resumen.bytesOriginal += r.bytesOriginal;
      resumen.bytesFinal += r.bytesFinal;
    } catch (err) {
      resumen.errores.push(`${ruta}: ${err.message}`);
    }
    if (hechas % 10 === 0 || hechas === total) log(`  imágenes: ${hechas}/${total}`);
  };

  if (excel.logoRuta) await procesar(excel.logoRuta, true);
  for (const ruta of pendientes) await procesar(ruta, false);
  return { archivos, resumen };
}

/** Escribe el plan en la base. Todo o nada: si algo falla no queda nada a medias. */
function aplicarPlan({ plan, excel, baseParche, imagenes, ajustes, reemplazar, rutas }) {
  return transaction(() => {
    if (reemplazar) {
      // RESTRICT se chequea fila por fila: hay que soltar las dependencias entre ítems antes de borrarlos.
      db.exec(`DELETE FROM catalogo_posiciones; DELETE FROM catalogo_version_precios; DELETE FROM catalogo_paginas;
        UPDATE catalogo_items SET regla_item_ref_id = NULL, regla_item_ref2_id = NULL, regla_item_ref3_id = NULL;
        DELETE FROM catalogo_items;`);
    }

    const buscarProducto = db.prepare('SELECT id FROM productos WHERE upper(trim(codigo)) = ? ORDER BY id LIMIT 1');
    const insertarItem = db.prepare(
      `INSERT INTO catalogo_items (codigo, rubro, descripcion, descripcion_catalogo, descripcion_formato, unidad, regla_tipo, regla_codigo_base,
         regla_factor, regla_num, regla_den, valor_manual, suma_adicional_pie, porcentaje, publicado, imagen, producto_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    const ids = new Map();
    let productosEnlazados = 0;
    for (const item of plan.items) {
      const r = item.regla;
      const producto = buscarProducto.get(normalizarCodigo(item.codigo));
      if (producto) productosEnlazados++;
      const info = insertarItem.run(
        item.codigo, item.rubro, item.descripcion, item.descripcion_catalogo,
        item.descripcion_corridas ? JSON.stringify(item.descripcion_corridas) : null, item.unidad, r.tipo,
        r.tipo === 'base' ? r.codigo_base : null,
        r.factor ?? null, r.num ?? null, r.den ?? null, r.valor ?? null, r.suma_adicional_pie ? 1 : 0,
        item.porcentaje, item.publicado ? 1 : 0,
        item.imagen_ruta ? imagenes.archivos.get(item.imagen_ruta) || null : null,
        producto ? producto.id : null
      );
      ids.set(normalizarCodigo(item.codigo), Number(info.lastInsertRowid));
    }

    const actualizarRefs = db.prepare('UPDATE catalogo_items SET regla_item_ref_id = ?, regla_item_ref2_id = ?, regla_item_ref3_id = ? WHERE id = ?');
    const idDe = (codigo) => (codigo ? ids.get(normalizarCodigo(codigo)) : null) ?? null;
    for (const item of plan.items) {
      const r = item.regla;
      if (r.ref) actualizarRefs.run(idDe(r.ref), idDe(r.ref2), idDe(r.ref3), ids.get(normalizarCodigo(item.codigo)));
    }

    // La app se acuerda de la última base parche cargada: con eso recalcula al crear versiones o editar reglas.
    guardarBasePrecios(baseParche);

    const general = db.prepare('SELECT * FROM catalogo_versiones WHERE es_general = 1').get();
    const filas = db.prepare('SELECT * FROM catalogo_items').all();
    const resultados = calcularPrecios(filas, {
      precioBase: baseParche.precios,
      porcentajeGlobal: general.porcentaje_global,
      aplicarATodos: Boolean(general.aplicar_a_todos),
      multiplo: ajustes.multiplo,
      adicionalPie: ajustes.adicionalPie,
    });

    const guardarPrecio = db.prepare(
      `UPDATE catalogo_items SET pase_parche = ?, sae = ?, estado_precio = ?, motivo_precio = ?, actualizado_en = datetime('now') WHERE id = ?`
    );
    const guardarFoto = db.prepare(
      'INSERT INTO catalogo_version_precios (version_id, item_id, pase_parche, porcentaje, sae, estado_precio) VALUES (?, ?, ?, ?, ?, ?)'
    );
    for (const [id, r] of resultados) {
      guardarPrecio.run(r.pase_parche, r.sae, r.estado, r.motivo, id);
      guardarFoto.run(general.id, id, r.pase_parche, r.porcentaje, r.sae, r.estado);
    }

    // Verificación contra el SAE que hoy calcula el Excel.
    const verificacion = { coinciden: 0, difieren: [], sinReferencia: 0 };
    for (const item of plan.items) {
      if (item.sae_excel === null) {
        verificacion.sinReferencia++;
        continue;
      }
      const r = resultados.get(ids.get(normalizarCodigo(item.codigo)));
      const bien = item.sae_excel === 0 ? r.estado === 'sin_precio' : r.estado === 'ok' && r.sae === item.sae_excel;
      if (bien) verificacion.coinciden++;
      else verificacion.difieren.push({ codigo: item.codigo, sae_excel: item.sae_excel, sae_app: r.sae, estado: r.estado, motivo: r.motivo });
    }

    // Páginas y posiciones
    const avisos = [...plan.avisos];
    const insertarPagina = db.prepare('INSERT INTO catalogo_paginas (orden, titulo, logo_grande) VALUES (?, ?, ?)');
    const insertarPosicion = db.prepare('INSERT INTO catalogo_posiciones (pagina_id, banda, columna, item_id) VALUES (?, ?, ?, ?)');
    let posiciones = 0;
    for (const pagina of excel.paginas) {
      const paginaId = Number(insertarPagina.run(pagina.orden, pagina.titulo, pagina.logoGrande ? 1 : 0).lastInsertRowid);
      pagina.bandas.forEach((banda, i) => {
        if (i > 1) {
          avisos.push(`La página ${pagina.orden} tiene más de 2 bandas: se ignoró la banda ${i + 1}`);
          return;
        }
        for (const it of banda.items) {
          const itemId = ids.get(normalizarCodigo(it.codigo));
          if (!itemId) continue;
          insertarPosicion.run(paginaId, i + 1, it.columna, itemId);
          posiciones++;
        }
      });
    }

    // Ajustes: logo y fecha de vigencia tal como están hoy en el catálogo impreso
    const guardarAjuste = db.prepare(
      `INSERT INTO catalogo_ajustes (clave, valor) VALUES (?, ?)
       ON CONFLICT(clave) DO UPDATE SET valor = excluded.valor, actualizado_en = datetime('now')`
    );
    const logo = excel.logoRuta ? imagenes.archivos.get(excel.logoRuta) : null;
    if (logo) guardarAjuste.run('logo_imagen', logo);
    else avisos.push('No se pudo guardar el logo: el PDF va a salir sin logo hasta que se cargue');
    let vigencia = ajustes.fechaVigencia;
    if (excel.fechaVigencia && excel.fechaVigencia !== ajustes.fechaVigencia) {
      guardarAjuste.run('fecha_vigencia', excel.fechaVigencia);
      db.prepare('UPDATE catalogo_versiones SET fecha_vigencia = ? WHERE es_general = 1').run(excel.fechaVigencia);
      vigencia = excel.fechaVigencia;
    }

    const clasificacion = {};
    plan.items.forEach((i) => {
      clasificacion[i.regla.tipo] = (clasificacion[i.regla.tipo] || 0) + 1;
    });
    const estados = {};
    for (const r of resultados.values()) estados[r.estado] = (estados[r.estado] || 0) + 1;

    const reporte = {
      generado: new Date().toISOString(),
      archivos: rutas,
      totales: {
        itemsImportados: plan.items.length,
        itemsPublicados: plan.items.filter((i) => i.publicado).length,
        paginas: excel.paginas.length,
        posiciones,
        productosEnlazados,
        filasSalteadas: plan.salteadas.length,
        vigencia,
      },
      clasificacion,
      estadosDePrecio: estados,
      verificacion,
      difierenDeBaseParche: plan.items
        .filter((i) => i.difiere_bdatos)
        .map((i) => ({ codigo: i.codigo, regla: describirRegla(i.regla), valor_en_catalogo: i.pase_excel, valor_en_base_parche: i.valor_bdatos })),
      salteadas: plan.salteadas,
      notas: plan.notas,
      avisos,
      filasOcultasIgnoradas: excel.ocultas,
      imagenes: {
        celdasConImagen: excel.imagenes.celdasConImagen,
        archivosDistintos: excel.imagenes.distintas,
        procesadas: imagenes.resumen.procesadas,
        reutilizadas: imagenes.resumen.reutilizadas,
        errores: imagenes.resumen.errores,
        fotosSinItem: excel.fotosSinItem,
        pesoOriginalMB: Math.round((imagenes.resumen.bytesOriginal / 1048576) * 10) / 10,
        pesoFinalMB: Math.round((imagenes.resumen.bytesFinal / 1048576) * 10) / 10,
      },
      items: plan.items.map((i) => {
        const r = resultados.get(ids.get(normalizarCodigo(i.codigo)));
        return {
          fila: i.fila,
          codigo: i.codigo,
          rubro: i.rubro,
          regla: describirRegla(i.regla),
          codigo_tomado_de_base_parche: i.origen_codigo === 'base_parche',
          porcentaje: i.porcentaje,
          publicado: i.publicado,
          pase_parche: r.pase_parche,
          sae_excel: i.sae_excel,
          sae_app: r.sae,
          estado: r.estado,
          motivo: r.motivo,
          difiere_de_base_parche: i.difiere_bdatos,
          avisos: i.avisos,
        };
      }),
    };

    db.prepare('INSERT INTO catalogo_importaciones (archivo, usuario_id, items_afectados, resumen_json) VALUES (?, NULL, ?, ?)')
      .run('Siembra inicial: CATALOGO SAE.xlsx', plan.items.length, JSON.stringify(reporte));
    return reporte;
  });
}

/**
 * Siembra inicial del catálogo desde CATALOGO SAE.xlsx + la base parche.
 * Se corre una vez, por línea de comandos (el Excel pesa más de 100 MB: no se sube por HTTP).
 * @param opciones.reemplazar  borra los ítems/páginas actuales y vuelve a sembrar
 * @param opciones.hacerBackup función async que respalda la base antes de escribir
 */
async function sembrarCatalogo({ rutaCatalogo, rutaBaseParche, reemplazar = false, hacerBackup = null, carpetaImagenes, log = () => {} }) {
  const existentes = db.prepare('SELECT COUNT(*) AS n FROM catalogo_items').get().n;
  if (existentes > 0 && !reemplazar) {
    throw errorDeSiembra(
      `El catálogo ya tiene ${existentes} ítems. La siembra es inicial: para volver a sembrar (y perder los cambios hechos a mano) agregá --reemplazar.`
    );
  }

  log('Leyendo la base parche...');
  const baseParche = leerBaseParche(rutaBaseParche);
  log('Leyendo CATALOGO SAE.xlsx (pesa más de 100 MB, tarda unos segundos)...');
  const excel = leerCatalogoExcel(rutaCatalogo);

  const ajustes = leerAjustes();
  const plan = prepararItems({ valores: excel.valores, paginas: excel.paginas, baseParche, ajustes });
  log(`Ítems a importar: ${plan.items.length} (${plan.salteadas.length} filas salteadas)`);

  log('Procesando imágenes...');
  const imagenes = await procesarImagenes(excel, plan, { carpetaImagenes, log });

  if (hacerBackup) {
    log('Haciendo backup de la base...');
    await hacerBackup();
  }

  log('Escribiendo en la base...');
  return aplicarPlan({ plan, excel, baseParche, imagenes, ajustes, reemplazar, rutas: { catalogo: rutaCatalogo, baseParche: rutaBaseParche } });
}

const celdaCsv = (v) => {
  if (v === null || v === undefined) return '';
  const t = String(v).replace(/\r?\n/g, ' ');
  return /[;"]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
};

/** CSV para abrir en Excel es-AR (separador ; y BOM). */
function reporteACsv(reporte) {
  const columnas = ['fila', 'codigo', 'rubro', 'regla', 'pase_parche', 'porcentaje', 'sae_excel', 'sae_app', 'estado', 'publicado', 'difiere_de_base_parche', 'codigo_tomado_de_base_parche', 'avisos'];
  const lineas = [columnas.join(';')];
  for (const item of reporte.items) {
    lineas.push(columnas.map((c) => celdaCsv(c === 'avisos' ? item.avisos.join(' | ') : item[c])).join(';'));
  }
  return `﻿${lineas.join('\r\n')}\r\n`;
}

module.exports = { sembrarCatalogo, aplicarPlan, procesarImagenes, describirRegla, reporteACsv, leerAjustes };
