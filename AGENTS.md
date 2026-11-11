# AGENTS.md

Experiencia web interactiva de conciencia ambiental. p5.js + ml5.js por CDN,
sin build, sin package manager, sin tests.

## Estado

Estructura base + captura de video + Body Pose (cuerpo) + Hand Pose (manos) +
gestos (mano abierta / puño) + cuatro plantas que crecen y florecen (la central,
la morada a la izquierda, la naranja a la derecha y una azul pequeña en el
segundo plano, con el mismo catálogo para sumar más) + paisaje
animado por viento + árboles que reverdecen con ese crecimiento mientras haya
manos en cuadro + personaje que camina en el fondo, se entristece y celebra con
las manos arriba cuando la planta crece. Del cuerpo se leen
nariz, ojos, orejas, hombros, codos, muñecas y caderas; de las manos, los 21
puntos de cada una.

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
| `sketch.js` | `setup()` / `draw()` de p5.js en modo global, escenario y viento, cámara, Body Pose, Hand Pose y gestos |
| `debug-pose.js` | modo depuración: esqueleto del cuerpo y de las manos sobre la cámara |
| `planta.js` | catálogo de plantas: crecimiento, floración, sacudida e inclinación, en su propia capa |
| `personaje.png` | sprite del personaje que camina en el fondo (**asset obligatorio**: sin él no aparece) |
| `personaje-feliz.png` | pose feliz del personaje, con las manos arriba (opcional: sin ella el estado feliz usa `personaje.png`) |
| `flor.png` | ilustración de la planta central (PNG con transparencia; **asset obligatorio**: sin él la planta no aparece) |
| `planta-morada.png` | ilustración de `planta_morada`, a la izquierda de la central (281×528, **sin alfa**: el fondo blanco se recorta al cargar; asset obligatorio) |
| `planta-naranja.png` | ilustración de `planta_naranja`, a la derecha de la central (249×609, **sin alfa**: mismo recorte al cargar; asset obligatorio) |
| `planta-azul.png` | ilustración de `planta_azul`, en el segundo plano a la derecha (249×601, **sin alfa**: mismo recorte al cargar) |

Cinco archivos de código y seis imágenes (el personaje con su pose feliz
opcional y las cuatro plantas). Si aparece un módulo nuevo, registrarlo en
`index.html` en el orden correcto y documentarlo acá.

## Escenario y viento (`sketch.js`)

El paisaje tiene ~1500 trazos, así que no se redibuja por frame. La escena se
parte en dos capas:

| Capa | Qué tiene | Cuándo se dibuja |
|---|---|---|
| Fondo congelado (`fondoEstatico`) | cielo con gradiente, bruma, tres franjas de suelo, chimeneas lejanas, piedras y ramas caídas | una vez en `construirEscenario()`, y otra vez al redimensionar |
| Capa viva | árboles (sprites), personaje, humo, rachas, polvo y pasto | cada frame en `dibujarEscenario()` |

- **Un solo viento manda**: `actualizarViento()` calcula `fuerzaViento` (0..1) y
  `direccionViento` con dos octavas de `noise`, una lenta (la ráfaga) y otra
  rápida (el pulso). Todo lo que se mueve lee esas dos variables, así que no hay
  relojes paralelos que se puedan desincronizar.
- La fuerza entra rápido (`ataque`) y sale lento (`relajo`), con amortiguación
  exponencial `1 - exp(-k·dt)`: el movimiento no depende del framerate.
- **Árboles**: cada uno se hornea en su propio `p5.Graphics` con el pie en
  `(0,0)`. Por frame se dibuja con `translate` + `rotate` + `image`, un giro que
  pivota en la base y cuesta una sola llamada por árbol. `balanceo` escala con la
  profundidad: el árbol cercano recorre más píxeles en la copa que el lejano.
  `VIENTO.velocidadVaiven` es el ritmo del vaivén; pasado ~2.5 se lee como
  vibración y no como viento.
- **Pasto**: posiciones y forma de cada brizna se sortean una vez en
  `crearMatujos()`. Cada brizna conserva su largo y gira sobre su base, así que
  al doblarse la punta baja. El ángulo se acota en `MATUJOS.anguloMaximo` (~77°):
  pasado 90° la punta se clavaría en la tierra.
- **Humo**: dos chimeneas lejanas viven en el fondo congelado y su penacho es
  capa viva. Una bocanada es un círculo que sube, se abre con el viento, crece y
  se desvanece; al llegar arriba se recicla abajo. `FABRICA.humoAlfa` (18) es el
  número que lo mantiene leve: si se sube, deja de ser fondo y pasa a ser niebla.
- **Polvo y rachas** se reciclan al salir por un borde: no se crean ni se
  destruyen objetos por frame.
- **Al redimensionar** no se redibuja de inmediato: `windowResized()` marca
  `escenaDesactualizada` y `draw()` reconstruye una sola vez. Sin eso, arrastrar
  la ventana reconstruiría el fondo y los 13 sprites en cada evento.
- `SEMILLA` se vuelve a fijar al construir: la composición es idéntica en cada
  sesión y en cada resize.

## Follaje: los árboles secos reverdecen (`sketch.js`)

- **Una sola fuente de siembra**: `objetivoDeVida()` lee
  `plantaDebug.crecimiento()`, que publica `planta.js`. El mismo crecimiento que
  estira el tallo con el puño cerrado es el que llena la copa de los árboles.
  No se duplica la lectura de gestos: si se tocara la planta, el bosque la sigue.
- **Las manos sostienen la vida** (`actualizarVida(dt)`, una vez por frame en
  `draw()`): mientras haya al menos una mano en cuadro, la vida va hacia ese
  crecimiento; cuando las manos se van, el objetivo baja a 0 y el bosque se
  apaga solo. Los árboles vuelven a quedar secos —la planta, en cambio, conserva
  su altura, que es su contrato de siempre—.
- **Gracia y tiempos**: `FOLLAJE.graciaSinManos` (0.5 s) absorbe los parpadeos
  del tracking, y encima ya existe la gracia de 250 ms de `fusionarManos`. La
  vida entra con `ataqueVida` (4.5) y se retira con `relajoVida` (1.6): pierde la
  mitad en ~0.9 s y a los 2 s ya no se nota. Ambas con amortiguación exponencial
  `1 - exp(-k·dt)`, así no dependen del framerate.
- Sin `planta.js` la vida es 0 y los árboles quedan secos, que es el estado
  original de la escena. `Number.isFinite` protege contra un `NaN`: sin eso el
  color del follaje se rompe en silencio.
- **No se hornea**: el sprite del árbol es un solo dibujo y el follaje es un
  estado. Se recogen hojas durante el mismo recorrido que dibuja las ramas
  (`dibujarRama` recibe el array `hojas`), así que nacen exactamente sobre las
  ramas y no hay una segunda geometría que se desincronice.
- Cada nudo de rama deja un **ramillete** de `FOLLAJE.racimo` hojas (posición,
  ángulo y escala). Con una hoja por rama se lee como puntos; con el ramillete,
  como copa.
- **La hoja se mide con el alto del árbol, no con su rama** (`FOLLAJE.tamanoHoja`
  = 0.07). Los árboles lejanos son 4× más chicos: si el tamaño saliera de la rama
  donde nació, el árbol lejano quedaba con hojas gigantes.
- **Geometría resuelta al construir**: `prepararHojas()` descarta hojas
  invisibles (`largoMinimo`), recorta al tope (`maximoPorArbol` 400) y precalcula
  los seis vértices de cada hoja ya rotados. Dibujar es sumar: ninguna
  trigonometría por frame.
- **Orden de aparición** (`hoja.orden` 0..1): la distancia al centro de la copa
  normalizada contra ESE árbol, más un reparto por número áureo. La copa se llena
  desde adentro hacia afuera, con el primer nivel de la planta ya visible, y dos
  hojas a la misma distancia no se abren en el mismo frame. `vida > orden`
  habilita la hoja, y se abre en `ventanaAparicion` (0.14) de crecimiento.
- **Un solo `fill` por árbol**: el follaje se dibuja con la API de canvas 2D
  (`contextoDeDibujo()`), un `beginPath` con un subcamino cerrado por hoja y un
  `fill` al final. Con un `fill()` de p5 por hoja serían ~2000 llamadas al canvas
  por frame; así son 13. `contextoDeDibujo()` usa `drawingContext` si está y, si
  no, llega al mismo contexto por `p5.instance.canvas`.
- **Tono**: cada plano tiene su par de verdes en `PALETA`
  (`hojaTierna*` → `hojaMadura*`). Se mezclan con la vida, así el brote entra
  amarillento y madura a verde profundo. `mezclarTono()` escribe en un array
  reutilizado: cero basura por frame.
- **Dibujo**: va dentro del mismo `push`/`rotate` del árbol, después del
  `image()`, para que las hojas se muevan con el viento y las ramas finas se lean
  por detrás del follaje.
- `window.escenarioDebug` expone `vida()`, `hojasPorArbol()` y `hojasTotales()`
  para comprobarlo desde la consola.
- Si se toca la recursión de `dibujarRama` hay que respetar la poda
  (`nivel <= 0 || grosor < 0.6 || largo < 2`): los árboles finos se cortan antes
  de llegar al último nivel, y por eso el follaje se cuelga de *todos* los nudos
  y no de un nivel fijo.

## Personaje (`sketch.js` + `personaje.png` + `personaje-feliz.png`)

- Vive en `sketch.js`, no en una capa propia: tiene que quedar **entre** los
  árboles del plano medio y los cercanos. Por eso `dibujarArbolesViento(t, plano)`
  se llama dos veces con el personaje en el medio; cada árbol lleva su `plano`
  (0 lejos, 1 medio, 2 cerca).
- `loadImage` en p5 2.x es **async**: devuelve una promesa, no la imagen, y
  `setup()` es sincrónico a propósito. Se carga con callbacks; si el archivo
  falta, el paisaje sigue andando y solo se pierde el personaje (error en
  consola con prefijo `[personaje]`).
- **Dos poses, no cuadros**: `personaje.png` (caminando/triste) y
  `personaje-feliz.png` (manos arriba). La feliz es **opcional**: si falta, el
  estado feliz usa la pose normal con el salto, pero los brazos quedan bajos.
  Ambas se cargan con callbacks y se recortan igual.
- **El fondo claro de cada sprite se recorta al cargar** (`recortarFondoClaro`):
  inunda desde los bordes y borra solo lo claro CONECTADO al borde. Un umbral
  global borraría también los ojos blancos del personaje. `PERSONAJE.toleranciaFondo`
  en 0 desactiva el recorte (útil si el PNG ya viene transparente).
- **Felicidad**: cuando `plantaDebug.crecimiento()` cruza
  `PERSONAJE.crecimientoFeliz` (0.05), el personaje pasa a `feliz` y ya no vuelve
  al ciclo triste: la planta se queda, así que la alegría también. Celebra
  caminando, con un salto y un vaivén más amplios (`saltoFeliz`,
  `balanceoFeliz`), y sin lágrimas.
- El caminar es un vaivén + un rebote por paso; la tristeza es un cabeceo
  (`inclinacionTriste`) más un `scaleY` (`hundimiento`). Todo suavizado con
  `1 - exp(-k·dt)` para que no haya saltos entre estados.
- Ciclo normal (antes de que crezca la planta): `caminando` → `mirando` (frena
  antes del árbol más alto del plano medio) → `triste` (cabecea y larga una
  lágrima cada `cadaLagrima` s) → `caminando` → sale por la derecha y reingresa
  por la izquierda. Con la planta crecida, el ciclo se reemplaza por `feliz`.
- `miradaHecha` es obligatorio: sin esa bandera, al retomar la caminata ya está
  parado sobre la marca de parada y volvería a frenar en el mismo árbol para
  siempre.
- La base se apoya en `bordeDeSuelo(x, CAPAS_SUELO[1])`: sigue el relieve y no
  flota en línea recta.
- Decidir la escala acá: `PERSONAJE.altura` (fracción del alto del lienzo) y
  `PERSONAJE.velocidad` (fracción del alto por segundo).
- La pose feliz se dibuja con **su propia proporción** (`imagen.width /
  imagen.height`): nunca se estira para calzar con la normal. Si la pose feliz
  tiene los brazos por encima de la cabeza, la imagen es más alta y el cuerpo
  queda más chico: se corrige con `PERSONAJE.escalaFeliz`.
- `PERSONAJE.ojo` (fracciones 0..1 de la imagen) ubica la lágrima. Si se recorta
  o se cambia el sprite, hay que moverlo.
- **Cada sprite tiene que estar recortado al contenido**, con los pies tocando
  el borde inferior: la imagen se ancla por su borde inferior contra el suelo,
  así que cualquier margen transparente abajo lo hace flotar. El `personaje.png`
  actual está recortado (758×1271, con alfa).

## Modo depuración (`debug-pose.js`)

- Es una capa **independiente**: no toca el escenario, ni `draw()`, ni la
  detección. Solo lee `obtenerPoseBusto()` / `obtenerEstadoPose()`.
- Corre en **su propio `requestAnimationFrame`**: es una capa independiente y no
  depende del `draw()` de p5.
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
- `draw()` corre a 60 fps (sin `noLoop()`), pero **nada caro se dibuja por
  frame**: el fondo vive en un `p5.Graphics` y los árboles en sprites. Si se
  agrega algo animado, tiene que ser liviano o cachearse igual.
- Todos los números y colores visibles viven en `:root` de `style.css`; los del
  paisaje, en `PALETA`, `VIENTO`, `MATUJOS`, `POLVO_AIRE`, `RACHAS` y `FABRICA`
  de `sketch.js`.

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

## Plantas (`planta.js`)

- **Capa propia, no el canvas de p5.** El paisaje está cacheado con `noLoop()`;
  redibujar sus ~1600 trazos por frame para animar el crecimiento lo haría
  inviable. `#planta-overlay` es un canvas transparente encima del de p5, mismo
  rectángulo, así las coordenadas coinciden sin conversiones.
- Por eso `sketch.js` **no** se tocó: ni `setup()`, ni `draw()`, ni el paisaje.
- **Un catálogo, no un caso especial.** `PLANTAS` en `planta.js` es una lista de
  plantas; cada entrada define `id`, `archivo`, `x`, `altura`, `capaSuelo`,
  `separacionSuelo`, `talloX`, `faseViento`, `toleranciaFondo` y `corola`. La
  interacción —crecimiento, floración, sacudida, inclinación y viento— es **una
  sola** y la comparten todas. Para sumar otra planta alcanza con agregar un
  objeto a la lista; no hay que tocar ninguna interacción.
- **Profundidad = orden de la lista + capa de suelo**. La lista se dibuja de
  atrás hacia adelante (la primera queda debajo) y `capaSuelo` decide de qué
  franja del terreno nace: `0` lejos, `1` medio, `2` cerca. La `planta_azul` va
  primera y en la capa `1`, con `altura` 0.24 —un poco por encima de los
  árboles de ese plano (0.16–0.23)— para que la flor se lea como planta y siga
  claramente detrás de las tres del primer plano (0.36–0.42).
- **Cada planta tiene su propio estado**: imagen, proporción, `crecimiento`,
  `florecimiento` y partículas. El objetivo lo calculan las manos una vez y cada
  planta lo alcanza con su suavizado, así no comparten la variable de dibujo.
- **Sumar otra planta**: (1) copiar el PNG recortado con el nombre
  `planta-<color>.png`; (2) agregar un objeto a `PLANTAS` con `id`, `archivo`,
  `x`, `altura`, `capaSuelo`, `toleranciaFondo` y su `corola`, en la posición de
  la lista que le corresponde por profundidad; (3) nada más. No hace falta tocar
  gestos, `sketch.js`, `index.html` ni la cámara. El orden de la lista es el de
  dibujo: la primera queda debajo.
- `planta-<color>.png` es la fuente única de cada ilustración: se dibuja tal
  cual, con sus colores, pétalos y proporciones. `planta.js` no redibuja nada;
  solo la escala, la inclina, la sacude y la revela. El PNG tiene que venir
  recortado al contenido y con el tallo tocando el borde inferior: la imagen se
  ancla por su base contra el suelo.
- **Crecimiento = escala uniforme anclada en la base**: el alto dibujado es
  `alto * altura * crecimiento` y el ancho sale de la proporción real del PNG
  (`naturalWidth / naturalHeight`). Nunca se estira ni se comprime, y la base
  queda clavada sobre el suelo mientras la planta crece hacia arriba.
- `altura` (fracción del alto del lienzo al 100%) y `x` (fracción del ancho) son
  de cada planta: la central va en `0.5` / `0.42`, la morada en `0.25` / `0.36`,
  la naranja en `0.76` / `0.36` y la azul en `0.86` / `0.24`. Cada `faseViento`
  distinta evita que se mezan al unísono.
- La imagen se carga con callbacks (`new Image()`), como el personaje. Hasta que
  no está lista esa planta no se dibuja; si falta el archivo, el resto de la
  experiencia sigue andando y solo se pierde esa planta.
- **`toleranciaFondo`**: si el PNG no trae alfa (como `planta-morada.png`, que
  viene en RGB con fondo blanco), se recorta al cargar reutilizando
  `recortarFondoClaro()` de `sketch.js` —el mismo algoritmo del personaje, un
  solo lugar—. Inunda desde los bordes, así los blancos internos de la
  ilustración no se borran. Después se limpia el blanco **puro** que quedó
  encerrado entre las campanas, que ninguna inundación desde el borde alcanza.
  En `0` se desactiva (`flor.png` ya trae alfa).
- **Contrato con `sketch.js`**: `plantaDebug.crecimiento()` y
  `plantaDebug.florecimiento()` hablan de la planta **central**, marcada con
  `principal: true` en el catálogo. El follaje y el personaje leen de ahí; por
  eso la central no se saca de la lista y su `principal` no se mueve, aunque
  cambie el orden de dibujo.
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
- La base se ancla con `bordeDeSuelo()` y `CAPAS_SUELO` de `sketch.js`, en la
  capa que declara cada planta, así nace sobre la tierra dibujada y no flota.
- `window.plantaDebug.nivelDesdeAltura(y)` expone el mapeo para comprobarlo
  desde la consola; `plantaDebug.plantas()` y `crecimientoDe(id)` muestran el
  estado de cada una.
- Verificado en Node: y=0.85 → 10%, 0.72 → 30%, 0.50 → 50%, 0.40 → 75%,
  0.20 → 100%, y el mapeo es monótono en toda la banda.

### Florecimiento

- **Estado separado del crecimiento**: `florecimiento` (0..1) depende solo de
  que haya una mano abierta (`mano.gesto.estado === 'abierta'`). Abrir o cerrar
  la mano **no toca** `crecimiento` ni `objetivo`: la altura se conserva.
- Sin mano abierta el objetivo de floración vuelve a 0, así que la corola se
  vuelve a cerrar progresivamente (también al hacer puño).
- `VELOCIDAD_FLORACION` (2.6) es menor que `VELOCIDAD_CRECIMIENTO` (4.5): la
  flor abre más lento que el crecimiento, y se siente natural.
- **La corola se revela, no se deforma.** Con la mano abierta un degradado
  radial (`corola` de cada entrada, en fracciones del alto de la ilustración)
  descubre la flor desde su base hacia afuera: `radioMinimo` es el capullo y
  `radioMaximo` cubre la corola entera. Los pétalos nunca se estiran ni se
  comprimen; se dejan de tapar.
- **El tallo y las hojas no florecen.** Debajo de `corola.juntura` la imagen se
  repinta completa, así la flor siempre queda unida al suelo y el revelado no
  puede cortar el tallo.
- Técnica: `globalCompositeOperation = 'destination-in'` con el degradado, y
  después `source-over` + `clip` para repintar la parte baja. A `florecimiento`
  ≥ 0.999 se saltea la máscara y se ve la ilustración original completa.
- **`destination-in` borra TODO lo que la máscara no cubre**, no solo el
  rectángulo que se rellena. Con una sola planta no se notaba; con varias se
  llevaba puestas las que ya estaban dibujadas. Por eso el revelado empieza con
  un `clip()` a la caja de su propia ilustración: si se agrega una planta, no
  hay que tocar nada, pero si se cambia la técnica, esa es la razón del clip.
- Verificado en Node simulando 60 fps: puño a y=0.45 → crecimiento 0.75;
  luego mano abierta → floración 0.99 y **crecimiento sigue en 0.75**; al cerrar
  → floración 0 y altura intacta; sin manos → se cierra solo.

### Sacudida y partículas

- Se mide sobre la **muñeca** (`keypoints[0]`), no sobre el gesto: la sacudida
  no depende de que la mano esté abierta o cerrada.
- Dos condiciones juntas, no una: **velocidad** ≥ `VELOCIDAD_MINIMA_SACUDIDA`
  (0.9 unidades normalizadas/s) **y** al menos `CAMBIOS_NECESARIOS` (3) cambios
  de dirección de la `x` dentro de `VENTANA_SACUDIDA_MS` (700 ms).
  Un barrido amplio en una sola dirección NO dispara nada — verificado.
- `PASO_MINIMO_SACUDIDA` (0.01) descarta el temblor del tracking.
- La intensidad entra rápido (`ATAQUE_SACUDIDA` 14) y sale lento
  (`RELAJO_SACUDIDA` 3.5): al dejar de sacudir, el temblor se apaga solo.
- El temblor **pivota en la base** de la planta (`translate`/`rotate`/
  `translate`), no la traslada: es un tallo que se sacude, no un objeto que se
  desliza.
- El temblor son **dos armónicos** (`FRECUENCIA_TEMBLOR` 0.019 rad/ms ≈ 3 Hz,
  más un segundo a 1.73× con 35 % de amplitud): se lee como un tallo que vibra,
  no como un metrónomo. `AMPLITUD_TEMBLOR` (0.06 rad) es el pico a intensidad 1.
- Partículas: máximo `MAX_PARTICULAS` (140), emisión `EMISION_MAXIMA` por segundo
  × intensidad. Cada una con tamaño, velocidad y vida aleatorios; frenan por
  roce y flotan hacia arriba. El alfa cae con la vida restante, así desaparecen
  gradualmente.
- Verificado en Node: deriva lenta → 0 partículas; barrido en una dirección → 0;
  sacudida real → intensidad 1.0 y 86 partículas; al parar → 0 en ~5 s y la
  altura de la planta intacta.

### Inclinación

- Se calcula con el **vector** muñeca (`keypoints[0]`) → centro de la palma
  (promedio de los nudillos `5, 9, 13, 17`), nunca con la posición. Por eso
  mover la mano de lado no inclina nada: solo girarla. Verificado moviendo la
  misma mano inclinada a x=0.25 y x=0.75 → idéntico resultado.
- `atan2(dx, dy)` da 0 con los dedos hacia arriba y positivo cuando la mano se
  inclina a la derecha **tal como la ve el usuario**: la `x` está espejada para
  compensar que la cámara se muestra en espejo.
- Zona muerta `ANGULO_MUERTO` (0.1 rad ≈ 6°) y saturación en `ANGULO_MAXIMO`
  (0.6 rad ≈ 34°), que corresponde a `INCLINACION_MAXIMA` (0.28 rad ≈ 16°) de
  la planta.
- **Resorte amortiguado, no lerp**: `RESORTE_INCLINACION` da inercia y un
  asentamiento corto. Seguir la mano es más rígido (`rigidezSeguir` 60) que
  volver al centro (`rigidezVolver` 16), así el regreso sigue siendo lento. Se
  integra en subpasos de 1/120 s para que un `dt` grande no lo desestabilice.
  Sin manos también vuelve a 0.
- **Vaivén ambiental**: `balanceoDelAire()` suma un mecido lento que lee
  `fuerzaViento` y `direccionViento` de `sketch.js`, el mismo viento de los
  árboles. Es solo presentación: no toca `inclinacion` ni la lógica del gesto.
- El ángulo final de dibujo es `inclinacion + temblor + balanceoDelAire`: la
  mano, la sacudida y el viento se suman sin pisarse.
- Verificado con el banco headless: mano inclinada → `incl=0.280` y vuelve a
  `incl=0.000` al enderezarla; sacudida → `sacu=1.000` con 56 partículas.

### Integración entre interacciones (revisado)

Las cuatro comparten la misma mano, así que se auditaron cruces. Dos estaban
rotos y se corrigieron acá:

- **Inclinar movía la altura.** Girar la mano desplaza el centro de la palma
  ~2-3% de la banda, suficiente para cruzar un borde. Se resolvió con
  **histéresis de nivel** (`MARGEN_NIVEL` 0.03): para cambiar de nivel hay que
  pasar el borde con margen.
- **Sacudir hacía saltar el nivel ~50 veces.** El vaivén vertical de la muñeca
  se leía como "elegir una altura". Se resolvió con `congelarAltura`: la altura
  solo se actualiza si la muñeca va lenta (`VELOCIDAD_CONGELAMIENTO_NIVEL`), no
  hay vaivén reciente (2 reversiones) y no hay sacudida activa.
- La velocidad instantánea sola **no alcanza**: en los extremos del vaivén pasa
  por cero, y ahí es justo donde se colaba la actualización. Por eso también
  congela el vaivén sostenido.
- Medido antes/después: inclinar 3 → **0** cambios de nivel; sacudir 50 → **1**
  (solo el transitorio del arranque).
- No rompe el gesto: subir el puño despacio sigue moviendo el nivel; un salto
  rápido lo actualiza al detenerse.
- `plantaDebug.nivelDesdeAltura()` sigue siendo el mapeo puro sin histéresis;
  el comportamiento real pasa por `nivelConHisteresis()`.

## Git

Ramas `main` y `develop`. El proyecto anterior en Three.js + Vite está
preservado en la rama `feature/three-vite`; no es la versión activa.
