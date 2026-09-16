# Mapa de Clientes · Digital Print Maquinaria Gráfica (v2)

Mapa interactivo (PWA) de empresas, proveedores y contactos, pensado para
coordinar visitas comerciales por zona. Es una web estática (HTML/CSS/JS)
con un par de piezas pequeñas de servidor (funciones de Netlify) solo para
el login y para que las zonas/viajes/ocultos se compartan entre todo el
equipo en vez de quedarse en un solo ordenador.

## ⚠️ Esto es una copia de pruebas (v2), no toca lo que ya está publicado

Esta carpeta (`Mapa Interactivo v2`) es una copia completa e independiente
de `Mapa Interactivo`. Probala tranquilo con `Ver-Mapa-Local.bat` — no
afecta al sitio real que ya usa el equipo. Cuando la veas bien, la
"promocionamos" a producción subiendo estos mismos archivos a tu
repositorio de GitHub (el mismo proceso de siempre: "Add file → Upload
files", arrastrando lo que haya cambiado). Avisame cuando quieras hacerlo y
te digo exactamente qué archivos tocaron.

## Qué trae esta versión que la v1 no tenía

- **Cerca de mí** (botón sobre el mapa, arriba a la izquierda): activa tu
  ubicación GPS (el navegador pide permiso) y muestra un punto azul en el
  mapa. Con esto activo, la lista de clientes de la izquierda se reordena
  automáticamente por cercanía a donde estás, con la distancia en km al
  lado de cada uno. Pensado para el móvil de un técnico en ruta.
- **Radio de búsqueda**: toca el botón, elige 5/10/25/50 km, y toca un
  punto cualquiera del mapa — filtra a los clientes dentro de ese círculo.
  Útil para un comercial que quiere ver qué hay cerca de donde va a estar.
  Se quita con la "✕" que aparece en los filtros de la izquierda.
- **Filtro por Estado** (Activas/Dormidas), junto a Clasificación/Zona/Provincia.
- **Check-in automático + pestaña "Actividad"**: mientras alguien tiene
  "Cerca de mí" activado, si pasa a menos de 150 m de un cliente conocido,
  la app registra solo (sin tocar nada) "[usuario] estuvo en [cliente] a
  las [hora]" — nunca guarda la posición exacta ni un rastro continuo,
  solo esa detección puntual. La pestaña "Actividad" lista todos esos
  check-ins del equipo, y cada ficha de cliente muestra si tuvo una visita
  reciente. **Importante**: como esto usa la ubicación del móvil, hay que
  avisar a quien lo use de que, al activar "Cerca de mí", su paso por los
  clientes queda registrado para el equipo — no debe ser un secreto para
  ellos (España exige informar de la geolocalización de empleados, aunque
  el propósito no sea vigilarlos).
- **Ruta dibujada al ver un viaje**: si el viaje tiene más de un cliente,
  al verlo en el mapa ahora conecta las paradas con una línea y las numera
  en el orden en que las añadiste al viaje.
- **Historial de visitas en la ficha**: cada ficha de cliente ahora lista
  automáticamente los viajes anteriores en los que apareció (fecha,
  descripción), cruzando con el historial de viajes — no hay que apuntar
  nada aparte.
- **Compartir ficha**: botón "Compartir" en cada ficha — en el móvil abre
  el menú nativo de compartir (WhatsApp, etc.) con el nombre, dirección,
  teléfono y el enlace de "cómo llegar" ya escritos; en escritorio abre
  WhatsApp Web con ese mismo texto.
- **Estado del viaje** (Planificado / Hecho): al crear o editar un viaje
  eliges su estado; cada tarjeta lo muestra con una etiqueta de color y un
  botón para cambiarlo con un clic. La pestaña Viajes tiene un filtro
  rápido (Todos/Planificados/Hechos) para ver de un vistazo qué queda
  pendiente.
- **Hoja de ruta imprimible**: botón "Hoja de ruta" en cada viaje — abre el
  diálogo de impresión del navegador con una lista limpia (empresa,
  dirección, teléfono, personas de contacto) lista para imprimir o guardar
  como PDF, para quien viaja y quizá no tenga buena cobertura.

## Acceso: usuario y contraseña

El sitio entero (mapa, datos, todo) pide usuario y contraseña antes de
enseñar nada — es el cuadro de login que pone el propio navegador, no hay
pantalla de por medio. Usuarios dados de alta, todos con la misma
contraseña `digitalprint2026`:

Marc · Aurelio · Santi · SantiC · Vicente · Juanfran · Cristian · Ivan ·
Salva · Javi · Comercial

Para añadir, quitar o cambiar contraseñas de alguien, se edita la lista
`USERS` al principio de `netlify/edge-functions/basic-auth.js` y se vuelve
a publicar. No es un sistema de "cuentas" de verdad (no hay recuperar
contraseña, ni saber quién es quién dentro de la app) — es justo lo que
pediste: una puerta sencilla con estos usuarios fijos, nada más.

Esto ya protege `data/data.json` (los teléfonos y emails de los clientes)
de cualquiera que no tenga esas credenciales, así que no hace falta
contratar el "Password protection" de pago de Netlify además.

## Si pruebas en local y no ves los cambios nuevos

Con `Ver-Mapa-Local.bat` ya no debería pasar (dejé el mapa sin "recordar"
nada mientras corre en local, para que cada recarga vea siempre los
archivos tal cual están en el disco). Si aun así alguna vez se queda con
una versión vieja: cierra la ventana negra del servidor, cierra también la
pestaña del navegador, y vuelve a abrir el `.bat` desde cero.

En el sitio ya publicado en Netlify sí queda una copia guardada en el
navegador (para que funcione offline como app). Ahí, cuando yo publique una
actualización, la pestaña que ya tengas abierta se recargará sola en unos
segundos para mostrarla — no hace falta hacer nada.

## Cómo publicarlo en Netlify

El Excel original (`carteradigitalprint.xlsx`) ya no está dentro de esta
carpeta — lo moví a `Proyectos\Excel original (no subir a GitHub)`,
justo al lado, para que no puedas subirlo sin querer (no hace falta para
que la web funcione: ya está volcado en `data/data.json`). Al subir esta
carpeta a GitHub, tampoco hace falta incluir `.claude/` (son ajustes míos
de cuando lo probé en local, no de la web en sí).

**Esta vez hay que subirlo por Git (GitHub/GitLab), no arrastrando la
carpeta.** El login y la base de datos compartida necesitan que Netlify
instale una dependencia (`@netlify/blobs`) y "empaquete" las funciones antes
de publicar — eso solo lo hace en el proceso normal de build, que solo se
dispara conectando un repositorio. Arrastrar la carpeta directamente
probablemente dejaría el login y el guardado compartido rotos.

Pasos (si no tienes cuenta de GitHub, dímelo y te ayudo a crearla):
1. Sube esta carpeta a un repositorio nuevo en GitHub (privado, para no
   exponer el Excel ni nada sensible aunque ya lo hayamos sacado de la
   carpeta).
2. En [app.netlify.com](https://app.netlify.com) → "Add new site" →
   "Import an existing project" → conecta GitHub y elige ese repositorio.
3. Build command: déjalo vacío. Publish directory: `.` (la raíz). Netlify
   detecta solo la carpeta `netlify/functions` y el `netlify.toml`.
4. Deploy. Netlify instala `@netlify/blobs` y publica el sitio con login y
   funciones ya activos.

Cada vez que quieras actualizar el mapa (nuevo Excel, ajustes, etc.), un
`git push` a ese repositorio republica todo solo.

## Cómo funciona

- **Buscador arriba**: filtra por nombre de empresa o de persona de contacto.
- **Filtros de la izquierda**: por clasificación (Cliente/Proveedor/Cartera…),
  por zona y por provincia.
- **Clic en un pin o en la lista**: abre la ficha con dirección, teléfono,
  email, web, personas de contacto (con su teléfono/email) y el botón
  **Cómo llegar**, que abre Google Maps con la ruta desde donde estés.
- **Clientes cercanos**: dentro de cada ficha, lista de las empresas más
  próximas en línea recta, para planear una ruta de visitas.
- **Zonas**: botón "Dibujar zona" sobre el mapa para marcar polígonos a mano
  (por ejemplo, dividir Madrid en varias zonas de reparto). Cada empresa
  queda asignada automáticamente a la zona en la que cae su punto. Desde
  "Gestionar zonas" puedes renombrar, cambiar de color, borrar, y
  **exportar/importar** el archivo de zonas para compartirlo con el equipo
  (ver más abajo).

- **Viajes**: botón "Nuevo viaje" para entrar en modo selección — toca varios
  clientes en el mapa o marca sus casillas en la lista de la izquierda (se
  ve un aro negro alrededor de cada uno elegido). Al pulsar "Crear viaje" se
  abre un formulario: nombre, fecha, **un color para ese viaje** (para
  distinguirlo luego en el mapa), quién viaja (Juanfran, Cristian, Ivan,
  Vicente, Traductor, Técnico de Fábrica — cualquier combinación, de 0 a
  todos) y una descripción de lo que se va a hacer.
- **Pestaña "Viajes"** (arriba a la izquierda, junto a "Clientes"): lista
  completa del historial, con botones para verlo resaltado en el mapa (con
  el color que le pusiste — el resaltado se queda puesto hasta que lo
  quites con la "✕" que aparece arriba del mapa, o veas otro viaje),
  editarlo o borrarlo. Al final de la pestaña, "Exportar/Importar" para
  compartir el historial con el equipo (ver más abajo).
- **Ocultar clientes**: botón "Ocultar clientes" para entrar en el mismo modo
  de selección (toca en el mapa o marca casillas en la lista) y quitarlos de
  en medio — dejan de aparecer en la lista, el mapa y el buscador, para que
  no llenen de información que no necesitas ahora. El botón "Clientes
  ocultos" abre el listado de todos los que ocultaste, con un botón
  "Revivir" en cada uno (o "Revivir todos" de golpe) para que vuelvan a
  aparecer. Se guarda en el dispositivo, igual que las zonas y los viajes.
- **Ubicación manual**: cuando una ficha aparece como "sin ubicar" (en rojo,
  en la lista o en su propia ficha), puedes hacer clic ahí para abrir un
  buscador: se abre Google Maps en una pestaña nueva con el nombre de la
  empresa ya escrito, buscas el sitio correcto, copias la URL (o las
  coordenadas) y las pegas de vuelta — se guarda y el cliente pasa a
  aparecer en el mapa. También sirve para **corregir** una ubicación que
  haya salido mal situada (botón "Corregir esta ubicación" en cualquier
  ficha). Estas ubicaciones añadidas a mano se guardan en el dispositivo;
  abajo de la lista de clientes hay un botón para exportarlas si en algún
  momento querés que las incorpore al `data.json` oficial.

**Zonas, viajes, clientes ocultos y ubicaciones añadidas a mano se
comparten entre todo el equipo** una vez publicado en Netlify: se guardan
en un almacén compartido (Netlify Blobs) además de en el propio
dispositivo. Si Juanfran crea un viaje desde su portátil, en un minuto
Cristian lo ve al recargar el mapa en el suyo. "Última persona que guarda,
gana" — si dos personas editan lo mismo casi a la vez, se queda la última;
para el ritmo de uso de este equipo (unas pocas ediciones al día) no debería
ser un problema.

Mientras pruebas con `Ver-Mapa-Local.bat` esto NO funciona (esa parte
necesita estar publicada de verdad en Netlify) — en local cada cosa se
guarda solo en el navegador de esa máquina, como antes. Los botones
Exportar/Importar de zonas y viajes siguen ahí por si alguna vez hace falta
un respaldo manual o mover datos entre entornos.

## Actualizar el listado de clientes

Cuando tengas una exportación nueva del Excel (por ejemplo, otra vez desde
Odoo), la carpeta `tools/` trae el proceso completo. Se ejecuta en
PowerShell, en este orden:

```powershell
cd "Mapa Interactivo\tools"
.\1-extract.ps1 -XlsxPath "C:\ruta\al\nuevo_excel.xlsx"
.\2-build.ps1
.\3-geocode.ps1
.\4-geocode-fallback.ps1
.\5-merge.ps1
```

- **1-extract**: lee el Excel (usa Excel/COM de Windows) y saca las hojas
  Empresas/Contactos a `tools/.cache`.
- **2-build**: une empresas con sus personas de contacto y descarta fichas
  de prueba.
- **3-geocode**: convierte cada dirección en coordenadas usando el servicio
  gratuito OpenStreetMap/Nominatim. Va despacio a propósito (1 dirección
  por segundo, límite de su uso gratuito) — con ~900 direcciones tarda
  unos 15-20 minutos. Se puede cortar y volver a lanzar: no repite lo ya hecho.
- **4-geocode-fallback**: para las direcciones que no se encontraron
  completas, reintenta a nivel de código postal/ciudad para no perder esas
  fichas del mapa.
- **5-merge**: genera el `data/data.json` final que lee la web.

Después de `5-merge.ps1`, vuelve a publicar la carpeta en Netlify.

## Estructura del proyecto

```
index.html              Página principal
css/style.css            Estilos (colores de marca: rojo #A6192E y negro)
js/app.js                 Toda la lógica (mapa, buscador, zonas, fichas)
js/vendor/                Leaflet y Leaflet.markercluster (incluidos, sin CDN)
data/data.json             Clientes con coordenadas (lo genera tools/5-merge.ps1)
data/zones.json             Zonas por defecto que ve alguien que abre el mapa por primera vez
icons/, manifest.webmanifest, service-worker.js    Necesarios para instalar como app (PWA)
tools/                    Script para regenerar data/data.json desde el Excel
netlify/edge-functions/basic-auth.js   Login (usuario/contraseña) para todo el sitio
netlify/functions/store.mjs             API del almacén compartido (zonas/viajes/ocultos/ubicaciones)
netlify.toml, package.json               Configuración de Netlify (funciones, cabeceras, dependencias)
```

## Limitaciones a tener en cuenta

- Las coordenadas son aproximadas: cuando la dirección no tiene calle y
  número completos, el pin se sitúa en el código postal o la ciudad.
- Las fichas marcadas "sin ubicar" en la lista no tienen dirección
  utilizable en el Excel origen — siguen apareciendo en el buscador y la
  lista, pero no como pin en el mapa. Se ven con el teléfono/email para
  poder contactar igualmente.
- El mapa base es de OpenStreetMap (gratuito, sin necesidad de clave ni
  facturación). El botón "Cómo llegar" sí abre Google Maps para la ruta.
