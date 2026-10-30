import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client';
import { CambiarLote } from './CambiarLote';
import { Icono } from './Icono';
import { PanelLateral } from './PanelLateral';
import { PresupuestoPanel } from './PresupuestoPanel';
import { Sello } from './Sello';

/**
 * El presupuesto confirmado abierto en un panel a la derecha (lo usan Presupuestos y Evento): el lote con su
 * "Cambiar n.º de lote", los datos del presupuesto y sus productos. Lee el presupuesto por su `presupuestoId`.
 *
 * `resumen` (opcional) tiene lo que ya se sabe de él ({ cod_fac, evento_nombre, lote_codigo, lote_expositor }) para
 * poner el encabezado enseguida, antes de que llegue el detalle. `onCambiado` avisa que cambió algo que se ve en
 * la lista de atrás (se agregó o quitó una línea, se cambió el lote, se borró); `onGuardado`, que se guardó un dato
 * suelto (por ejemplo el estado de cobro).
 */
export function PresupuestoPanelLateral({ presupuestoId, resumen, productos, onClose, onCambiado, onGuardado }) {
  const [presupuesto, setPresupuesto] = useState(null);
  const [cotizacionOrigen, setCotizacionOrigen] = useState(null);

  const cargar = useCallback(() => {
    api
      .get(`/presupuestos/${presupuestoId}`)
      .then(setPresupuesto)
      .catch((err) => {
        // Si lo acaban de borrar desde el propio panel (404) no queda nada que mostrar: se cierra
        // en vez de dejar el panel trabado en "Cargando…".
        if (err.status === 404) {
          onClose();
          onCambiado?.();
        } else {
          setPresupuesto(null);
        }
      });
  }, [presupuestoId, onClose, onCambiado]);

  useEffect(() => {
    cargar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [presupuestoId]);

  // Un presupuesto que se cargó desde la app enlaza a su versión original (PDF y adjuntos); al cambiar el lote
  // cambia su código de facturación, por eso se vuelve a leer también entonces.
  useEffect(() => {
    if (presupuesto?.origen !== 'app') {
      setCotizacionOrigen(null);
      return;
    }
    api
      .get(`/cotizaciones?presupuestoId=${presupuesto.id}`)
      .then((lista) => setCotizacionOrigen(lista[0] || null))
      .catch(() => setCotizacionOrigen(null));
  }, [presupuesto?.id, presupuesto?.origen, presupuesto?.lote_codigo]);

  function alCambiar() {
    cargar();
    onCambiado?.();
  }

  const base = presupuesto || resumen;
  const codFac = cotizacionOrigen?.cod_fac || (!presupuesto ? resumen?.cod_fac : null);

  return (
    <PanelLateral
      titulo="Presupuesto confirmado"
      onClose={onClose}
      cabecera={
        <>
          <div className="fila" style={{ gap: 'var(--s-2)', marginBottom: 6 }}>
            <Sello estado="confirmada" />
            {(presupuesto || codFac) && <span className="sub">{codFac ? `Cód. de facturación ${codFac}` : 'Sin código de facturación'}</span>}
          </div>
          {base && (
            <h2>
              {base.evento_nombre} · Lote {base.lote_codigo}
              {base.lote_expositor ? ` — ${base.lote_expositor}` : ''}
            </h2>
          )}
        </>
      }
      pie={
        <>
          <span className="ayuda">Los cambios se guardan solos.</span>
          <button type="button" className="boton boton--primario" onClick={onClose}>
            Listo
          </button>
        </>
      }
    >
      {!presupuesto ? (
        <div className="pila" aria-busy="true" aria-label="Cargando">
          {[1, 2, 3, 4].map((n) => (
            <div key={n} className="esqueleto" />
          ))}
        </div>
      ) : (
        <>
          {cotizacionOrigen && (
            <div className="aviso aviso--info">
              <Icono nombre="info" />
              <div className="aviso-cuerpo">
                Presupuesto cargado desde la app. <Link to={`/presupuestos/carga/${cotizacionOrigen.id}`}>Ver el presupuesto original (PDF y adjuntos)</Link>
              </div>
            </div>
          )}
          <CambiarLote presupuesto={presupuesto} onCambiado={alCambiar} />
          <PresupuestoPanel key={presupuesto.id} presupuesto={presupuesto} productos={productos} onCambiado={alCambiar} onGuardado={onGuardado} />
        </>
      )}
    </PanelLateral>
  );
}
