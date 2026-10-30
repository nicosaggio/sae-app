import { useCallback, useEffect, useRef, useState } from 'react';
import { Icono } from '../components/Icono';

/**
 * Un aviso breve de "se hizo" (por ejemplo "Cliente guardado") que se va solo a los pocos segundos.
 * Devuelve [nodo, mostrar]: el nodo se pone dentro de la pantalla (en un contenedor `.ed`) y `mostrar(texto)` lo dispara.
 */
export function useToast(milisegundos = 3500) {
  const [mensaje, setMensaje] = useState('');
  const temporizador = useRef(null);
  const mostrar = useCallback(
    (texto) => {
      setMensaje(texto);
      clearTimeout(temporizador.current);
      temporizador.current = setTimeout(() => setMensaje(''), milisegundos);
    },
    [milisegundos]
  );
  useEffect(() => () => clearTimeout(temporizador.current), []);
  const nodo = mensaje ? (
    <div className="toast" role="status">
      <Icono nombre="check-c" />
      {mensaje}
    </div>
  ) : null;
  return [nodo, mostrar];
}
