# SAE-APP — Presupuestos de eventos

Aplicación web interna para gestionar presupuestos de expositores por evento: calendario,
estado de facturación/cobro, totales por rubro, export a PDF, catálogo de precios y croquis de
stands. Pensada para la red local de la oficina.

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
- Un usuario administrador inicial: **usuario `admin`, contraseña `admin123`** (cambiala al primer ingreso).

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

La misma dirección funciona desde el navegador de un **celular** conectado a la misma red: la
pantalla se adapta sola (el menú lateral pasa a un botón "☰" arriba a la izquierda, las tablas
anchas scrollean dentro de su tarjeta en vez de romper la página, los modales ocupan toda la
pantalla, y los botones/campos son más grandes para tocar con el dedo). No hace falta nada
especial del lado del servidor.

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

> **Las fotos del catálogo y los adjuntos de los presupuestos (croquis, planos) no entran en
> este backup** (solo se copia el `.db`). Ver las secciones 8.5 y 9.4.

---

## 7) Import automático de presupuestos desde Excel (retirado)

Los presupuestos se cargan directamente en la app (ver 9), así que **el import automático desde
Excel ya no existe**: no hay tarea que revise la carpeta de red, ni pantalla "Importaciones", ni
la variable `SAE_IMPORT_DIR` (se puede borrar de `server/.env`).

Lo que se había importado **no se tocó**: los lotes, presupuestos y líneas que vinieron de Excel
siguen en la base y se ven y editan igual que antes (están marcados con origen "Excel"). Las
tablas del import quedan en la base como historial. Ese import además **borraba** los
presupuestos de Excel cuyo archivo desaparecía de la carpeta; ya nada los borra.

El catálogo (sección 8) sigue importando sus propios Excel de precios.

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
   evento** (las versiones del historial de la General, ver 8.5, no se tocan: son una foto
   fija). Antes de recalcular, se guarda sola una versión con la lista de precios de la General
   tal como estaba, para no perderla. Queda todo registrado en el historial (archivo, usuario,
   reporte y un enlace a esa versión guardada).

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
- Una base parche nueva sí recalcula todas (con aviso antes de confirmar); las del historial de
  la General (8.5) son la excepción, porque son justamente la foto que no se quiere que cambie.
- **"Duplicar"** hace una copia exacta de los precios de otra versión.
- La versión **General** siempre existe, no se puede borrar ni renombrar y su porcentaje es el
  "porcentaje por defecto" de Ajustes (40 % de origen).

### 8.5) Historial y versiones fijas (guardadas o importadas de un archivo)

En **Catálogo → Versiones**, debajo de la tabla principal, hay una sección **"Historial y
versiones fijas"** con dos formas de tener una lista de precios que no se mueve sola:

**A) Guardar una foto de la lista General, con nombre.** La General (la del 40 %, el
"presupuesto general de SAE") se puede guardar en distintos momentos, para volver a verla o
usarla más adelante — por ejemplo, para saber qué precio tenía un ítem el mes pasado, o para
cotizarle a un cliente con la lista vieja.
- **Se guarda sola**, con un nombre automático (`General DD/MM/AAAA`; si ya existe ese nombre,
  se le agrega "(2)"), cada vez que se confirma una base parche con cambios reales — justo antes
  de recalcular, para no perder la lista anterior. Si la base no cambió nada, no guarda una foto
  de más.
- **También se puede guardar a mano, en cualquier momento**, con **"+ Guardar la versión de
  hoy"**, poniéndole el nombre que quieras.

**B) Importar los precios finales de un archivo, para un evento puntual.** Con **"Importar una
versión desde un archivo"** (sólo administradores), subís una de las planillas de presupuesto de
siempre (hoja **DATOS**, con `COD`, `DESCRIPCION` y una columna de precio que empiece con
`SAE...` — por ejemplo `SAE CIDEL`) y se crea una versión con **exactamente esos precios**, sin
aplicarles ningún porcentaje ni recalcular nada. Primero se muestra un reporte (con precio /
sin precio / códigos que no existen en el catálogo / repetidos) y recién al confirmar se crea. Un
código del catálogo que no está en el archivo, o que vino en 0, queda "S / P" en esa versión.

Cómo se comportan las dos:
- Quedan **fijas**: no cambia el porcentaje ni la vigencia, y no se recalculan solas (ni con una
  base parche nueva ni al editar un ítem). Se les puede cambiar el nombre y se pueden borrar; sí
  se pueden exportar a PDF y usar como lista de precios de un presupuesto (ver 9.1).
- Se seleccionan en **Vista** y en la lista de precios de un presupuesto, agrupadas aparte como
  "Historial de la General"; y se administran (guardar/importar, renombrar, borrar) en
  **Versiones**. Las importadas de un archivo se distinguen con la etiqueta "Importada" y el
  nombre del archivo.
- Al confirmar una base parche, el historial de importaciones (8.3) enlaza directo a la versión
  de la General que se guardó en ese momento.

### 8.6) Dónde viven las fotos (y por qué hay que respaldarlas)

Las fotos y el logo se guardan como archivos en **`server/data/catalogo-img/`** (se puede
mover con la variable `CATALOGO_IMG_DIR` en `server/.env`). Cada foto se reduce a 800 px, por
eso el PDF completo pesa unos 5 MB.

> **Esa carpeta NO entra en el backup automático de las 3:00 AM**, que copia solamente el
> `.db`. Copiala a mano (o incluila en el respaldo de la PC servidor) además de
> `server/data/backups/`. La app lo recuerda con un aviso naranja en **Catálogo → Ajustes**.

Para cambiar la foto de un ítem: **Ítems → "Ficha"** del ítem → campo "Foto" → guardar.

### 8.7) Cómo se calcula cada precio

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

### 8.8) Tipografías del PDF

El PDF usa **Carlito** (libre, métricamente igual a Calibri), incluida en
`server/assets/fonts/`. El Excel usa **Aptos Narrow** para las etiquetas, los precios y el pie;
no es una fuente libre, por eso no se incluye y esas partes salen en Carlito Bold. Si la tenés,
copiá `AptosNarrow-Bold.ttf` en esa carpeta y se usa sola.

### 8.9) Tests

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

## 9) Presupuestos cargados desde la app

Los presupuestos se arman directamente en la app con los precios del catálogo y se imprimen en PDF. Se hace desde **Presupuestos → "+ Nuevo presupuesto"**.

Cada presupuesto tiene tres estados:
- **Pendiente de confirmación**: se está armando o ya se le mandó al cliente. Es invisible para el
  resto de la app: no aparece en el calendario, los totales, las alertas ni el export del evento.
- **Confirmado**: cuando el cliente acepta, se confirma con un botón y pasa a formar parte del
  evento. Desde ahí es un presupuesto más y funciona con todo lo que ya existía.
- **Rechazado**: cuando el cliente no lo acepta, se marca como rechazado con un botón en vez de
  borrarlo, así queda como registro (quién y cuándo lo rechazó). Queda de sólo lectura y se puede
  **reabrir** (vuelve a pendiente y editable) si el cliente cambia de opinión. Desde rechazado sí
  se puede eliminar del todo si hace falta.

La ventana **Presupuestos** tiene el filtro **Confirmación: Confirmados / No confirmados /
Rechazados / Todos**. Por defecto muestra "Confirmados", igual que antes.

### 9.1) Cómo se arma un presupuesto

1. **Datos**: los de la hoja CARGA del Excel (expo, tipo, lote, nombre del stand, razón social,
   CUIT, dirección, contacto, mail, teléfono) y con qué **lista de precios** arranca (la General
   por defecto, una versión de evento, o una del historial de la General — ver 8.4 y 8.5 — por
   ejemplo para cotizar con una lista vieja). **Todos son opcionales**. La expo se busca entre
   los eventos de la app. El responsable (quien lo carga) y la fecha se completan solos.
2. **Ítems**: se buscan en el catálogo por código o descripción y se elige la cantidad. El precio
   sale de la lista de precios elegida y se copia al presupuesto: no cambia si después se
   actualiza la base. La lista se puede volver a cambiar más adelante desde "Ítems" (se
   recalculan todos los ítems ya cargados con la lista nueva). Un precio se puede corregir a
   mano, y un ítem sin precio en la lista hay que completarlo a mano.
3. **Totales**: subtotal, IVA 21 % y total. Los precios del catálogo no incluyen IVA. Se le puede
   poner un **descuento especial** (un porcentaje) que se resta del subtotal **antes** de calcular
   el IVA; con descuento el recuadro de totales (y el PDF) muestran el desglose completo: subtotal,
   descuento, subtotal con descuento, IVA y total. Sin descuento (el valor por defecto) no cambia
   nada de lo que ya había.
4. **Croquis y planos** (opcional, ver 9.4).
5. **PDF**: "Ver PDF" lo abre en el navegador y "Descargar PDF" lo baja. Tiene el logo, los datos
   del cliente y del stand, la tabla de ítems, el recuadro de totales, las condiciones y la
   numeración "Página x de y". Vence a los 4 días de la fecha de carga.
6. **Confirmar**, cuando el cliente acepta.

También se puede **duplicar** un presupuesto en cualquier estado (copia los datos, los ítems y
los adjuntos), **marcar como rechazado** uno pendiente, **reabrir** uno rechazado, y **eliminar**
uno pendiente o rechazado (uno confirmado no, porque ya es parte del evento). El duplicado toma
**el siguiente número de presupuesto del mismo cliente** (si el original es `AE15ST1-1`, la copia
es `AE15ST1-2`). Para eso conserva al responsable del original, porque el ID de cliente incluye la
última letra del responsable; de todos modos queda registrado quién lo duplicó.

### 9.2) ID de cliente y número de presupuesto

Salen solos, con la misma fórmula que usa hoy el Excel: primera letra de la expo + última del
tipo + última del nombre del stand + última del responsable + dos primeras del nombre del stand +
dos últimas del lote, en mayúsculas (por ejemplo `AE15ST1`). Aparece cuando están cargados y
guardados la expo, el tipo, el lote y el nombre del stand. El **número de presupuesto** es
correlativo por cliente y el **código de facturación** es el ID más el número (`AE15ST1-2`).

### 9.3) Qué pasa al confirmar

Hacen falta el evento, el número de stand (lote), al menos un ítem y que todos tengan precio; si
falta algo, la pantalla dice qué. Al confirmar:
- Se busca o crea el lote del evento (con el número y el nombre del stand).
- Se crea el presupuesto del evento, marcado con origen **App**, en estado "Pendiente de
  facturar", con el total con IVA como monto, y sus ítems con el precio unitario (sin IVA), igual
  que los que se importaron antes desde Excel.
- Si el presupuesto tiene un **croquis dibujado** (9.4), pasa también al lote para que salga en el
  PDF de totales del evento. Si el lote ya tenía un croquis (de otro presupuesto del mismo stand),
  se conserva ese y no se pisa; la pantalla avisa qué pasó.
- El presupuesto original queda **cerrado**: para cambiarlo se edita dentro del evento. Desde la
  ventana Presupuestos, al abrir uno de origen App hay un enlace al original (PDF y adjuntos).

### 9.4) Croquis del stand y planos adjuntos

**Croquis dibujado en la app.** En la ficha de un presupuesto, la tarjeta **"Croquis del stand"**
tiene el botón **"Dibujar croquis"** (o **"Editar croquis"**), que abre el mismo editor de la
sección 10 (paredes, materiales del catálogo, cotas y comentarios). Se dibuja mientras el
presupuesto está **pendiente**: confirmado o rechazado se puede ver pero no modificar (el croquis
del stand se sigue editando desde el lote, sección 10).

- **Casilla "Incluir el croquis en el PDF del presupuesto"**: elige si el croquis sale o no. Viene
  tildada al dibujarlo y se puede cambiar siempre, incluso con el presupuesto confirmado.
- Sale en el PDF del presupuesto como la sección **"Croquis del stand"**, después de las
  condiciones: el dibujo a escala con sus cotas y, si escribiste comentarios, el cuadro de
  comentarios a la derecha. Si no entra en lo que queda de la hoja, pasa a una hoja nueva con el
  encabezado del presupuesto; nunca se parte.
- Al **duplicar** un presupuesto se copia también su croquis.

**Planos adjuntos (archivos).** Para subir un plano o croquis que ya está hecho en otro programa
(imagen o PDF), se usa la tarjeta **"Planos y archivos adjuntos"**. Cada presupuesto admite hasta 10 adjuntos: imágenes **JPG o PNG** y archivos **PDF** de hasta
25 MB cada uno. Se aceptan por su contenido real (no por la extensión); no se aceptan PDF con
contraseña ni archivos dañados. Las fotos grandes se reducen a 2.400 px y las de celular se
enderezan.

Salen como **anexos al final del PDF del presupuesto**, en el orden en que se cargaron: cada
imagen en su página (apaisada si la imagen lo es) con su título, y los PDF página por página. La
numeración "Página x de y" cuenta todo el documento. A cada adjunto se le puede poner un título y
destildar "Incluir en el PDF" para tenerlo guardado sin imprimirlo. Se pueden agregar y quitar
también después de confirmar.

> **Los adjuntos se guardan en `server/data/cotizaciones-adjuntos/` (se puede mover con la
> variable `COTIZACIONES_ADJ_DIR` en `server/.env`) y NO entran en el backup automático.**
> Conviene respaldar esa carpeta aparte, igual que la de las fotos del catálogo.

### 9.5) Al actualizar la aplicación

Este módulo agrega la librería `pdf-lib` (JavaScript puro) para unir los PDF. En la PC servidor
hay que correr `npm install` y `npm run build`, y reiniciar el servidor. Las tablas nuevas
(migraciones `0009_cotizaciones.sql` y `0010_clientes.sql`) se crean solas al arrancar y **no
modifican ninguna tabla existente** (solo agregan una columna a la tabla de presupuestos de la
app).

El croquis dentro del presupuesto agrega la tabla `cotizacion_croquis` (migración
`0017_cotizacion_croquis.sql`), que se crea sola al arrancar y no modifica ninguna otra tabla.

### 9.6) Clientes guardados, por CUIT

Los clientes se guardan solos, con el **CUIT como clave**, cada vez que se guardan los datos de
un presupuesto. Se ven y se corrigen en el menú **Clientes**.

- **Se guarda** razón social, dirección, contacto, mail y teléfono. Si el CUIT ya existe, no se
  duplica: se actualiza lo que el presupuesto trae con contenido (lo más reciente gana) y un dato
  vacío **no borra** el que ya estaba.
- **Autocompletado en el presupuesto**: al escribir un CUIT y salir del campo se completa la
  ficha del cliente (solo lo que esté vacío, no pisa lo que ya escribiste). También se puede
  escribir parte de la razón social y elegir el cliente de la lista, que completa todos sus datos.
- **CUIT**: se acepta escrito de cualquier forma (`30528303540`, `30-52830354-0`,
  `30 52830354 0`) y se guarda con guiones. Se valida el dígito verificador. Un CUIT dudoso **no
  bloquea** el presupuesto (todos los datos son opcionales): se guarda tal cual y la pantalla
  avisa, pero no se crea cliente.
- **Menú Clientes**: buscar por razón social, contacto o CUIT, ver cuántos presupuestos tiene cada
  uno, editar sus datos (el CUIT no puede repetirse) y borrarlo. Borrar un cliente no toca sus
  presupuestos: conservan sus datos, y si se guarda otro con ese CUIT el cliente se vuelve a crear.
- Al arrancar el servidor, los presupuestos que ya estaban cargados con un CUIT válido se guardan
  como clientes (una sola vez; no hace nada si no hay nada para completar).

Los presupuestos que se importaron antes desde Excel no tienen clientes guardados: ese import no leía
el CUIT.

---

## 10) Croquis del stand

Desde cada lote (stand) de un evento se puede dibujar su croquis: las paredes del stand y la
ubicación de los materiales reales del catálogo (sistema, mobiliario, equipamiento y electricidad),
usando los símbolos del plano de AutoCAD de la empresa. Es **opcional**: un lote sin croquis
dibujado no agrega nada al PDF.

### 10.1) Cómo se dibuja

En el panel de cada lote hay un botón **"Dibujar croquis"** (o **"Ver croquis"** si ya tiene uno
guardado), que abre un editor. Es el mismo que se abre desde la ficha de un presupuesto de la app
(sección 9.4):
- **Paredes**: se marcan clic a clic, con imán a la grilla cada 10 cm.
- **Materiales**: se elige uno de la paleta (con buscador y agrupados por rubro) y se hace clic
  sobre el plano para colocarlo; queda seleccionado para seguir colocando el mismo varias veces
  (Escape para cancelar). Cada material ya colocado se puede arrastrar, rotar y borrar.
  Al colocar o mover un material se **engancha** (imán) al centro de las columnas, a las
  esquinas y a las puntas de pared que tenga cerca, y se ve una vista previa con un marcador
  del punto: así un dintel queda centrado exacto sobre la columna de un panel. Si no hay nada
  cerca, va a la grilla de 10 cm. Los **spots** se apoyan en la línea de un dintel: el extremo de
  su brazo se engancha al punto más cercano de la línea y se desliza a lo largo de ella de a 10 cm
  (si hay un extremo o el medio del dintel cerca, se engancha a ese punto). El brazo tiene que
  quedar de ese lado: se gira con **R** y se vuelve a acercar.
- **Cotas**: en el modo **Cotas** se acota con tres clicks, como en AutoCAD: primer punto,
  segundo punto y dónde va la línea de cota. Los puntos se imantan al **centro de las columnas**
  (los círculos de los paneles y demás símbolos), a las esquinas de los materiales y a las puntas
  de pared (si no hay ninguno cerca, a la grilla), y la medida se
  calcula sola, en metros. Para borrar una cota se hace click sobre su medida, o se usa
  **Deshacer última cota**.
- **Comentarios**: un cuadro de texto debajo del plano (hasta 1.000 caracteres) para las
  aclaraciones del armado. Salen impresos a la derecha del croquis (ver 10.3).
- Se guarda con el botón **Guardar**; también se puede borrar todo el croquis del lote.

Se maneja como un CAD: **rueda del mouse** = zoom, **click central y arrastre** = paneo, **click y
arrastre sobre el plano** = selección múltiple (de izquierda a derecha, sólo lo que queda adentro;
de derecha a izquierda, lo que toca el rectángulo), **Shift+click** = sumar o quitar de la
selección, **Ctrl+C / Ctrl+V** = copiar y pegar, **R** = rotar la selección entera como una sola
pieza, **Supr** = borrar, **Ctrl+A** = seleccionar todo, **Esc** = cancelar.

### 10.2) Símbolos disponibles

Los símbolos salen del archivo DXF de AutoCAD de la empresa ("Sistema 27") y mantienen el color
original de cada bloque, **salvo los paneles (blancos, cerezo, negros, vidriado, costilla) y las
columnas, que se dibujan todos del mismo azul** (`#0000ff`, el de los paneles blancos) para que se
lean como una sola pared. Ese color está en `server/src/data/croquisSimbolos.json`; si algún día se
vuelve a extraer la biblioteca desde AutoCAD hay que volver a unificarlo (lo verifica un test). **No todos los ítems del catálogo tienen un símbolo**: donde no hay un
bloque genuino para ese ítem exacto, no se dibuja nada en vez de reemplazarlo por uno parecido. La
biblioteca de símbolos vive en `server/src/data/croquisSimbolos.json` y no se genera desde el
servidor: si hace falta agregar o corregir un símbolo, hay que volver a exportar el bloque desde
AutoCAD y rehacer la extracción a mano (ese proceso no forma parte del stack normal de la app, así
que no vive en este repositorio).

Hay además **bloques auxiliares**: se dibujan pero **no son ítems del catálogo** (no se venden ni
tienen precio, no aparecen en presupuestos). Hoy hay uno, la **COLUMNA** (rubro SISTEMA, el
mismo círculo de 10 cm que tienen los paneles), para poner en la unión de dos dinteles. Como
las columnas de los paneles, se engancha (imán) a las puntas de los dinteles. Se agregan en
`server/src/data/croquisSimbolos.json` con `"auxiliar": true`, `rubro` y `descripcion`.

### 10.3) En el PDF de totales del evento

Al exportar el PDF de **Totales** de un evento, el croquis sale **justo debajo del detalle de su
lote** (no al final): paredes, materiales a escala con su rotación y su color original, y las
cotas con su medida. Los lotes sin croquis dibujado no llevan nada.

- Si el lote tiene **comentarios**, salen en un cuadro a la derecha del croquis; si no tiene, el
  croquis usa todo el ancho.
- Es **compacto**: el dibujo se encuadra exacto (sin aire de más) y no se agranda más de lo
  necesario. Nunca se corta ni se parte entre dos hojas: si no entra en lo que queda de la hoja se
  lo achica un poco y, si igual quedaría muy chico, pasa a la hoja siguiente repitiendo el título
  del lote.
- Un lote con croquis pero **sin pedidos cargados** igual se imprime, con su propio título.
- Al exportar **filtrando por rubros**, sólo salen los croquis de los lotes que aparecen en el
  listado.

### 10.4) Al actualizar la aplicación

Agrega la tabla `lote_croquis` (migración `0015_lote_croquis.sql`) y, a esa tabla, las columnas
`comentarios` y `cotas` (migración `0016_lote_croquis_comentarios_cotas.sql`). Se crean solas al
arrancar y **no modifican ninguna otra tabla**; los croquis que ya existían quedan sin comentarios
ni cotas. Hace falta `npm install && npm run build` en el cliente y reiniciar el servidor.

---

## 11) Resumen operativo del día a día

- La PC servidor tiene que quedar prendida (o al menos no en suspensión) para que el resto
  pueda usar la app.
- Si el servidor no responde desde otras PCs, fijate que la ventana de
  `iniciar-servidor.cmd` (o la tarea programada) siga activa, y que la IP no haya cambiado.
- Usuario administrador inicial: `admin` / `admin123` (**cambiala de inmediato**: en Usuarios, las claves nuevas
  tienen que tener al menos 8 caracteres).

---

## 12) Seguridad

Lo que trae la app y cómo cuidarla.

### 12.1) Lo que ya trae la app

- **Límite de intentos de login**: 10 fallos por IP en 15 minutos bloquean esa IP un rato.
- Cada login crea una **sesión nueva**. La clave con la que se firman las sesiones se genera sola la
  primera vez y se guarda en `server/data/session-secret` (si se borra, se crea otra y todos tienen
  que volver a entrar). También se puede fijar con `SESSION_SECRET` en `server/.env`.
- Las **claves nuevas** tienen que tener al menos 8 caracteres.
- Los errores internos no muestran rutas ni consultas de la base; solo "Error interno del servidor"
  (el detalle queda en la consola del servidor).
- Todas las rutas de datos exigen sesión; solo el login y `/api/health` están abiertos. Los permisos
  (administrador / operador / "solo estado") se revisan en el servidor.
- Encabezados de seguridad básicos en todas las respuestas. Si algún día la app se publica detrás de
  un proxy que corre en esta misma PC, la cookie de sesión va marcada como segura cuando la conexión
  llega por https; por la red local (http) todo funciona normal.
- Se corrigieron los avisos de seguridad de las dependencias (`npm audit` en 0). `xlsx` se instala
  desde el sitio oficial de SheetJS porque la versión de npm está abandonada y tiene fallas
  conocidas: por eso `npm install` necesita acceso a `cdn.sheetjs.com`.

### 12.2) Cuidados

- **Cambiá la clave de `admin` y de todos los usuarios** a una de 8+ caracteres que no se use en
  otro lado. Quien se va del equipo: **Usuarios → desactivar** (corta su acceso al instante).
- **Backups**: la app guarda uno por día a las 03:00 en `server/data/backups`, pero en la *misma
  PC*. Copiá la carpeta `server/data/` completa (base, backups, fotos del catálogo y adjuntos de
  presupuestos, que no entran en el backup automático) a otro disco o a la nube cada tanto.
- Cada tanto: `npm audit` y actualizar Node.

### 12.3) Acceso desde fuera de la oficina (Tailscale)

Para usar la app desde casa sin publicarla en internet se usa **Tailscale** (una VPN privada): la app
sigue en la PC de la oficina, con su base, backups, fotos y adjuntos, y solo entran los dispositivos
que se sumaron a la red de Tailscale.

- **PC servidor** (nombre `equipamiento`): Tailscale instalado y con sesión iniciada. Se la ubica por
  la IP `100.110.14.43` (fija mientras el dispositivo siga en la red) o por el nombre
  `equipamiento.tail42334c.ts.net`.
- **Desde otro dispositivo**: instalar Tailscale, iniciar sesión con la misma cuenta y abrir
  `http://100.110.14.43:4001` (o `http://equipamiento:4001`). Anda igual que en la oficina: mismo
  usuario y misma clave.
- No hace falta tocar la app ni el router: el servidor ya escucha en todas las interfaces
  (`0.0.0.0:4001`) y el tráfico por Tailscale va cifrado de punta a punta.
- Condiciones: la PC servidor tiene que estar **prendida y con el servidor corriendo** (sin
  suspensión). En el panel de Tailscale (login.tailscale.com → Machines) conviene **desactivar el
  vencimiento de clave** de la PC servidor; si no, a los ~180 días hay que volver a iniciar sesión
  en ella.
- Para sumar a otra persona: invitarla desde el mismo panel (cada una con su cuenta de Tailscale);
  los límites de usuarios del plan gratuito están en tailscale.com/pricing.
