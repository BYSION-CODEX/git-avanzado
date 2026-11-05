# AGENTS.md

Experiencia web interactiva de conciencia ambiental. p5.js + ml5.js por CDN,
sin build, sin package manager, sin tests.

## Estado

Estructura base + captura de video + Body Pose (cuerpo) + Hand Pose (manos).
Del cuerpo se leen nariz, ojos, orejas, hombros, codos, muñecas y caderas; de
las manos, los 21 puntos de cada una. **No hay interacciones, ni gestos, ni
animación**: el escenario sigue estático.

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
| `debug-pose.js` | modo depuración: esqueleto del cuerpo y de las manos sobre la cámara |
| `planta.js` | crecimiento de la planta con el gesto de puño, en su propia capa |

Cinco archivos. Si aparece un módulo nuevo, registrarlo en `index.html` en el
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

## Hand Pose (ml5 1.4.0) — contrato verificado contra el bundle

- **También es constructor asíncrono con p5 2.x**: `await ml5.handPose({...})`.
  Sin `await` devuelve un Promise y cualquier `.ready` sobre él es `undefined`.
- Opciones: `maxHands` (default 2), `modelType` (`lite`|`full`, default `full`),
  `runtime` (`tfjs`|`mediapipe`, **default `tfjs`**), `solutionPath` (sólo
  mediapipe), `detectorModelUrl` / `landmarkModelUrl` (sólo tfjs).
  Usamos `tfjs` + `lite` porque ya corre MoveNet al mismo tiempo.
- **Los 21 keypoints llegan en PÍXELES**, no normalizados: ml5 los multiplica por
  `video.width` / `video.height` (`src_X` en el bundle). Normalizar al entrar.
- **No hay confianza por punto**, sólo `hand.confidence` por mano. El filtro de
  confianza es por mano, no por dedo.
- `hand.handedness` es un **string** (`'Left'` / `'Right'`), no un array.
- Nombres e índices (MediaPipe): 0 `wrist`; 1-4 pulgar; 5-8 índice;
  9-12 medio; 13-16 anular; 17-20 meñique. El sufijo del meñique es
  `pinky_finger_*` (con `_finger`).
- `handPose.getConnections()` devuelve los pares de índices del esqueleto.
  Usarlos en vez de hardcodear las 21 conexiones.
- ml5 **no suaviza** las manos (no hay `enableSmoothing` como en MoveNet): el
  suavizado y la gracia anti-parpadeo los hace `fusionarManos()` en `sketch.js`.

## Gestos (puño / mano abierta)

- Toda la lógica vive en `sketch.js` y no depende de ml5: ml5 entrega puntos,
  **no** gestos. `puntuacionApertura()` los clasifica.
- Métrica por dedo, ambas señales adimensionales y sin ángulos absolutos, para
  que no importe cómo esté orientada la mano:
  - `rectitud` = distancia punta→nudillo / recorrido nudillo→punta (1 = estirado).
  - `alcance` = distancia punta→muñeca / nudillo→muñeca.
- **El pulgar no decide el gesto.** En un puño real puede quedar afuera; incluirlo
  generaba falsos negativos. Se analizan índice, medio, anular y meñique.
- `gestoObjetivo()` aplica **histéresis**: para entrar en un estado hace falta más
  puntaje que para salir. `evaluarGesto()` agrega **dwell** de 150 ms: el cambio
  tiene que sostenerse antes de confirmarse. Sin las dos cosas, el gesto parpadea.
- Estados: `abierta`, `cerrado`, `indefinido` → textos `MANO ABIERTA`,
  `PUÑO CERRADO`, `GESTO NO RECONOCIDO`.
- Umbrales en `sketch.js`: `UMBRAL_ABIERTA` 0.62 / `UMBRAL_ABIERTA_SALIDA` 0.52;
  `UMBRAL_CERRADO` 0.30 / `UMBRAL_CERRADO_SALIDA` 0.40. El número que se muestra
  al lado del gesto en pantalla es la puntuación real: sirve para recalibrar.
- Verificado con manos sintéticas en Node: abierta → 1.00, puño → 0.03,
  dedo a 90° → 0.47 (indefinido), y una serie temblando entre 0.56 y 0.64 se
  queda en `abierta` sin cambiar de estado.

## Planta (`planta.js`)

- **Capa propia, no el canvas de p5.** El paisaje está cacheado con `noLoop()`;
  redibujar sus ~1600 trazos por frame para animar el crecimiento lo haría
  inviable. `#planta-overlay` es un canvas transparente encima del de p5, mismo
  rectángulo, así las coordenadas coinciden sin conversiones.
- Por eso `sketch.js` **no** se tocó: ni `setup()`, ni `draw()`, ni el paisaje.
- Altura de la mano = **centro de la palma** (promedio de muñeca `keypoints[0]`
  y base del dedo medio `keypoints[9]`), en coordenadas ya normalizadas 0..1.
- Banda útil `BANDA_Y_ABAJO` 0.85 → `BANDA_Y_ARRIBA` 0.20. Fuera de ahí no hay
  más recorrido.
- Cinco niveles: 10%, 30%, 50%, 75%, 100% (`NIVELES` en `planta.js`).
- Solo crece con **puño cerrado** (`mano.gesto.estado === 'cerrado'`). Sin puño
  el objetivo no cambia y la planta se queda donde está. Con dos puños manda el
  más alto.
- La animación usa amortiguación exponencial (`1 - exp(-k*dt)`), no un lerp con
  alfa fijo: el crecimiento es fluido y no depende del framerate.
- La base se ancla con `bordeDeSuelo()` y `CAPAS_SUELO` de `sketch.js`, así la
  planta nace sobre la tierra dibujada y no flota.
- `window.plantaDebug.nivelDesdeAltura(y)` expone el mapeo para comprobarlo
  desde la consola.
- Verificado en Node: y=0.85 → 10%, 0.72 → 30%, 0.50 → 50%, 0.40 → 75%,
  0.20 → 100%, y el mapeo es monótono en toda la banda.

## Git

Ramas `main` y `develop`. El proyecto anterior en Three.js + Vite está
preservado en la rama `feature/three-vite`; no es la versión activa.
