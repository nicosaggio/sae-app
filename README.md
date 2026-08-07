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

## 8) Resumen operativo del día a día

- La PC servidor tiene que quedar prendida (o al menos no en suspensión) para que el resto
  pueda usar la app.
- Si el servidor no responde desde otras PCs, fijate que la ventana de
  `iniciar-servidor.cmd` (o la tarea programada) siga activa, y que la IP no haya cambiado.
- Usuario administrador inicial: `admin` / `admin123` (cambiala después del primer ingreso).
