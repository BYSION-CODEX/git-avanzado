# AGENTS.md

Experiencia web interactiva de conciencia ambiental. p5.js + ml5.js por CDN,
sin build, sin package manager, sin tests.

## Estado

Estructura base + captura de video + reconocimiento corporal (ml5.js Body Pose
con MoveNet). Se leen nariz, ojos, orejas, hombros, codos, muñecas y caderas.
**No hay interacciones, ni gestos, ni animación**: el escenario sigue estático.

Estados de la cámara en `sketch.js`, reflejados en `data-estado` del contenedor:
`iniciando` → `lista` → o `error`. Ojo: `createCapture` **solo llama al callback
si el stream carga**; si se niega el permiso no avisa, por eso hay un temporizador
de respaldo y un chequeo de `navigator.permissions`.

Estados del reconocimiento en `#pose-estado` (`data-estado` = `inactivo`,
`parcial`, `listo`, `error`). La tabla `#pose-puntos` muestra x, y y confianza
de cada punto, y se repinta a ~8 Hz, no en cada frame.

## Ejecutar

No hay paso de build. Servir la carpeta por HTTP desde la raíz del repo:

```powershell
npx serve . -l 8000
```

Abrir `http://localhost:8000`. `file://` NO sirve: la cámara necesita
`localhost` o HTTPS, y además los scripts por CDN fallan distinto ahí.
El permiso de cámara es por origen (host + puerto): usar siempre el mismo puerto.

Ojo: en esta máquina `python` es el alias de Microsoft Store y **no** está
instalado, así que `python -m http.server` falla. Usar `npx serve` o cualquier
otro servidor estático (Live Server de VS Code también sirve).

## Archivos

| Archivo | Rol |
|---|---|
| `index.html` | documento único: contenedor principal, espacio de cámara, espacio de lienzo y carga de librerías |
| `style.css` | todos los estilos de la interfaz |
| `sketch.js` | `setup()` / `draw()` de p5.js en modo global, cámara y Body Pose |
| `debug-pose.js` | modo depuración: dibuja el esqueleto sobre la cámara |

Cuatro archivos. Si aparece un módulo nuevo, registrarlo en `index.html` en el
orden correcto y documentarlo acá.

## Modo depuración (`debug-pose.js`)

- Es una capa **independiente**: no toca el escenario, ni `draw()`, ni la
  detección. Solo lee `obtenerPoseBusto()` / `obtenerEstadoPose()`.
- Corre en **su propio `requestAnimationFrame`**: el escenario usa `noLoop()`,
  así que no se puede colgar de `draw()`.
- Dibuja sobre `#pose-overlay`, un canvas que ocupa exactamente el mismo
  rectángulo que el `<video>`. Cada punto pasa por `mapearPuntoCamara()`, por eso
  el esqueleto coincide con el cuerpo espejado y no queda corrido.
- Un punto o una línea se dibuja solo si **ambos** extremos tienen
  `punto.visible` (confianza ≥ `CONFIANZA_MINIMA`) y caen dentro del recorte.
- Para apagarlo en la presentación: `DEPURACION_POSE = false` dentro del archivo,
  o borrar `<script src="debug-pose.js">` de `index.html`.
- Colores del indicador duplicados a propósito entre `style.css` y el canvas:
  el canvas no lee variables CSS.

## Reglas

- **Nada de bundler, npm, frameworks ni ES modules.** `sketch.js` es un script
  clásico: `import`/`export` rompen la página. p5 está en modo global
  (`setup`, `draw`, `createCanvas`, … son globales).
- **Orden de carga en `index.html`**: p5.js → ml5.js → `sketch.js`.
  `sketch.js` va último porque define `setup`/`draw` y usa `ml5` al inicializar.
- **Versiones pinneadas**: p5 `2.3.3` (jsDelivr) y ml5 `1.4.0` (unpkg).
  Actualizar es una decisión deliberada, nunca un efecto de copiar un `<script>`.
- **ml5 pesa ~4.4 MB e incluye TensorFlow.js**: la primera carga tarda y el
  modelo de MoveNet se descarga aparte (necesita red la primera vez).
- El canvas se crea en `setup()` y se ancla con `canvas.parent(#lienzo-contenedor)`.
  No escribir `<canvas>` a mano en el HTML.
- `pixelDensity(1)`: sin esto, un monitor de alta densidad cuadruplica el costo.
- `noLoop()` está activo porque el placeholder es estático. Al empezar la
  animación hay que quitarlo (y el `redraw()` de `windowResized` deja de hacer falta).
- Todos los números y colores visibles viven en `:root` de `style.css`.

## Gotchas a respetar cuando se integre la cámara

- El `<video>` debe quedar **en el DOM** y no con `display: none`: sin superficie
  de render algunos navegadores dejan de entregar frames.
- La imagen de la cámara **no se dibuja** en el lienzo; solo se usan los landmarks.
- El video está espejado **visualmente** (`createCapture(VIDEO, { flipped: true }, cb)`).
  Eso es solo CSS (`transform: scaleX(-1)`): los píxeles que recibe ml5 **no**
  están espejados. El espejo de coordenadas (`x = 1 - x`) se aplica una sola vez
  en la capa de detección, nunca dos.
- El marco de la cámara (`#camara-marco`) es **16:9** con `object-fit: cover` y
  `object-position: 50% 40%`. No cambiar el marco a una proporción más alta: al
  recortar los costados se pierden brazos y manos. El encuadre de busto se logra
  con la proporción y la distancia del usuario, no recortando.
- Un punto de detección **nunca** se pasa directo a pantalla: usar
  `mapearPuntoCamara(x, y)`, que aplica el espejo y el recorte de `object-fit`
  y devuelve `{ x, y, visible }` en coordenadas del marco. La posición de
  recorte se lee del CSS, así que no hay que duplicar el `50% 40%` en JS.
## Body Pose (ml5 1.4.0) — contrato verificado contra el bundle

- **Con p5 2.x, `ml5.bodyPose()` devuelve una PROMESA, no la instancia.**
  ml5 detecta la versión de p5: si no encuentra `registerMethod` (p5 2.x) activa
  los *async constructors* y envuelve cada fábrica con `promisifyModel`, que
  devuelve `result.ready.then(() => result)`. Con p5 1.x devuelve la instancia.
  Siempre `const modelo = await ml5.bodyPose(...)`: `await` funciona en ambos.
  Hacer `ml5.bodyPose(...).ready` con p5 2.x da `undefined` → TypeError no
  capturado → la UI se queda en "cargando" para siempre, sin error visible.
- `ml5` tarda en cargar y ~9 MB en total la primera vez (4.4 MB de librería +
  4.4 MB de pesos de MoveNet). Por eso hay un timeout de aviso a los 45 s.
- Opciones MoveNet: `modelType` (`SINGLEPOSE_LIGHTNING`, `SINGLEPOSE_THUNDER`,
  `MULTIPOSE_LIGHTNING`; por defecto `MULTIPOSE_LIGHTNING`), `enableSmoothing`
  (default `true`), `minPoseScore` (default `0.25`). Usamos `SINGLEPOSE_LIGHTNING`.
- `detectStart(video, callback)` corre **su propio bucle** (~1 vez por frame) y
  entrega resultados por callback. `detectStop()` solo marca la señal. Nunca
  llamar `detectStart` dos veces sin `detectStop`: ml5 avisa y descarta la anterior.
- **Las coordenadas llegan en PÍXELES del video, no en 0..1.** Con MoveNet sobre
  un `<video>`, ml5 llama a `resizeKeypoints` y escala a `image.width/height`.
  Normalizar dividiendo por `video.width` / `video.height` antes de cualquier uso.
- Cada pose trae `pose.keypoints` (array) **y** propiedades con nombre:
  `pose.nose`, `pose.left_shoulder`, `pose.right_wrist`, … cada una
  `{ x, y, confidence }`. Se leen por nombre; los nombres son los 17 de COCO.
- `flipHorizontal` (alias `flipped`) espeja las coordenadas en ml5. **No se usa**:
  el espejo se aplica una sola vez, en `mapearPuntoCamara()`. Activarlo acá
  invertiría todo dos veces.
- Sin persona en cuadro el callback recibe un array vacío (`[]`), no un error:
  la ausencia de detección es un estado normal, no una excepción.

## Git

Ramas `main` y `develop`. El proyecto anterior en Three.js + Vite está
preservado en la rama `feature/three-vite`; no es la versión activa.
