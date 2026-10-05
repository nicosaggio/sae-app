import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../api/client';

const SNAP = 0.1; // metros: redondea los clics a esta grilla para que quede prolijo
const CAMARA_W_MIN = 0.8;
const CAMARA_W_MAX = 100;
const COMENTARIOS_MAX = 1000; // el mismo tope que valida el servidor
const AGARRE_MIN = 0.3; // metros: tamaño mínimo del área donde se puede agarrar un bloque con el mouse

const snap = (v) => Math.round(v / SNAP) * SNAP;

/** Convierte un evento de mouse a coordenadas del SVG (en metros), sin redondear a la grilla. */
function puntoSvgCrudo(e, svgEl) {
  if (!svgEl) return { x: 0, y: 0 };
  const pt = svgEl.createSVGPoint();
  pt.x = e.clientX;
  pt.y = e.clientY;
  const ctm = svgEl.getScreenCTM();
  if (!ctm) return { x: 0, y: 0 };
  const local = pt.matrixTransform(ctm.inverse());
  return { x: local.x, y: local.y };
}

/** Igual que puntoSvgCrudo, pero redondeado a la grilla (para clics: marcar paredes, colocar materiales). */
function puntoSvg(e, svgEl) {
  const p = puntoSvgCrudo(e, svgEl);
  return { x: snap(p.x), y: snap(p.y) };
}

/** Caja que ocupa un material en el plano, en metros, ya rotada (sólo rotaciones de 90°). */
function cajaRotada(m) {
  const ancho = m.ancho ?? 0.3; // un dintel es una línea: profundidad 0 es válida, no "sin medida"
  const profundidad = m.profundidad ?? 0.3;
  const rot = ((m.rotacion || 0) % 360 + 360) % 360;
  const w = rot === 90 || rot === 270 ? profundidad : ancho;
  const h = rot === 90 || rot === 270 ? ancho : profundidad;
  const cx = m.x + ancho / 2;
  const cy = m.y + profundidad / 2;
  return [cx - w / 2, cy - h / 2, cx + w / 2, cy + h / 2];
}

const COLOR_COTA = '#0f766e';

/** Geometría de una cota alineada (misma cuenta que el PDF): mide de (x1,y1) a (x2,y2) y la línea de cota va `offset` metros (con signo) en perpendicular. */
function geometriaCota({ x1, y1, x2, y2, offset }) {
  const largo = Math.hypot(x2 - x1, y2 - y1);
  const ux = largo ? (x2 - x1) / largo : 1;
  const uy = largo ? (y2 - y1) / largo : 0;
  const nx = -uy;
  const ny = ux;
  return { largo, ux, uy, nx, ny, lado: offset < 0 ? -1 : 1, ax: x1 + nx * offset, ay: y1 + ny * offset, bx: x2 + nx * offset, by: y2 + ny * offset };
}

const textoCota = (largo) => `${largo.toFixed(2).replace('.', ',')} m`;

/** Distancia con signo (en metros, de a 5 cm) a la que va la línea de cota, según dónde está el mouse respecto de la recta a-b. Nunca pegada a lo medido. */
function offsetDesdeCursor(a, b, cursor) {
  const g = geometriaCota({ x1: a.x, y1: a.y, x2: b.x, y2: b.y, offset: 0 });
  let o = Number((Math.round(((cursor.x - a.x) * g.nx + (cursor.y - a.y) * g.ny) / 0.05) * 0.05).toFixed(3));
  if (Math.abs(o) < 0.1) o = o < 0 ? -0.1 : 0.1;
  return o;
}

const limpio = (v) => Math.round(v * 10000) / 10000; // saca el ruido de punto flotante (1.0499999999999998 -> 1.05)

/** Pasa un punto del símbolo (coordenadas locales) al plano: mismo giro que el dibujo, rotate(rotacion, ancho/2, profundidad/2) sobre translate(x, y). */
function aMundo(m, px, py) {
  const w = m.ancho || 0;
  const h = m.profundidad || 0;
  const rad = ((m.rotacion || 0) * Math.PI) / 180;
  const dx = px - w / 2;
  const dy = py - h / 2;
  return { x: m.x + w / 2 + dx * Math.cos(rad) - dy * Math.sin(rad), y: m.y + h / 2 + dx * Math.sin(rad) + dy * Math.cos(rad) };
}

/**
 * Puntos "enganchables" de un material, en metros del plano y ya rotado: el centro de cada círculo
 * de su símbolo ("centro": las columnas de un panel) y los extremos y el medio de sus líneas (un
 * dintel es una línea sola).
 */
function puntosDeReferencia(m, simbolo) {
  if (!simbolo) return [];
  const puntos = [];
  for (const path of simbolo.paths) {
    if (path.t === 'circle') {
      puntos.push({ ...aMundo(m, path.c_[0], path.c_[1]), tipo: 'centro' });
    } else if (path.t === 'line') {
      const [[x1, y1], [x2, y2]] = path.p;
      puntos.push({ ...aMundo(m, x1, y1), tipo: 'extremo' }, { ...aMundo(m, x2, y2), tipo: 'extremo' }, { ...aMundo(m, (x1 + x2) / 2, (y1 + y2) / 2), tipo: 'medio' });
    }
  }
  return puntos;
}

/**
 * Los puntos con los que un material se engancha al plano cuando se lo coloca o se lo mueve. Un
 * símbolo con `ancla` (el spot, que cuelga de la línea de un dintel) se engancha sólo por ese
 * punto; los demás, por sus puntos de referencia.
 */
function puntosPropios(m, simbolo) {
  if (simbolo?.ancla) return [{ ...aMundo(m, simbolo.ancla[0], simbolo.ancla[1]), tipo: 'ancla' }];
  return puntosDeReferencia(m, simbolo);
}

/** Segmentos (en el plano) de los materiales hechos sólo de líneas, como los dinteles: lo único a lo que se pueden apoyar los spots. */
function segmentosDeLinea(materialesArr, simbolos) {
  const segmentos = [];
  for (const m of materialesArr) {
    const simbolo = simbolos[m.codigo];
    if (!simbolo || simbolo.paths.length === 0 || !simbolo.paths.every((path) => path.t === 'line')) continue;
    for (const path of simbolo.paths) segmentos.push({ a: aMundo(m, path.p[0][0], path.p[0][1]), b: aMundo(m, path.p[1][0], path.p[1][1]) });
  }
  return segmentos;
}

/**
 * Los puntos a los que se imanta una cota o un material que se coloca o se mueve, como el "object
 * snap" de AutoCAD: puntas de pared y esquinas de materiales, más sus puntos de referencia
 * (centros de columna, extremos y medio de líneas).
 */
function puntosImantables(paredesArr, materialesArr, simbolos) {
  const puntos = [];
  for (const p of paredesArr) puntos.push({ x: p.x1, y: p.y1, tipo: 'extremo' }, { x: p.x2, y: p.y2, tipo: 'extremo' });
  for (const m of materialesArr) {
    const [x1, y1, x2, y2] = cajaRotada(m);
    puntos.push({ x: x1, y: y1, tipo: 'extremo' }, { x: x2, y: y1, tipo: 'extremo' }, { x: x2, y: y2, tipo: 'extremo' }, { x: x1, y: y2, tipo: 'extremo' });
    puntos.push(...puntosDeReferencia(m, simbolos[m.codigo]));
  }
  return puntos;
}

/**
 * El mejor enganche entre los puntos de lo que se está moviendo (`propios`) y los del plano
 * (`objetivos`): el par más cercano dentro de `tolerancia` metros. Un centro de columna le gana a
 * una esquina a distancia parecida (las columnas quedan pegadas a los paneles). Devuelve cuánto hay
 * que correr lo que se mueve para que el punto propio caiga exacto sobre el objetivo.
 */
function mejorEnganche(propios, objetivos, tolerancia) {
  let mejor = null;
  let mejorPuntaje = Infinity;
  for (const o of objetivos) {
    for (const p of propios) {
      const d2 = (o.x - p.x) ** 2 + (o.y - p.y) ** 2;
      if (d2 >= tolerancia * tolerancia) continue;
      const puntaje = o.tipo === 'centro' ? d2 * 0.1 : d2; // el centro gana salvo que el otro punto esté 3 veces más cerca
      if (puntaje < mejorPuntaje) {
        mejorPuntaje = puntaje;
        mejor = { dx: o.x - p.x, dy: o.y - p.y, objetivo: o };
      }
    }
  }
  return mejor;
}

/** El punto de un segmento a-b más cercano a p. */
function puntoMasCercano(p, a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const largo2 = dx * dx + dy * dy;
  const t = largo2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / largo2));
  return { x: a.x + t * dx, y: a.y + t * dy };
}

/**
 * Enganche de un material que se coloca o se mueve: primero a los puntos del plano (extremos, medio,
 * centros de columna) y, si no hay ninguno cerca, el ancla de un spot se apoya en el punto más
 * cercano de la línea de un dintel, deslizándose a lo largo de ella (como el "Cercano" de AutoCAD).
 */
function engancheMaterial(propios, objetivos, segmentos, tolerancia) {
  const enPunto = mejorEnganche(propios, objetivos, tolerancia);
  if (enPunto) return enPunto;
  let mejor = null;
  let mejorD2 = tolerancia * tolerancia;
  for (const p of propios) {
    if (p.tipo !== 'ancla') continue;
    for (const seg of segmentos) {
      const q = puntoMasCercano(p, seg.a, seg.b);
      const d2 = (q.x - p.x) ** 2 + (q.y - p.y) ** 2;
      if (d2 < mejorD2) {
        mejorD2 = d2;
        mejor = { p, seg, q };
      }
    }
  }
  if (!mejor) return null;

  // Sobre la línea se avanza de a 10 cm medidos desde el comienzo del segmento, para que las
  // posiciones queden prolijas (y no 2,6421 m).
  const { p, seg, q } = mejor;
  const largo = Math.hypot(seg.b.x - seg.a.x, seg.b.y - seg.a.y);
  const recorrido = Math.min(largo, snap(Math.hypot(q.x - seg.a.x, q.y - seg.a.y)));
  const punto = largo === 0 ? q : { x: seg.a.x + ((seg.b.x - seg.a.x) * recorrido) / largo, y: seg.a.y + ((seg.b.y - seg.a.y) * recorrido) / largo };
  return { dx: punto.x - p.x, dy: punto.y - p.y, objetivo: { x: punto.x, y: punto.y, tipo: 'linea' } };
}

/** Caja que contiene paredes + materiales + cotas, en metros, para encuadrar la vista. */
function calcularEncuadre(paredesArr, materialesArr, cotasArr = []) {
  let minX = 0;
  let minY = 0;
  let maxX = 6;
  let maxY = 4;
  for (const p of paredesArr) {
    minX = Math.min(minX, p.x1, p.x2);
    minY = Math.min(minY, p.y1, p.y2);
    maxX = Math.max(maxX, p.x1, p.x2);
    maxY = Math.max(maxY, p.y1, p.y2);
  }
  for (const m of materialesArr) {
    const radio = Math.max(m.ancho || 0, m.profundidad || 0);
    minX = Math.min(minX, m.x - radio);
    minY = Math.min(minY, m.y - radio);
    maxX = Math.max(maxX, m.x + (m.ancho || 0) + radio);
    maxY = Math.max(maxY, m.y + (m.profundidad || 0) + radio);
  }
  for (const c of cotasArr) {
    const g = geometriaCota(c);
    for (const [x, y] of [[g.ax, g.ay], [g.bx, g.by]]) {
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }
  const pad = 1;
  return { x: minX - pad, y: minY - pad, w: maxX - minX + pad * 2, h: maxY - minY + pad * 2 };
}

/** Dibuja los paths de un símbolo (ya en metros, con origen en 0,0 — ver server/src/data/croquisSimbolos.json). */
function SimboloSvg({ simbolo }) {
  return (
    <>
      {simbolo.paths.map((p, i) => {
        const color = p.c || '#000';
        if (p.t === 'line') {
          const [[x1, y1], [x2, y2]] = p.p;
          return <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} stroke={color} strokeWidth={1} vectorEffect="non-scaling-stroke" />;
        }
        if (p.t === 'poly') {
          const pts = p.p.map(([x, y]) => `${x},${y}`).join(' ');
          return p.closed ? (
            <polygon key={i} points={pts} fill="none" stroke={color} strokeWidth={1} vectorEffect="non-scaling-stroke" />
          ) : (
            <polyline key={i} points={pts} fill="none" stroke={color} strokeWidth={1} vectorEffect="non-scaling-stroke" />
          );
        }
        if (p.t === 'fill') {
          const pts = p.p.map(([x, y]) => `${x},${y}`).join(' ');
          return <polygon key={i} points={pts} fill={color} fillOpacity={0.55} stroke="none" />;
        }
        if (p.t === 'circle') {
          return <circle key={i} cx={p.c_[0]} cy={p.c_[1]} r={p.r} fill="none" stroke={color} strokeWidth={1} vectorEffect="non-scaling-stroke" />;
        }
        return null;
      })}
    </>
  );
}

/** Una cota: líneas de extensión, línea de cota con marcas oblicuas y la medida. `mpp` = metros por pixel de pantalla, para que el texto y las marcas no cambien de tamaño con el zoom. */
function CotaSvg({ cota, mpp, vistaPrevia = false, borrable = false, onBorrar }) {
  const g = geometriaCota(cota);
  if (g.largo < 0.01) return null;
  const hueco = 3 * mpp;
  const sobrante = 6 * mpp;
  const marca = 5 * mpp;
  const color = vistaPrevia ? '#14b8a6' : COLOR_COTA;
  const trazo = { stroke: color, strokeWidth: 1, vectorEffect: 'non-scaling-stroke', strokeDasharray: vistaPrevia ? '4,3' : undefined };
  const dx = ((g.ux + g.nx) / Math.SQRT2) * marca;
  const dy = ((g.uy + g.ny) / Math.SQRT2) * marca;

  // El texto se lee de izquierda a derecha o, en vertical, de abajo hacia arriba (como en AutoCAD).
  let angulo = (Math.atan2(g.uy, g.ux) * 180) / Math.PI;
  let lado = g.lado;
  if (angulo >= 90 - 1e-6 || angulo < -90 - 1e-6) {
    angulo += 180;
    lado = -lado;
  }

  return (
    <g style={{ pointerEvents: 'none' }}>
      <line x1={cota.x1 + g.nx * g.lado * hueco} y1={cota.y1 + g.ny * g.lado * hueco} x2={g.ax + g.nx * g.lado * sobrante} y2={g.ay + g.ny * g.lado * sobrante} {...trazo} />
      <line x1={cota.x2 + g.nx * g.lado * hueco} y1={cota.y2 + g.ny * g.lado * hueco} x2={g.bx + g.nx * g.lado * sobrante} y2={g.by + g.ny * g.lado * sobrante} {...trazo} />
      <line x1={g.ax} y1={g.ay} x2={g.bx} y2={g.by} {...trazo} />
      <line x1={g.ax - dx} y1={g.ay - dy} x2={g.ax + dx} y2={g.ay + dy} {...trazo} strokeWidth={1.5} />
      <line x1={g.bx - dx} y1={g.by - dy} x2={g.bx + dx} y2={g.by + dy} {...trazo} strokeWidth={1.5} />
      <text
        transform={`translate(${(g.ax + g.bx) / 2},${(g.ay + g.by) / 2}) rotate(${angulo}) scale(${mpp})`}
        x={0}
        y={lado > 0 ? 12 : -4}
        textAnchor="middle"
        fontSize={11}
        fontFamily="inherit"
        fill={color}
        stroke="#fff"
        strokeWidth={3}
        paintOrder="stroke"
        style={{ pointerEvents: borrable ? 'auto' : 'none', cursor: borrable ? 'pointer' : 'default', userSelect: 'none' }}
        onClick={borrable ? onBorrar : undefined}
      >
        {textoCota(g.largo)}
      </text>
    </g>
  );
}

/** Marcador del punto de enganche, como en AutoCAD: círculo en un centro de columna, cuadrado en esquinas, extremos y medios, y cruz cuando se apoya sobre una línea. */
function MarcaImantado({ punto, mpp, hueco = false }) {
  const comun = { fill: hueco ? 'none' : 'rgba(15,118,110,0.25)', stroke: COLOR_COTA, vectorEffect: 'non-scaling-stroke', style: { pointerEvents: 'none' } };
  if (punto.tipo === 'linea') {
    const r = 5 * mpp;
    return (
      <g style={{ pointerEvents: 'none' }}>
        <line x1={punto.x - r} y1={punto.y - r} x2={punto.x + r} y2={punto.y + r} stroke={COLOR_COTA} strokeWidth={2} vectorEffect="non-scaling-stroke" />
        <line x1={punto.x - r} y1={punto.y + r} x2={punto.x + r} y2={punto.y - r} stroke={COLOR_COTA} strokeWidth={2} vectorEffect="non-scaling-stroke" />
      </g>
    );
  }
  return punto.tipo === 'centro' ? (
    <circle cx={punto.x} cy={punto.y} r={5 * mpp} strokeWidth={1.5} {...comun} />
  ) : (
    <rect x={punto.x - 4 * mpp} y={punto.y - 4 * mpp} width={8 * mpp} height={8 * mpp} strokeWidth={1} {...comun} />
  );
}

function MiniSimbolo({ simbolo }) {
  const tam = Math.max(simbolo.ancho, simbolo.profundidad, 0.3) * 1.3;
  return (
    <svg viewBox={`${-tam * 0.15} ${-tam * 0.15} ${tam} ${tam}`} width={34} height={34}>
      <SimboloSvg simbolo={simbolo} />
    </svg>
  );
}

/** Paleta de materiales dibujables, agrupados por rubro, con buscador. */
function Paleta({ simbolos, busqueda, setBusqueda, itemParaColocar, setItemParaColocar }) {
  const q = busqueda.trim().toLowerCase();
  const porRubro = useMemo(() => {
    const grupos = {};
    for (const [codigo, s] of Object.entries(simbolos)) {
      if (q && !codigo.toLowerCase().includes(q) && !(s.descripcion || '').toLowerCase().includes(q)) continue;
      const rubro = s.rubro || 'Otros';
      if (!grupos[rubro]) grupos[rubro] = [];
      grupos[rubro].push({ codigo, ...s });
    }
    for (const lista of Object.values(grupos)) lista.sort((a, b) => a.codigo.localeCompare(b.codigo));
    return grupos;
  }, [simbolos, q]);

  return (
    <div className="card" style={{ maxHeight: 680, overflowY: 'auto', width: 320, flexShrink: 0 }}>
      <input placeholder="Buscar material…" value={busqueda} onChange={(e) => setBusqueda(e.target.value)} style={{ width: '100%', marginBottom: 10 }} />
      {Object.keys(porRubro).length === 0 && <p className="texto-suave">Sin resultados.</p>}
      {Object.entries(porRubro).map(([rubro, items]) => (
        <div key={rubro} style={{ marginBottom: 12 }}>
          <div className="texto-suave" style={{ fontWeight: 600, marginBottom: 6, fontSize: 12, textTransform: 'uppercase' }}>
            {rubro}
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {items.map((it) => (
              <button
                key={it.codigo}
                type="button"
                className={it.codigo === itemParaColocar ? 'primario' : undefined}
                title={it.descripcion}
                onClick={() => setItemParaColocar((actual) => (actual === it.codigo ? null : it.codigo))}
                style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, padding: '4px 6px', width: 70 }}
              >
                <MiniSimbolo simbolo={it} />
                <span style={{ fontSize: 10, lineHeight: 1.1 }}>{it.codigo}</span>
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

export function CroquisLotePage() {
  const { eventoId, loteId } = useParams();
  const svgRef = useRef(null);
  const arrastreRef = useRef(null);
  const paneoRef = useRef(null);
  const seleccionRectRef = useRef(null);
  const huboArrastreRectRef = useRef(false);
  const portapapelesRef = useRef([]);

  const [evento, setEvento] = useState(null);
  const [simbolos, setSimbolos] = useState({});
  const [paredes, setParedes] = useState([]);
  const [materiales, setMateriales] = useState([]);
  const [cotas, setCotas] = useState([]);
  const [comentarios, setComentarios] = useState('');
  const [existia, setExistia] = useState(false);
  const [cargando, setCargando] = useState(true);
  const [guardando, setGuardando] = useState(false);
  const [sinGuardar, setSinGuardar] = useState(false);
  const [error, setError] = useState('');
  const [aviso, setAviso] = useState('');

  const [modo, setModo] = useState('materiales'); // 'materiales' | 'paredes' | 'cotas'
  const [puntoEnCurso, setPuntoEnCurso] = useState(null);
  const [cotaEnCurso, setCotaEnCurso] = useState(null); // { a, b } mientras se marca una cota: b todavía no hay hasta el 2º click
  const [cursorCota, setCursorCota] = useState(null); // { crudo, imantado } del mouse sobre el plano, sólo en modo cotas
  const [busqueda, setBusqueda] = useState('');
  const [itemParaColocar, setItemParaColocar] = useState(null);
  const [seleccionados, setSeleccionados] = useState(() => new Set());
  const [rectSeleccion, setRectSeleccion] = useState(null);
  const [paneando, setPaneando] = useState(false);

  const [camara, setCamara] = useState({ x: -1, y: -1, w: 8 });
  const [aspecto, setAspecto] = useState(1.5);
  const [anchoPx, setAnchoPx] = useState(800);
  const mpp = camara.w / anchoPx; // metros por pixel de pantalla
  const [marcaEnganche, setMarcaEnganche] = useState(null); // punto del plano al que se está enganchando un material que se coloca o se mueve
  const [cursorColocar, setCursorColocar] = useState(null); // dónde caería el material que se está por colocar

  useEffect(() => {
    setCargando(true);
    Promise.all([api.get(`/eventos/${eventoId}`), api.get('/catalogo/croquis-simbolos'), api.get(`/lotes/${loteId}/croquis`)])
      .then(([ev, sim, cr]) => {
        setEvento(ev);
        setSimbolos(sim);
        const pr = cr ? cr.paredes : [];
        const ma = cr ? cr.materiales : [];
        const co = cr ? cr.cotas : [];
        if (cr) {
          setParedes(pr);
          setMateriales(ma);
          setCotas(co);
          setComentarios(cr.comentarios || '');
          setExistia(true);
        }
        const caja = calcularEncuadre(pr, ma, co);
        setCamara({ x: caja.x, y: caja.y, w: Math.max(caja.w, caja.h * 1.5) });
      })
      .catch((err) => setError(err.message))
      .finally(() => setCargando(false));
  }, [eventoId, loteId]);

  const lote = evento?.lotes.find((l) => l.id === Number(loteId));

  // Mantiene la proporción ancho/alto del SVG tal como se renderiza (para que 1m sea igual en X e Y).
  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const { width, height } = entries[0].contentRect;
      if (width > 0 && height > 0) {
        setAspecto(width / height);
        setAnchoPx(width);
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [cargando]);

  // Zoom con la rueda del mouse, centrado en el cursor (como en AutoCAD).
  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    function alRueda(e) {
      e.preventDefault();
      const crudo = puntoSvgCrudo(e, el);
      const factor = e.deltaY > 0 ? 1.12 : 1 / 1.12;
      setCamara((c) => {
        const nuevoW = Math.min(CAMARA_W_MAX, Math.max(CAMARA_W_MIN, c.w * factor));
        const alturaVieja = c.w / aspecto;
        const fracX = (crudo.x - c.x) / c.w;
        const fracY = (crudo.y - c.y) / alturaVieja;
        const nuevaAltura = nuevoW / aspecto;
        return { x: crudo.x - fracX * nuevoW, y: crudo.y - fracY * nuevaAltura, w: nuevoW };
      });
    }
    el.addEventListener('wheel', alRueda, { passive: false });
    return () => el.removeEventListener('wheel', alRueda);
  }, [aspecto]);

  // Arrastre de materiales (uno o en grupo), selección por rectángulo y paneo: se escuchan en toda
  // la ventana para no perder el movimiento si el mouse sale un instante del SVG.
  useEffect(() => {
    function alMover(e) {
      if (arrastreRef.current) {
        const { inicioMundo, base, propios, objetivos, segmentos } = arrastreRef.current;
        const actual = puntoSvgCrudo(e, svgRef.current);
        let dx = actual.x - inicioMundo.x;
        let dy = actual.y - inicioMundo.y;
        // Si algún punto de lo que se mueve queda cerca de uno del plano, se engancha exacto; si no, a la grilla.
        const enganche = engancheMaterial(propios.map((q) => ({ ...q, x: q.x + dx, y: q.y + dy })), objetivos, segmentos, 12 * mpp);
        if (enganche) {
          dx += enganche.dx;
          dy += enganche.dy;
        } else {
          dx = snap(dx);
          dy = snap(dy);
        }
        setMarcaEnganche(enganche ? enganche.objetivo : null);
        setMateriales((ms) => ms.map((m, i) => (base.has(i) ? { ...m, x: limpio(base.get(i).x + dx), y: limpio(base.get(i).y + dy) } : m)));
        return;
      }
      if (seleccionRectRef.current) {
        const p = puntoSvgCrudo(e, svgRef.current);
        seleccionRectRef.current.actual = p;
        setRectSeleccion({ inicio: seleccionRectRef.current.inicio, actual: p });
        return;
      }
      if (paneoRef.current) {
        const { startClientX, startClientY, camInicio, metrosPorPx } = paneoRef.current;
        const dxPx = e.clientX - startClientX;
        const dyPx = e.clientY - startClientY;
        setCamara({ x: camInicio.x - dxPx * metrosPorPx, y: camInicio.y - dyPx * metrosPorPx, w: camInicio.w });
      }
    }
    function alSoltar() {
      if (arrastreRef.current) {
        arrastreRef.current = null;
        setMarcaEnganche(null);
        setSinGuardar(true);
      }
      if (seleccionRectRef.current) {
        const { inicio, actual } = seleccionRectRef.current;
        const movimiento = Math.hypot(actual.x - inicio.x, actual.y - inicio.y);
        if (movimiento > 0.05) {
          const ventana = actual.x >= inicio.x; // izq→der: sólo lo que queda adentro; der→izq: lo que toca el rectángulo
          const rx1 = Math.min(inicio.x, actual.x);
          const rx2 = Math.max(inicio.x, actual.x);
          const ry1 = Math.min(inicio.y, actual.y);
          const ry2 = Math.max(inicio.y, actual.y);
          const nuevos = new Set();
          materiales.forEach((m, i) => {
            const [bx1, by1, bx2, by2] = cajaRotada(m);
            const dentro = bx1 >= rx1 && by1 >= ry1 && bx2 <= rx2 && by2 <= ry2;
            const cruza = bx1 <= rx2 && bx2 >= rx1 && by1 <= ry2 && by2 >= ry1;
            if (ventana ? dentro : cruza) nuevos.add(i);
          });
          setSeleccionados(nuevos);
          huboArrastreRectRef.current = true;
        } else {
          huboArrastreRectRef.current = false;
        }
        seleccionRectRef.current = null;
        setRectSeleccion(null);
      }
      if (paneoRef.current) {
        paneoRef.current = null;
        setPaneando(false);
      }
    }
    window.addEventListener('mousemove', alMover);
    window.addEventListener('mouseup', alSoltar);
    return () => {
      window.removeEventListener('mousemove', alMover);
      window.removeEventListener('mouseup', alSoltar);
    };
  }, [materiales, mpp]);

  useEffect(() => {
    function alTeclear(e) {
      const enCampo = document.activeElement && ['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName);
      const ctrl = e.ctrlKey || e.metaKey;
      if (e.key === 'Escape') {
        setItemParaColocar(null);
        setPuntoEnCurso(null);
        setCotaEnCurso(null);
        setSeleccionados(new Set());
        seleccionRectRef.current = null;
        setRectSeleccion(null);
      } else if ((e.key === 'Delete' || e.key === 'Backspace') && seleccionados.size > 0 && !enCampo) {
        e.preventDefault();
        borrarSeleccionados();
      } else if (e.key.toLowerCase() === 'r' && seleccionados.size > 0 && !enCampo) {
        rotarSeleccionados();
      } else if (ctrl && e.key.toLowerCase() === 'a' && !enCampo) {
        e.preventDefault();
        setSeleccionados(new Set(materiales.map((_, i) => i)));
      } else if (ctrl && e.key.toLowerCase() === 'c' && seleccionados.size > 0 && !enCampo) {
        copiarSeleccionados();
      } else if (ctrl && e.key.toLowerCase() === 'v' && portapapelesRef.current.length > 0 && !enCampo) {
        e.preventDefault();
        pegarPortapapeles();
      }
    }
    window.addEventListener('keydown', alTeclear);
    return () => window.removeEventListener('keydown', alTeclear);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seleccionados, materiales]);

  function alMouseDownFondo(e) {
    if (e.button === 1) {
      e.preventDefault();
      const rect = svgRef.current.getBoundingClientRect();
      paneoRef.current = { startClientX: e.clientX, startClientY: e.clientY, camInicio: { ...camara }, metrosPorPx: camara.w / rect.width };
      setPaneando(true);
      return;
    }
    if (e.button === 0 && modo === 'materiales' && !itemParaColocar) {
      const p = puntoSvgCrudo(e, svgRef.current);
      seleccionRectRef.current = { inicio: p, actual: p };
      setRectSeleccion({ inicio: p, actual: p });
    }
  }

  function alClickFondo(e) {
    if (huboArrastreRectRef.current) {
      huboArrastreRectRef.current = false;
      return;
    }
    if (modo === 'cotas') {
      avanzarCota(e);
      return;
    }
    const p = puntoSvg(e, svgRef.current);
    if (modo === 'paredes') {
      if (puntoEnCurso) {
        setParedes((ps) => [...ps, { x1: puntoEnCurso.x, y1: puntoEnCurso.y, x2: p.x, y2: p.y }]);
      }
      setPuntoEnCurso(p);
      setSinGuardar(true);
      return;
    }
    if (itemParaColocar) {
      const sim = simbolos[itemParaColocar];
      if (!sim) return;
      const { x, y } = posicionDeColocacion(puntoSvgCrudo(e, svgRef.current), itemParaColocar);
      const nuevo = { catalogo_item_id: sim.catalogo_item_id, bloque: sim.auxiliar ? itemParaColocar : null, codigo: itemParaColocar, descripcion: sim.descripcion, ancho: sim.ancho, profundidad: sim.profundidad, x, y, rotacion: 0 };
      setMateriales((ms) => [...ms, nuevo]);
      setSeleccionados(new Set([materiales.length]));
      setMarcaEnganche(null);
      setSinGuardar(true);
      return;
    }
    setSeleccionados(new Set());
  }

  function cambiarModo(nuevo) {
    setModo(nuevo);
    setCotaEnCurso(null);
    setCursorCota(null);
  }

  /** Punto del plano bajo el mouse para una cota: se imanta a esquinas de materiales y puntas de pared si hay una cerca; si no, a la grilla. */
  function puntoDeCota(e) {
    const crudo = puntoSvgCrudo(e, svgRef.current);
    const tolerancia = 12 * mpp;
    let mejor = null;
    let mejorPuntaje = Infinity;
    for (const pt of imantables) {
      const d2 = (pt.x - crudo.x) ** 2 + (pt.y - crudo.y) ** 2;
      if (d2 >= tolerancia * tolerancia) continue;
      // Entre los que están al alcance gana el más cercano, pero un centro de círculo le gana a una
      // esquina a distancia parecida (las columnas quedan pegadas a los paneles).
      const puntaje = pt.tipo === 'centro' ? d2 * 0.1 : d2;
      if (puntaje < mejorPuntaje) {
        mejorPuntaje = puntaje;
        mejor = { x: pt.x, y: pt.y, objeto: true, tipo: pt.tipo };
      }
    }
    return { crudo, imantado: mejor || { x: snap(crudo.x), y: snap(crudo.y), objeto: false } };
  }

  /** Dónde cae un material al colocarlo con el origen en `crudo`: enganchado a un punto del plano si hay uno cerca, o a la grilla. */
  function posicionDeColocacion(crudo, codigo) {
    const sim = simbolos[codigo];
    const candidato = { x: crudo.x, y: crudo.y, ancho: sim.ancho, profundidad: sim.profundidad, rotacion: 0 };
    const enganche = engancheMaterial(puntosPropios(candidato, sim), imantables, segmentosPlano, 12 * mpp);
    if (enganche) return { x: limpio(crudo.x + enganche.dx), y: limpio(crudo.y + enganche.dy), enganche: enganche.objetivo };
    return { x: snap(crudo.x), y: snap(crudo.y), enganche: null };
  }

  function alMoverSobreElPlano(e) {
    if (modo === 'cotas') {
      setCursorCota(puntoDeCota(e));
    } else if (modo === 'materiales' && itemParaColocar && simbolos[itemParaColocar]) {
      const pos = posicionDeColocacion(puntoSvgCrudo(e, svgRef.current), itemParaColocar);
      setCursorColocar(pos);
      setMarcaEnganche(pos.enganche);
    }
  }

  function alSalirDelPlano() {
    setCursorCota(null);
    setCursorColocar(null);
    setMarcaEnganche(null);
  }

  /** Cota en tres clicks, como en AutoCAD: primer punto, segundo punto y dónde va la línea de cota. */
  function avanzarCota(e) {
    const { crudo, imantado } = puntoDeCota(e);
    if (!cotaEnCurso) {
      setCotaEnCurso({ a: imantado, b: null });
      return;
    }
    if (!cotaEnCurso.b) {
      if (Math.hypot(imantado.x - cotaEnCurso.a.x, imantado.y - cotaEnCurso.a.y) < 0.05) return;
      setCotaEnCurso({ a: cotaEnCurso.a, b: imantado });
      return;
    }
    const { a, b } = cotaEnCurso;
    setCotas((cs) => [...cs, { x1: a.x, y1: a.y, x2: b.x, y2: b.y, offset: offsetDesdeCursor(a, b, crudo) }]);
    setCotaEnCurso(null);
    setSinGuardar(true);
  }

  function deshacerCota() {
    if (cotaEnCurso) {
      setCotaEnCurso(null);
      return;
    }
    setCotas((cs) => cs.slice(0, -1));
    setSinGuardar(true);
  }

  function borrarCota(index, e) {
    e.stopPropagation();
    setCotas((cs) => cs.filter((_, i) => i !== index));
    setSinGuardar(true);
  }

  function terminarPared() {
    setPuntoEnCurso(null);
  }

  function deshacerPared() {
    setParedes((ps) => ps.slice(0, -1));
    setPuntoEnCurso(null);
    setSinGuardar(true);
  }

  function borrarPared(index, e) {
    e.stopPropagation();
    if (modo !== 'paredes') return;
    setParedes((ps) => ps.filter((_, i) => i !== index));
    setSinGuardar(true);
  }

  function iniciarArrastre(e, index) {
    e.stopPropagation();
    if (itemParaColocar) return;
    if (e.shiftKey) {
      setSeleccionados((s) => {
        const copia = new Set(s);
        if (copia.has(index)) copia.delete(index);
        else copia.add(index);
        return copia;
      });
      return;
    }
    const grupo = seleccionados.has(index) && seleccionados.size > 1 ? seleccionados : new Set([index]);
    setSeleccionados(grupo);
    const inicioMundo = puntoSvgCrudo(e, svgRef.current);
    const base = new Map();
    grupo.forEach((i) => base.set(i, { x: materiales[i].x, y: materiales[i].y }));
    // Lo que se mueve se engancha a lo que queda quieto: los demás materiales y las paredes.
    const propios = [];
    grupo.forEach((i) => propios.push(...puntosPropios(materiales[i], simbolos[materiales[i].codigo])));
    const quietos = materiales.filter((_, i) => !grupo.has(i));
    arrastreRef.current = { inicioMundo, base, propios, objetivos: puntosImantables(paredes, quietos, simbolos), segmentos: segmentosDeLinea(quietos, simbolos) };
  }

  // Rota todo el grupo seleccionado como una sola pieza alrededor del centro de su caja conjunta
  // (no cada bloque sobre sí mismo): las posiciones relativas entre bloques también giran, como el
  // comando ROTATE de AutoCAD con varios objetos seleccionados. Con un solo bloque da lo mismo que
  // rotarlo sobre su propio centro, porque ahí la caja conjunta es la del bloque.
  function rotarSeleccionados() {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    seleccionados.forEach((i) => {
      const [bx1, by1, bx2, by2] = cajaRotada(materiales[i]);
      minX = Math.min(minX, bx1);
      minY = Math.min(minY, by1);
      maxX = Math.max(maxX, bx2);
      maxY = Math.max(maxY, by2);
    });
    const pivoteX = (minX + maxX) / 2;
    const pivoteY = (minY + maxY) / 2;

    setMateriales((ms) =>
      ms.map((m, i) => {
        if (!seleccionados.has(i)) return m;
        const centroX = m.x + (m.ancho || 0) / 2;
        const centroY = m.y + (m.profundidad || 0) / 2;
        // Rotación de 90° (sentido horario, igual que rotate(90) en SVG) alrededor del pivote.
        const nuevoCentroX = pivoteX - (centroY - pivoteY);
        const nuevoCentroY = pivoteY + (centroX - pivoteX);
        return {
          ...m,
          x: limpio(nuevoCentroX - (m.ancho || 0) / 2),
          y: limpio(nuevoCentroY - (m.profundidad || 0) / 2),
          rotacion: (m.rotacion + 90) % 360,
        };
      })
    );
    setSinGuardar(true);
  }

  function borrarSeleccionados() {
    setMateriales((ms) => ms.filter((_, i) => !seleccionados.has(i)));
    setSeleccionados(new Set());
    setSinGuardar(true);
  }

  function copiarSeleccionados() {
    portapapelesRef.current = [...seleccionados].map((i) => ({ ...materiales[i] }));
    setAviso(`${portapapelesRef.current.length} material(es) copiado(s). Ctrl+V para pegar.`);
  }

  function pegarPortapapeles() {
    const copiados = portapapelesRef.current;
    if (copiados.length === 0) return;
    const base = materiales.length;
    const nuevos = copiados.map((m) => ({ ...m, x: limpio(m.x + 0.4), y: limpio(m.y + 0.4) }));
    setMateriales((ms) => [...ms, ...nuevos]);
    setSeleccionados(new Set(nuevos.map((_, i) => base + i)));
    setSinGuardar(true);
  }

  function centrarVista() {
    const caja = calcularEncuadre(paredes, materiales, cotas);
    setCamara({ x: caja.x, y: caja.y, w: Math.max(caja.w, caja.h * aspecto) });
  }

  async function guardar() {
    setGuardando(true);
    setError('');
    setAviso('');
    try {
      await api.put(`/lotes/${loteId}/croquis`, {
        paredes,
        materiales: materiales.map((m) => ({ catalogo_item_id: m.catalogo_item_id, bloque: m.bloque, x: m.x, y: m.y, rotacion: m.rotacion })),
        cotas,
        comentarios,
      });
      setSinGuardar(false);
      setExistia(true);
      setAviso('Croquis guardado.');
    } catch (err) {
      setError(err.message);
    } finally {
      setGuardando(false);
    }
  }

  async function eliminarCroquis() {
    if (!confirm('¿Borrar todo el croquis de este lote? No se puede deshacer.')) return;
    setError('');
    try {
      await api.del(`/lotes/${loteId}/croquis`);
      setParedes([]);
      setMateriales([]);
      setCotas([]);
      setComentarios('');
      setPuntoEnCurso(null);
      setCotaEnCurso(null);
      setSeleccionados(new Set());
      setSinGuardar(false);
      setExistia(false);
      setAviso('Croquis eliminado.');
    } catch (err) {
      setError(err.message);
    }
  }

  const altura = camara.w / aspecto;
  const imantables = useMemo(() => puntosImantables(paredes, materiales, simbolos), [paredes, materiales, simbolos]);
  const segmentosPlano = useMemo(() => segmentosDeLinea(materiales, simbolos), [materiales, simbolos]);
  const cursor = modo === 'paredes' || modo === 'cotas' ? 'crosshair' : itemParaColocar ? 'copy' : paneando ? 'grabbing' : 'default';

  if (cargando) return <p className="texto-suave">Cargando…</p>;
  if (error && !evento) return <div className="aviso error">{error}</div>;

  return (
    <div>
      <p style={{ margin: '0 0 8px' }}>
        <Link to={`/eventos/${eventoId}`}>← Volver al evento</Link>
      </p>
      <h2 style={{ marginTop: 0 }}>
        Croquis — Lote {lote?.codigo}
        {lote?.expositor ? ` — ${lote.expositor}` : ''}
      </h2>

      {error && <div className="aviso error">{error}</div>}
      {aviso && <div className="aviso exito">{aviso}</div>}

      <div className="card">
        <div className="toolbar" style={{ justifyContent: 'space-between' }}>
          <div className="toolbar" style={{ marginBottom: 0 }}>
            <button className={modo === 'materiales' ? 'primario' : undefined} onClick={() => cambiarModo('materiales')}>
              Materiales
            </button>
            <button className={modo === 'paredes' ? 'primario' : undefined} onClick={() => cambiarModo('paredes')}>
              Paredes
            </button>
            <button className={modo === 'cotas' ? 'primario' : undefined} onClick={() => cambiarModo('cotas')} title="Acotar medidas sobre el plano">
              Cotas
            </button>
            <button onClick={centrarVista} title="Ajustar la vista a todo el contenido">
              Centrar vista
            </button>
            {modo === 'paredes' && (
              <>
                <span className="texto-suave">Click para ir marcando los puntos de la pared.</span>
                <button onClick={terminarPared} disabled={!puntoEnCurso}>
                  Terminar esta pared
                </button>
                <button onClick={deshacerPared} disabled={paredes.length === 0}>
                  Deshacer último segmento
                </button>
              </>
            )}
            {modo === 'cotas' && (
              <>
                <span className="texto-suave">
                  {!cotaEnCurso
                    ? 'Click en el primer punto a medir (se imanta a centros de columna, esquinas y puntas de pared).'
                    : !cotaEnCurso.b
                      ? 'Click en el segundo punto.'
                      : 'Mové el mouse y hacé click para ubicar la línea de cota.'}
                </span>
                <button onClick={deshacerCota} disabled={cotas.length === 0 && !cotaEnCurso}>
                  {cotaEnCurso ? 'Cancelar esta cota (Esc)' : 'Deshacer última cota'}
                </button>
              </>
            )}
            {modo === 'materiales' && itemParaColocar && (
              <span className="texto-suave">
                Colocando <strong>{itemParaColocar}</strong> — click en el plano (Esc para cancelar)
              </span>
            )}
          </div>
          <div className="toolbar" style={{ marginBottom: 0 }}>
            {sinGuardar && <span className="texto-suave">Hay cambios sin guardar</span>}
            <button className="primario" onClick={guardar} disabled={guardando}>
              {guardando ? 'Guardando…' : 'Guardar croquis'}
            </button>
            {existia && (
              <button className="peligro" onClick={eliminarCroquis}>
                Eliminar croquis
              </button>
            )}
          </div>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start', flexWrap: 'wrap' }}>
        {modo === 'materiales' && (
          <Paleta simbolos={simbolos} busqueda={busqueda} setBusqueda={setBusqueda} itemParaColocar={itemParaColocar} setItemParaColocar={setItemParaColocar} />
        )}

        <div className="card" style={{ position: 'relative', overflow: 'hidden', flex: 1, minWidth: 0 }}>
          {seleccionados.size > 0 && (
            <div
              style={{
                position: 'absolute',
                top: 30,
                left: 30,
                zIndex: 2,
                background: '#fff',
                border: '1px solid #ddd',
                borderRadius: 8,
                padding: 10,
                boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
                maxWidth: 240,
              }}
            >
              {seleccionados.size === 1 && materiales[[...seleccionados][0]] ? (
                <>
                  <strong>{materiales[[...seleccionados][0]].codigo}</strong>
                  <p className="texto-suave" style={{ margin: '4px 0' }}>
                    {materiales[[...seleccionados][0]].descripcion}
                  </p>
                </>
              ) : (
                <strong>{seleccionados.size} materiales seleccionados</strong>
              )}
              <div className="toolbar" style={{ marginBottom: 0, marginTop: 6, flexWrap: 'wrap' }}>
                <button onClick={rotarSeleccionados}>Rotar 90° (R)</button>
                <button onClick={copiarSeleccionados}>Copiar (Ctrl+C)</button>
                <button className="peligro" onClick={borrarSeleccionados}>
                  Quitar (Supr)
                </button>
              </div>
            </div>
          )}

          <svg
            ref={svgRef}
            viewBox={`${camara.x} ${camara.y} ${camara.w} ${altura}`}
            style={{ width: '100%', height: 620, background: '#fff', display: 'block', cursor }}
            onClick={alClickFondo}
            onMouseDown={alMouseDownFondo}
            onMouseMove={alMoverSobreElPlano}
            onMouseLeave={alSalirDelPlano}
          >
            <defs>
              <pattern id="grilla-croquis" width="1" height="1" patternUnits="userSpaceOnUse">
                <path d="M 1 0 L 0 0 0 1" fill="none" stroke="#eee" strokeWidth={0.01} />
              </pattern>
            </defs>
            <rect x={camara.x} y={camara.y} width={camara.w} height={altura} fill="url(#grilla-croquis)" />

            {paredes.map((p, i) => (
              <line
                key={i}
                x1={p.x1}
                y1={p.y1}
                x2={p.x2}
                y2={p.y2}
                stroke="#333"
                strokeWidth={3}
                strokeLinecap="round"
                vectorEffect="non-scaling-stroke"
                onClick={(e) => borrarPared(i, e)}
                style={{ cursor: modo === 'paredes' ? 'pointer' : 'default', pointerEvents: modo === 'paredes' ? 'auto' : 'none' }}
              />
            ))}
            {puntoEnCurso && <circle cx={puntoEnCurso.x} cy={puntoEnCurso.y} r={0.08} fill="var(--color-primario)" />}

            {materiales.map((m, i) => (
              <g
                key={i}
                transform={`translate(${m.x},${m.y}) rotate(${m.rotacion}, ${(m.ancho || 0) / 2}, ${(m.profundidad || 0) / 2})`}
                onMouseDown={(e) => iniciarArrastre(e, i)}
                onClick={(e) => e.stopPropagation()}
                // En modo paredes o cotas los clicks pasan "a través" de los materiales, para poder marcar puntos sobre ellos.
                style={{ cursor: 'move', pointerEvents: modo === 'materiales' ? 'auto' : 'none' }}
              >
                {/* Área de agarre invisible: sin ella, un símbolo hecho de líneas finas sólo se puede mover agarrando justo una línea. */}
                <rect
                  x={((m.ancho || 0) - Math.max(m.ancho || 0, AGARRE_MIN)) / 2}
                  y={((m.profundidad || 0) - Math.max(m.profundidad || 0, AGARRE_MIN)) / 2}
                  width={Math.max(m.ancho || 0, AGARRE_MIN)}
                  height={Math.max(m.profundidad || 0, AGARRE_MIN)}
                  fill="transparent"
                />
                {seleccionados.has(i) && (
                  <rect
                    x={-0.04}
                    y={-0.04}
                    width={(m.ancho || 0.3) + 0.08}
                    height={(m.profundidad || 0.3) + 0.08}
                    fill="none"
                    stroke="var(--color-primario)"
                    strokeWidth={2}
                    strokeDasharray="0.06,0.06"
                    vectorEffect="non-scaling-stroke"
                  />
                )}
                {simbolos[m.codigo] ? <SimboloSvg simbolo={simbolos[m.codigo]} /> : <rect width={m.ancho || 0.3} height={m.profundidad || 0.3} fill="none" stroke="#999" />}
              </g>
            ))}

            {modo === 'materiales' && itemParaColocar && cursorColocar && simbolos[itemParaColocar] && (
              <g transform={`translate(${cursorColocar.x},${cursorColocar.y})`} opacity={0.55} style={{ pointerEvents: 'none' }}>
                <SimboloSvg simbolo={simbolos[itemParaColocar]} />
              </g>
            )}
            {marcaEnganche && <MarcaImantado punto={marcaEnganche} mpp={mpp} />}
            {cotas.map((c, i) => (
              <CotaSvg key={i} cota={c} mpp={mpp} borrable={modo === 'cotas' && !cotaEnCurso} onBorrar={(e) => borrarCota(i, e)} />
            ))}
            {modo === 'cotas' && cursorCota && (
              <>
                {cotaEnCurso && !cotaEnCurso.b && (
                  <CotaSvg vistaPrevia mpp={mpp} cota={{ x1: cotaEnCurso.a.x, y1: cotaEnCurso.a.y, x2: cursorCota.imantado.x, y2: cursorCota.imantado.y, offset: 0.2 }} />
                )}
                {cotaEnCurso?.b && (
                  <CotaSvg vistaPrevia mpp={mpp} cota={{ x1: cotaEnCurso.a.x, y1: cotaEnCurso.a.y, x2: cotaEnCurso.b.x, y2: cotaEnCurso.b.y, offset: offsetDesdeCursor(cotaEnCurso.a, cotaEnCurso.b, cursorCota.crudo) }} />
                )}
                {!cotaEnCurso?.b && <MarcaImantado punto={cursorCota.imantado} mpp={mpp} hueco={!cursorCota.imantado.objeto} />}
              </>
            )}
            {cotaEnCurso && (
              <>
                <circle cx={cotaEnCurso.a.x} cy={cotaEnCurso.a.y} r={4 * mpp} fill={COLOR_COTA} style={{ pointerEvents: 'none' }} />
                {cotaEnCurso.b && <circle cx={cotaEnCurso.b.x} cy={cotaEnCurso.b.y} r={4 * mpp} fill={COLOR_COTA} style={{ pointerEvents: 'none' }} />}
              </>
            )}

            {rectSeleccion &&
              (() => {
                const { inicio, actual } = rectSeleccion;
                const x = Math.min(inicio.x, actual.x);
                const y = Math.min(inicio.y, actual.y);
                const w = Math.abs(actual.x - inicio.x);
                const h = Math.abs(actual.y - inicio.y);
                const ventana = actual.x >= inicio.x;
                return (
                  <rect
                    x={x}
                    y={y}
                    width={w}
                    height={h}
                    fill={ventana ? 'rgba(59,130,246,0.12)' : 'rgba(34,197,94,0.12)'}
                    stroke={ventana ? '#3b82f6' : '#22c55e'}
                    strokeWidth={1.5}
                    strokeDasharray={ventana ? undefined : '0.08,0.08'}
                    vectorEffect="non-scaling-stroke"
                  />
                );
              })()}
          </svg>
        </div>
      </div>
      <div className="card" style={{ marginTop: 16 }}>
        <div className="campo" style={{ marginBottom: 0 }}>
          <label htmlFor="comentarios-croquis">Comentarios del croquis (salen impresos a la derecha del croquis en el PDF)</label>
          <textarea
            id="comentarios-croquis"
            rows={3}
            maxLength={COMENTARIOS_MAX}
            placeholder="Aclaraciones para el armado…"
            value={comentarios}
            onChange={(e) => {
              setComentarios(e.target.value);
              setSinGuardar(true);
            }}
            style={{ width: '100%' }}
          />
          <div className="texto-suave" style={{ fontSize: 12, textAlign: 'right' }}>
            {comentarios.length}/{COMENTARIOS_MAX}
          </div>
        </div>
      </div>
      <p className="texto-suave" style={{ marginTop: 8 }}>
        {paredes.length} segmento(s) de pared, {materiales.length} material(es), {cotas.length} cota(s). La grilla es de 1 metro. Vista:{' '}
        {camara.w.toFixed(1)} m de ancho.
      </p>
      <p className="texto-suave" style={{ marginTop: 2, fontSize: 12 }}>
        Click: seleccionar · Click y arrastre sobre el plano: selección múltiple (de izquierda a derecha, sólo lo que queda adentro; de
        derecha a izquierda, lo que toca el rectángulo) · Shift+click: sumar/quitar de la selección · Rueda del mouse: zoom · Click
        central y arrastre: paneo · Ctrl+C / Ctrl+V: copiar y pegar · R: rotar · Supr: borrar · Esc: cancelar · Cotas: 3 clicks (punto,
        punto, ubicación de la línea); para borrar una cota, click sobre su medida
      </p>
    </div>
  );
}
