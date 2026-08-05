import { useEffect, useRef, useState, useCallback } from 'react';

/** Ejecuta fetchFn ahora y luego cada intervaloMs, sin superponer llamadas. */
export function usePolling(fetchFn, intervaloMs = 8000, deps = []) {
  const [datos, setDatos] = useState(null);
  const [error, setError] = useState(null);
  const [cargando, setCargando] = useState(true);
  const enCursoRef = useRef(false);

  const ejecutar = useCallback(async () => {
    if (enCursoRef.current) return;
    enCursoRef.current = true;
    try {
      const resultado = await fetchFn();
      setDatos(resultado);
      setError(null);
    } catch (err) {
      setError(err);
    } finally {
      enCursoRef.current = false;
      setCargando(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  useEffect(() => {
    setCargando(true);
    ejecutar();
    const id = setInterval(ejecutar, intervaloMs);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ejecutar, intervaloMs]);

  return { datos, error, cargando, recargar: ejecutar };
}
