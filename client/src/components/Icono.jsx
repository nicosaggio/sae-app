// Íconos de trazo propio (24 px, sin librerías): sólo los que se usan hoy. Se agregan acá a medida que hagan falta.
const TRAZOS = {
  'arrow-l': <path d="M19 12H5M11 6l-6 6 6 6" />,
  search: (
    <>
      <circle cx="11" cy="11" r="6.5" />
      <path d="m20 20-4.2-4.2" />
    </>
  ),
  plus: <path d="M12 5v14M5 12h14" />,
  check: <path d="m5 12.5 4.5 4.5L19 7.5" />,
  x: <path d="M6 6l12 12M18 6 6 18" />,
  warn: (
    <>
      <path d="M12 4 2.8 19.5a1 1 0 0 0 .9 1.5h16.6a1 1 0 0 0 .9-1.5z" />
      <path d="M12 10v4.5M12 17.5v.01" />
    </>
  ),
  info: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5.5M12 7.5v.01" />
    </>
  ),
  'check-c': (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="m8 12.5 3 3 5-6" />
    </>
  ),
  'x-c': (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="m9 9 6 6M15 9l-6 6" />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </>
  ),
  download: <path d="M12 3v12M7 10.5l5 5 5-5M4 20h16" />,
  upload: <path d="M12 15V3M7 7.5l5-5 5 5M4 20h16" />,
  copy: (
    <>
      <rect x="8.5" y="8.5" width="12" height="12" rx="2" />
      <path d="M5 15.5h-.5A1.5 1.5 0 0 1 3 14V4.5A1.5 1.5 0 0 1 4.5 3H14a1.5 1.5 0 0 1 1.5 1.5V5" />
    </>
  ),
  pencil: (
    <>
      <path d="m4 20 1-4L16.5 4.5a2.1 2.1 0 0 1 3 3L8 19z" />
      <path d="m14.5 6.5 3 3" />
    </>
  ),
  trash: <path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" />,
  eye: (
    <>
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" />
      <circle cx="12" cy="12" r="3" />
    </>
  ),
  more: (
    <>
      <circle cx="5" cy="12" r="1.3" fill="currentColor" />
      <circle cx="12" cy="12" r="1.3" fill="currentColor" />
      <circle cx="19" cy="12" r="1.3" fill="currentColor" />
    </>
  ),
  ruler: (
    <>
      <path d="M3 17 17 3l4 4L7 21H3z" />
      <path d="m13.5 6.5 4 4M7 13l2 2M10 10l2 2" />
    </>
  ),
  undo: (
    <>
      <path d="M3.5 12a8.5 8.5 0 1 0 2.8-6.3L3.5 8.5" />
      <path d="M3.5 3.5v5h5" />
    </>
  ),
  list: <path d="M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01" />,
  'chev-r': <path d="m9 5 7 7-7 7" />,
  filter: <path d="M3 5h18l-7 8.5V20l-4-2v-4.5z" />,
};

/** Ícono decorativo: el texto del botón o del aviso es el que lee el lector de pantalla. */
export function Icono({ nombre, className = '' }) {
  return (
    <svg className={`icono ${className}`.trim()} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      {TRAZOS[nombre]}
    </svg>
  );
}
