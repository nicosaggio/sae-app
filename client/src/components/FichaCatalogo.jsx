/**
 * Ficha de un ítem tal como sale en el catálogo: el título en negrita y las medidas en normal, con los
 * mismos tramos (texto, negrita, tamaño) que se guardan al sembrar. Sin formato guardado cae al texto plano.
 */
export function FichaCatalogo({ corridas, texto }) {
  const tramos = corridas && corridas.length > 0 ? corridas : [{ t: texto || '', b: true, sz: 14 }];
  return (
    <div className="ficha-catalogo">
      {tramos.map((c, i) => (
        <span key={i} style={{ fontWeight: c.b ? 700 : 400, fontSize: `${Math.max(10, c.sz * 0.9)}px` }}>
          {c.t}
        </span>
      ))}
    </div>
  );
}

/** Los mismos tramos que arma el servidor a partir de { titulo, detalle }, para la vista previa al editar. */
export function corridasDeFicha({ titulo, detalle }) {
  const t = (titulo || '').replace(/\r\n?/g, '\n').trim();
  const d = (detalle || '').replace(/\r\n?/g, '\n').trim();
  const corridas = [];
  if (t) corridas.push({ t: d ? `${t}\n` : t, b: true, sz: 14 });
  if (d) corridas.push({ t: d, b: false, sz: 11 });
  return corridas;
}
