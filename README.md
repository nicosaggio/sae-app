# SAE-APP — Presupuestos de eventos

Aplicación web interna para gestionar presupuestos de expositores por evento: calendario,
estado de facturación/cobro, totales por rubro, export a PDF y un import automático de los
presupuestos confirmados en Excel. Pensada para la red local de la oficina (no requiere
internet).

## Stack

- Backend: Node.js + Express, con el módulo `node:sqlite` incorporado en Node (sin
  dependencias nativas que compilar en Windows).
- Frontend: React + Vite, compilado a estático y servido por el mismo proceso de Express.
- Base de datos: un único archivo SQLite en `server/data/saeapp.db`.

## Requisitos

- Node.js 22.5 o superior instalado en la PC que hace de servidor
  (https://nodejs.org/).

---

## 1) Instalación inicial (una sola vez)

Abrí una consola (`cmd` o PowerShell) en la carpeta del proyecto y ejecutá:

```bash
npm install
npm run build
```

- `npm install` instala las dependencias del backend y del frontend.
- `npm run build` genera la versión de producción del frontend en `client/dist`, que después
  el propio servidor Express sirve junto con la API.

La primera vez que se inicia el servidor, se crean automáticamente:
- El archivo de base de datos `server/data/saeapp.db` con todas las tablas.
- Un usuario administrador inicial: **usuario `admin`, contraseña `admin123`**.

Apenas puedas ingresar como `admin`, entrá a **"Usuarios"** (menú lateral, solo visible para
administradores) y creá un usuario para cada persona que va a usar el sistema, y cambiá la
contraseña del `admin`.

---

## 2) Cómo levantar el servidor

### Opción A — doble clic (la más simple)

Hacé doble clic en **`iniciar-servidor.cmd`** (en la carpeta raíz del proyecto). Se abre una
ventana de consola que queda corriendo mientras el servidor está activo. **No la cierres**
mientras se esté usando la aplicación.

### Opción B — desde la consola

```bash
npm start
```

En cualquiera de los dos casos vas a ver:

```
SAE-APP escuchando en http://0.0.0.0:4001
```

Eso significa que el servidor está activo en el puerto **4001**, en todas las interfaces de
red de la PC.

> Durante desarrollo (para tocar código) se usan `npm run dev:server` (puerto 4001) y
> `npm run dev:client` (Vite, puerto 5173) por separado. Para uso normal del día a día, con
> `npm start` alcanza — sirve todo desde el puerto 4001.

### Cómo saber la IP local de esta PC (para que se conecten las demás)

```bash
ipconfig
```

Buscá **"Dirección IPv4"** del adaptador que estés usando (Wi-Fi o Ethernet), algo como
`192.168.1.18`.

---

## 3) Abrir el puerto en el Firewall de Windows

```powershell
New-NetFirewallRule -DisplayName "SAE-APP puerto 4001" -Direction Inbound -Protocol TCP -LocalPort 4001 -Action Allow
```

(O manualmente: Firewall de Windows Defender con seguridad avanzada → Reglas de entrada →
Nueva regla → Puerto → TCP 4001 → Permitir conexión.)

---

## 4) Cómo conectarse desde las otras computadoras

```
http://IP_DE_LA_PC_SERVIDOR:4001
```

---

## 5) Arranque automático al reiniciar Windows (Programador de Tareas)

1. **Programador de tareas** → **Biblioteca del Programador de tareas** → **Crear tarea…**
2. **General**: nombre `SAE-APP`, marcá "Ejecutar tanto si el usuario inició sesión como si
   no" y "Ejecutar con los privilegios más altos".
3. **Desencadenadores** → Nuevo → "Al iniciar el sistema".
4. **Acciones** → Nueva → "Iniciar un programa" → seleccioná
   `iniciar-servidor.cmd` dentro de la carpeta del proyecto.
5. **Condiciones**: desmarcá "Iniciar solo si el equipo funciona con corriente alterna" si
   es una PC de escritorio.
6. Aceptar (pide la contraseña de Windows para poder correr sin sesión abierta).

Para probar sin reiniciar: click derecho en la tarea `SAE-APP` → **Ejecutar**, y confirmá
`http://localhost:4001` en el navegador de esa PC.

---

## 6) Backups de la base de datos

Backup automático **todos los días a las 3:00 AM** (con el servidor prendido a esa hora) en
`server/data/backups/`, conservando los últimos 30. Cada uno es un `.db` independiente que se
puede copiar aparte como respaldo extra.

> **Las fotos del catálogo no entran en este backup** (solo se copia el `.db`). Ver la
> sección 8.5.

---

## 7) Import automático de presupuestos

El servidor revisa cada 10 minutos la carpeta de red configurada en `server/.env`
(`SAE_IMPORT_DIR`, por defecto
`\\ARQ01\ANSELMI Trabajos\TRABAJOS 2026\SAE\PRESUPUESTOS EXCEL\CONFIRMADO`), lee cada Excel
de presupuesto confirmado y crea/actualiza el lote y presupuesto correspondiente (agrupando
por evento según el nombre del EXPO). Requiere que la PC servidor tenga acceso de lectura a
esa carpeta con la cuenta de Windows que corre el servidor.

**"Importaciones"** (menú lateral) muestra lo que necesita revisión humana:
- **Eventos sin fecha**: se creó el evento automáticamente porque el EXPO del archivo no
  existía todavía — falta completar lugar y fechas reales.
- **Nombres de evento ambiguos**: el EXPO matchea más de un evento (pasa con expos que se
  repiten en el año, ej. la misma feria en dos fechas distintas) — hay que elegir cuál es.
- **Posibles reemplazos**: un archivo desapareció de la carpeta y apareció uno nuevo para el
  mismo lote — puede ser una revisión del mismo presupuesto o dos presupuestos distintos.

Hay un botón **"Escanear ahora"** para forzar una revisión sin esperar los 10 minutos. Si la
carpeta de red no responde, el escaneo simplemente reintenta en el siguiente ciclo.

---

## 8) Catálogo SAE: precios y PDF

Menú lateral **"Catálogo"**. Calcula los precios del catálogo SAE a partir de la base parche
(`$ CLIENTE` de la hoja `BDatos`), los recalcula cuando se carga una base nueva y exporta el
catálogo a PDF con el mismo diseño del Excel. Permite además tener **versiones** del mismo
catálogo con otro porcentaje para un evento puntual.

Quién puede qué:
- Los usuarios que pueden escribir editan ítems, páginas, versiones y televisores.
- Solo el **administrador** carga una base parche nueva (pestaña "Base parche") y cambia los
  "Ajustes".
- Los usuarios de solo estado no ven "Catálogo" en el menú; si abren la dirección a mano, lo
  ven en modo lectura.

Pestañas: **Vista** (páginas como en el PDF, selector de versión y "Exportar PDF"),
**Ítems**, **Versiones**, **Televisores**, **Base parche** (solo admin) y **Ajustes**.

### 8.1) Al actualizar la aplicación (una sola vez)

Este módulo agrega dependencias (procesamiento de imágenes y subida de archivos), así que en la
PC servidor hay que correr de nuevo:

```bash
npm install
npm run build
```

y reiniciar el servidor. La migración `0008_catalogo.sql` (tablas del catálogo) se aplica sola
al arrancar. Sin `npm run build` no aparecen las pantallas nuevas.

### 8.2) Carga inicial desde el Excel (una sola vez)

`CATALOGO SAE.xlsx` pesa más de 100 MB, así que no se sube desde el navegador: se carga con un
comando en la consola, pasándole **las dos rutas** (el catálogo y la base parche):

```bash
npm run seed:catalogo --workspace=server -- "C:\ruta\CATALOGO SAE.xlsx" "C:\ruta\26_BASE PARCHE_P (1).xlsx"
```

- Tarda unos minutos (procesa las ~110 fotos). Conviene correrlo con poca gente usando la app.
- **Antes de escribir hace un backup de la base** (`server/data/backups/`) y no modifica los
  Excel.
- Ignora las filas ocultas del Excel y saltea los duplicados y las filas sin equivalente; cada
  decisión queda en el reporte.
- Es una carga **inicial**: si el catálogo ya tiene ítems, se niega a correr. Con
  `--reemplazar` borra los ítems y las páginas actuales y vuelve a sembrar, **perdiendo los
  cambios hechos a mano**.
- Al terminar imprime un reporte y lo deja en `server/data/reporte-siembra-catalogo.csv`
  (una fila por ítem) y `.json`. El mismo reporte se ve en la app: **Catálogo → Base parche →
  Historial → "Ver reporte"**. Lo importante para revisar:
  - *Difieren de la base parche*: ítems cuyo precio en el catálogo no coincide con el de
    `BDatos`. Se dejaron con su regla actual para no cambiar precios sin que lo decidas.
  - *Filas salteadas* y *Avisos*.
  - La comparación de cada precio calculado contra el SAE que tenía el Excel.

### 8.3) Actualizar los precios cuando hay una base parche nueva

1. **Catálogo → Base parche** (como administrador) y elegí el Excel (`.xlsx` o `.xlsm`, hasta
   20 MB, hoja `BDatos`). Tocá **"Revisar cambios"**.
2. Se muestra el reporte **sin guardar nada**: ítems que cambian de precio, variaciones
   grandes, códigos que ya no están en la base, ítems que pierden precio y cuántas versiones
   se recalculan. La revisión vale 30 minutos; si subís otro archivo, reemplaza a la anterior.
3. Si está bien, **"Confirmar y aplicar"**. Recién ahí se hace un **backup de la base**, se
   guardan los precios nuevos y se recalculan la versión General **y todas las versiones de
   evento**. Queda registrado en el historial (archivo, usuario y reporte).

La aplicación recuerda la última base cargada. Si un código aparece vacío, con texto o en cero
en `BDatos`, el ítem queda **sin precio** ("S / P"); si el código directamente desapareció de
la base, queda con **error de precio**. En ambos casos se marca en el reporte en vez de
calcularse mal. Los ítems que dependen de uno con error quedan también con error, y los que
dependen de uno sin precio quedan sin precio.

### 8.4) Armar una versión para un evento

1. **Catálogo → Versiones → "Nueva versión para un evento"**: nombre, porcentaje (por ejemplo
   `55` para 55 %), vigencia y, si querés, un pie legal propio.
2. Se calculan todos los precios con ese porcentaje y el mismo redondeo. Los ítems con
   porcentaje propio (por ejemplo los televisores, con 100 %) lo conservan, salvo que marques
   **"aplicar a todos"**: en ese caso el porcentaje de la versión pisa también los propios.
3. En **Vista** elegí la versión para revisarla y usá **"Exportar PDF"** (o el botón PDF de la
   lista). El archivo se llama `CATALOGO SAE - <versión> - AAAA-MM-DD.pdf`.

Cómo se comporta una versión de evento:
- Es una **foto** de los precios: si después cambia la base o se editan reglas, sigue
  imprimiendo lo mismo. Por eso se puede reimprimir igual meses después.
- Si editás ítems o reglas, la General se recalcula pero las versiones de evento quedan
  marcadas **"desactualizadas"** hasta que uses **"Recalcular"**.
- Una base parche nueva sí recalcula todas (con aviso antes de confirmar).
- **"Duplicar"** hace una copia exacta de los precios de otra versión.
- La versión **General** siempre existe, no se puede borrar ni renombrar y su porcentaje es el
  "porcentaje por defecto" de Ajustes (40 % de origen).

### 8.5) Dónde viven las fotos (y por qué hay que respaldarlas)

Las fotos y el logo se guardan como archivos en **`server/data/catalogo-img/`** (se puede
mover con la variable `CATALOGO_IMG_DIR` en `server/.env`). Cada foto se reduce a 800 px, por
eso el PDF completo pesa unos 5 MB.

> **Esa carpeta NO entra en el backup automático de las 3:00 AM**, que copia solamente el
> `.db`. Copiala a mano (o incluila en el respaldo de la PC servidor) además de
> `server/data/backups/`. La app lo recuerda con un aviso naranja en **Catálogo → Ajustes**.

Para cambiar la foto de un ítem: **Ítems → "Ficha"** del ítem → campo "Foto" → guardar.

### 8.6) Cómo se calcula cada precio

`SAE = pase parche × (1 + porcentaje)`, redondeado **hacia arriba** a múltiplos de $100 (el
múltiplo se cambia en Ajustes). Cada ítem tiene una regla:

| Regla | Qué hace |
|---|---|
| `base` | Toma `$ CLIENTE` de la base parche por código. |
| `derivado` | Toma el pase parche de otro ítem por un factor. Si el origen cambia, se recalcula solo. |
| `manual` | Precio de lista cargado a mano, al que se le aplica el porcentaje del ítem; en los televisores se le suma antes el adicional del pie. |
| `proporcional` | SAE de otro ítem × fracción, sin porcentaje (el MC-43). |
| `razon` | A × B / C entre tres ítems (MVN-01 y MVN-01P). |
| `sin_precio` | Se muestra como "S / P". |

- El porcentaje vacío en un ítem significa "el de la versión"; los televisores tienen el suyo
  propio, de 100 %.
- **Televisores**: precio de lista por cada TV y **un único** adicional por el pie, editable en
  su pestaña (o en Ajustes).
- La ficha de cada ítem muestra de quién depende y qué ítems recalcula si cambia su precio.
  Las dependencias circulares se detectan y se marcan con error en lugar de calcularse.

### 8.7) Tipografías del PDF

El PDF usa **Carlito** (libre, métricamente igual a Calibri), incluida en
`server/assets/fonts/`. El Excel usa **Aptos Narrow** para las etiquetas, los precios y el pie;
no es una fuente libre, por eso no se incluye y esas partes salen en Carlito Bold. Si la tenés,
copiá `AptosNarrow-Bold.ttf` en esa carpeta y se usa sola.

### 8.8) Tests

```bash
npm test --workspace=server
```

Corre la suite completa con bases temporales (no toca la real). Seis pruebas que usan los
Excel reales (carga completa, PDF con los 113 ítems y actualización de precios) se omiten
salvo que se indiquen las rutas:

```powershell
$env:SAE_CATALOGO_XLSX = "C:\ruta\CATALOGO SAE.xlsx"
$env:SAE_BASE_PARCHE_XLSX = "C:\ruta\26_BASE PARCHE_P (1).xlsx"
npm test --workspace=server
```

---

## 9) Resumen operativo del día a día

- La PC servidor tiene que quedar prendida (o al menos no en suspensión) para que el resto
  pueda usar la app.
- Si el servidor no responde desde otras PCs, fijate que la ventana de
  `iniciar-servidor.cmd` (o la tarea programada) siga activa, y que la IP no haya cambiado.
- Usuario administrador inicial: `admin` / `admin123` (cambiala después del primer ingreso).
