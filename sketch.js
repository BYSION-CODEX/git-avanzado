/* ============================================================
   El cambio florece contigo — sketch de p5.js
   Modo global: p5.js llama a setup() y draw() por su cuenta.

   Estado actual:
   - Escenario animado: el paisaje se mueve con un viento continuo (árboles,
     pasto, polvo y rachas). La planta de planta.js crece encima.
   - Los árboles secos reverdecen con el mismo crecimiento de esa planta, pero
     solo mientras haya manos en cuadro: sin manos el bosque se apaga y vuelve
     a quedar seco (ver FOLLAJE y actualizarVida()).
   - Captura de video de la cámara montada en #camara-contenedor.
   - Body Pose y Hand Pose corriendo sobre ese video.

   Nota de rendimiento: el paisaje de fondo son dos PNG preestáticos
   (`fondo_gris_neblina.png` y `fondo_atardecer_color.png`) que se dibujan con
   el mismo encuadre; la opacidad del atardecer sigue el crecimiento de las
   plantas. Solo se anima la capa con pocos trazos: nubes, destellos, árboles
   cacheados como sprites, pasto, polvo y rachas.
   El follaje no se hornea: son polígonos ya resueltos que se dibujan solo si
   el crecimiento de la planta ya habilitó esa hoja (máximo 34 por árbol).
   ============================================================ */

/* ---------- Ciclo de vida de p5 ---------- */

/**
 * Se ejecuta una sola vez al cargar la página.
 * Monta el canvas en su contenedor y luego pide la cámara.
 */
function setup() {
  const contenedor = document.getElementById('lienzo-contenedor');

  // Si el HTML cambió de nombre o se borró el contenedor, avisamos claro
  // en vez de fallar con un error opaco de p5.
  if (!contenedor) {
    console.error('[sketch] No se encontró #lienzo-contenedor en index.html.');
    return;
  }

  const lienzo = createCanvas(contenedor.clientWidth, contenedor.clientHeight);
  lienzo.parent(contenedor);

  // Sin esto, un monitor de alta densidad cuadruplica el costo de dibujo.
  pixelDensity(1);

  // El panel puede cambiar de alto después de setup() (por ejemplo, cuando la
  // cámara termina de cargar y aparecen sus textos). Sin esto el canvas queda
  // más chico que su marco y el paisaje no llena el lienzo visible.
  observarTamanoLienzo(contenedor);

  // Escenario vivo: draw() corre a 60 fps y el viento avanza cada frame.
  // El paisaje son dos PNG que se precargan ya, antes de cualquier interacción.
  cargarFondosPaisaje();
  construirEscenario();

  // El personaje que caminaba en el fondo se retiró de la escena.

  // La cámara se pide al final: si falla, el escenario ya está funcionando.
  iniciarCamara();
}

/** Un frame de la escena: actualiza el viento y dibuja el paisaje vivo. */
function draw() {
  // Un resize durante el arrastre dispara muchos eventos: se reconstruye una
  // sola vez, en el frame siguiente, y no una vez por evento.
  if (escenaDesactualizada) construirEscenario();

  // Acotado: al volver de una pestaña en segundo plano deltaTime puede valer
  // segundos y el viento daría un salto.
  const dt = Math.min(deltaTime / 1000, 0.05);
  relojEscena += dt;

  actualizarViento(dt);
  actualizarVida(dt);
  actualizarPaisajeInteractivo(dt);
  dibujarEscenario(relojEscena, dt);
}

/**
 * Mantiene el canvas del tamaño de su contenedor cuando cambia la ventana.
 * El fondo y los sprites están dimensionados en píxeles, así que hay que
 * volver a construirlos: se marca la escena como desactualizada y draw() se
 * encarga una sola vez.
 */
function windowResized() {
  const contenedor = document.getElementById('lienzo-contenedor');
  if (!contenedor || typeof width === 'undefined') return;

  resizeCanvas(contenedor.clientWidth, contenedor.clientHeight);
  escenaDesactualizada = true;
}

/**
 * El alto del panel no solo cambia al redimensionar la ventana: también cuando
 * la cámara pasa de "cargando" a "lista" o "error" y sus textos reorganizan el
 * grid. El ResizeObserver ajusta el canvas a su marco en ese caso y reconstruye
 * la escena una sola vez.
 */
let observadorLienzo = null;

function observarTamanoLienzo(contenedor) {
  if (typeof ResizeObserver === 'undefined' || !contenedor) return;

  if (observadorLienzo) observadorLienzo.disconnect();

  observadorLienzo = new ResizeObserver(() => {
    const ancho = contenedor.clientWidth;
    const alto = contenedor.clientHeight;
    if (!ancho || !alto) return;
    if (Math.abs(width - ancho) < 2 && Math.abs(height - alto) < 2) return;

    resizeCanvas(ancho, alto);
    escenaDesactualizada = true;
  });

  observadorLienzo.observe(contenedor);
}

/* ============================================================
   ESCENARIO
   El paisaje es un PNG (gris con neblina) con un segundo PNG a color
   encima cuya opacidad la gobierna el crecimiento de las plantas.
   La capa viva sigue siendo procedural: árboles que reverdecen, pasto,
   polvo, rachas, nubes y destellos.
   ============================================================ */

/** Semilla fija: la composición es idéntica en cada reconstrucción. */
const SEMILLA = 20261105;

/**
 * Paleta de la capa viva. El paisaje ya no se pinta con colores: es un PNG.
 * Quedan los tonos de árboles, pasto, polvo y el gris de respaldo del fondo.
 */
const PALETA = {
  // Respaldo opaco mientras los PNG terminan de cargar.
  cieloBajo: [150, 154, 158],
  polvo: [212, 216, 220],

  arbolLejos: [110, 116, 122],
  arbolMedio: [70, 74, 78],
  arbolCerca: [26, 27, 29],

  pastoSeco: [99, 96, 87],

  // Follaje: dos extremos que se mezclan según la vida del paisaje. `tierno` es
  // el verde amarillo del brote que acaba de salir; `maduro`, el verde apagado
  // de una copa ya hecha. El tercer tono de cada familia es el plano.
  hojaTiernaLejos: [148, 152, 116],
  hojaTiernaMedio: [128, 140, 94],
  hojaTiernaCerca: [100, 116, 72],

  hojaMaduraLejos: [110, 124, 96],
  hojaMaduraMedio: [86, 106, 68],
  hojaMaduraCerca: [56, 80, 44],
};

/**
 * Follaje de los árboles: la vida que devuelve el paisaje.
 *
 * No se hornea en el sprite del árbol porque tiene que aparecer de a poco: el
 * sprite es un solo dibujo y el follaje es un estado. Las hojas viven como
 * polígonos ya resueltos en coordenadas del árbol (sin trigonometría por frame)
 * y se dibujan solo las que el crecimiento de la planta ya habilitó.
 *
 * La fuente de la vida es planta.js: el mismo `crecimiento` que mueve el tallo
 * con el puño cerrado. Una sola variable manda, así el bosque y la planta no se
 * pueden desincronizar.
 */
const FOLLAJE = {
  maximoPorArbol: 400, // tope de hojas por árbol (un solo path por árbol)
  largoMinimo: 2.5, // px: una hoja más chica que esto no se ve y solo cuesta
  tamanoHoja: 0.07, // fracción del alto del árbol: igual densidad en los 3 planos
  anchoHoja: 0.44, // relación ancho/largo de la hoja
  ventanaAparicion: 0.14, // fracción de crecimiento en la que una hoja se abre

  /**
   * La vida se sostiene con las manos en cuadro. Mientras haya una, el bosque
   * sigue el crecimiento de la planta; cuando se van, se apaga solo y los
   * árboles vuelven a quedar secos.
   *
   * `graciaSinManos` absorbe los parpadeos del tracking (y la gracia de 250 ms
   * que ya trae `fusionarManos`): si la mano desaparece un instante, el bosque
   * no se apaga. `relajoVida` es más lento que `ataqueVida` a propósito: volver
   * se siente como que responde, irse como que se apaga.
   */
  ataqueVida: 4.5,
  relajoVida: 1.6,
  graciaSinManos: 0.5,
  /**
   * Ramillete de cada nudo: diez hojas que salen del mismo punto. Una sola
   * hoja por rama se lee como un punto; diez, como un trozo de copa.
   * `avance` corre el brote sobre la dirección de la rama, `escala` lo achica.
   */
  racimo: [
    { avance: 0, giro: 0, escala: 1 },
    { avance: 0.55, giro: 0, escala: 0.72 },
    { avance: 0.3, giro: 0.75, escala: 0.9 },
    { avance: 0.3, giro: -0.75, escala: 0.9 },
    { avance: 0.12, giro: 1.4, escala: 0.78 },
    { avance: 0.12, giro: -1.4, escala: 0.78 },
    { avance: 0.42, giro: 1.9, escala: 0.8 },
    { avance: 0.42, giro: -1.9, escala: 0.8 },
    { avance: 0.6, giro: 1.1, escala: 0.68 },
    { avance: 0.6, giro: -1.1, escala: 0.68 },
  ],
  // Un par de tonos por plano: 0 lejos, 1 medio, 2 cerca.
  tonos: [
    { tierno: PALETA.hojaTiernaLejos, maduro: PALETA.hojaMaduraLejos },
    { tierno: PALETA.hojaTiernaMedio, maduro: PALETA.hojaMaduraMedio },
    { tierno: PALETA.hojaTiernaCerca, maduro: PALETA.hojaMaduraCerca },
  ],
};

/* ---------- Viento: configuración ---------- */

/**
 * Los árboles son paisaje de fondo, no protagonistas: se dibujan al 50 % de
 * opacidad para que las plantas recorten sin mezclarse con la copa. Aplica al
 * sprite y al follaje por igual.
 */
const ARBOLES = {
  alfa: 0.5,
};

/**
 * El viento nunca se detiene ni llega a huracán. La fuerza sale de dos octavas
 * de noise —una lenta, la ráfaga; otra rápida, el pulso—, así no se lee como
 * una senoide repetida. Con las semillas de noise fijas, el patrón es el mismo
 * en cada sesión: la escena se puede ensayar.
 */
const VIENTO = {
  fuerzaMinima: 0.2, // aun en calma el aire se mueve un poco
  velocidadRafaga: 0.22,
  ataque: 3.4, // la ráfaga entra rápido
  relajo: 0.85, // y se desarma lento
  direccionMedia: 1, // sopla hacia la derecha
  direccionAmplitud: 0.32, // pero no siempre con la misma fuerza
  semillaRafaga: 4.2,
  semillaPulso: 9.7,
  semillaDireccion: 17.3,
  velocidadDireccion: 0.07,
  // Frecuencia del vaivén de cada árbol. Más alto = ramas que se sacuden
  // antes; pasado ~2.5 se ve como vibración, no como viento.
  velocidadVaiven: 1.75,
};

/**
 * Matujos de pasto seco. Cada brizna guarda su inclinación, su largo y su
 * rigidez: sin esa variedad las 26 matas se doblarían al unísono y el viento
 * se vería de plástico.
 */
const MATUJOS = {
  cantidad: 26,
  alturaMinima: 0.026,
  alturaMaxima: 0.078,
  doblezMaximo: 0.85, // radianes de doblez a viento máximo (~49°)
  anguloMaximo: 1.35, // ~77°: pasado 90° la punta se clava en la tierra
  temblorMaximo: 0.3,
  velocidadTemblor: 5.5,
  segmentos: 5,
};

/** Polvo en suspensión: partículas que el viento arrastra y recicla. */
const POLVO_AIRE = {
  cantidad: 150,
  tamanoMinimo: 0.9,
  tamanoMaximo: 2.2,
  alfaMinimo: 6,
  alfaMaximo: 20,
  empujeMinimo: 12, // px/s con el aire en calma
  empujeMaximo: 120, // px/s a viento máximo
};

/** Rachas: líneas tenues que cruzan el cielo y delatan la corriente de aire. */
const RACHAS = {
  cantidad: 7,
  largoMinimo: 0.05,
  largoMaximo: 0.17,
  alfa: 20,
  velocidadMinima: 18,
  velocidadMaxima: 60,
};

/**
 * Paisaje de fondo: dos PNG con la MISMA composición. El gris va abajo y el
 * atardecer encima; su opacidad sigue el crecimiento de las plantas, así la
 * escena arranca en neblina y se llena de color a medida que crece la vida.
 *
 * Los dos se dibujan con el mismo encuadre y el mismo punto de alineación
 * (`alineacion`), así las colinas quedan clavadas y el cruce no da saltos.
 * Se precargan juntos en setup(): la transición funciona desde la primera
 * interacción, no desde la primera carga diferida.
 */
const FONDO_PAISAJE = {
  rutaGris: 'fondo_gris_neblina.png',
  rutaAtardecer: 'fondo_atardecer_color.png',
  // Encaje tipo `object-fit: cover`: escala el máximo de ancho y alto.
  // El punto de alineación es el mismo para los dos fondos.
  alineacion: { x: 0.5, y: 0.5 },
  // Amortiguación exponencial de la opacidad: no depende del framerate.
  velocidadEntrada: 3.2,
  velocidadSalida: 4.5,
};

/**
 * Nubes suaves de la capa intermedia: delante del paisaje y detrás de las
 * plantas. Arrancan grises y con alfa bajo; a medida que aparece el atardecer
 * viran a rosa pálido o lila. Tres velocidades distintas para que no se muevan
 * en bloque.
 */
const NUBES = {
  modelos: [
    { y: 0.11, ancho: 0.42, velocidad: 0.011, alfa: 0.09, tono: 'rosa' },
    { y: 0.19, ancho: 0.34, velocidad: 0.017, alfa: 0.12, tono: 'lila' },
    { y: 0.27, ancho: 0.52, velocidad: 0.007, alfa: 0.06, tono: 'rosa' },
  ],
  proporcion: 0.36, // alto del sprite en relación a su ancho
  alfaMinimo: 0.06,
  alfaMaximo: 0.12,
  // La opacidad inicial vive dentro de [0.06, 0.12]; al crecer se permite un
  // poco más para que el cambio de tono se note sin tapar el paisaje.
  alzaConCrecimiento: 0.25,
  tonoGris: [204, 208, 214],
  tonoRosa: [243, 196, 212],
  tonoLila: [205, 188, 228],
};

/**
 * Destellos cálidos cerca del horizonte. Aparecen y se desvanecen con un pulso
 * propio, cada uno en un momento distinto, y nunca superan 0.18 de opacidad.
 */
const DESTELLOS_PAISAJE = {
  cantidad: 12,
  yMin: 0.44, // fracción del alto: banda del horizonte de las imágenes
  yMax: 0.57,
  radioMinimo: 1.1,
  radioMaximo: 2.6,
  alfaMaximo: 0.18,
  frecuenciaMinima: 0.22, // ciclos por segundo
  frecuenciaMaxima: 0.62,
  desde: 0.18, // progreso en el que empiezan a asomar
  hasta: 0.72, // progreso en el que ya están plenos
  tonoCalido: [255, 216, 160],
  tonoRosa: [255, 190, 206],
};

/**
 * Oleada única de destellos dorados y rosados que se dispara al florecer. Va
 * detrás de las flores porque se dibuja en el canvas de p5, debajo de la capa
 * `#planta-overlay`. Se rearma sola cuando la floración se cierra.
 */
const OLEADA_FLORES = {
  cantidad: 54,
  duracionMinima: 0.9,
  duracionMaxima: 1.6,
  radioMinimo: 1.4,
  radioMaximo: 3.4,
  alfaMaximo: 0.32,
  dispersionX: 0.13, // fracción del ancho alrededor de cada flor
  dispersionY: 0.09, // fracción del alto
  subida: 0.1, // fracción del alto por segundo
  tonoDorado: [255, 208, 128],
  tonoRosa: [255, 172, 198],
  disparo: 0.55, // floración que enciende la oleada
  rearme: 0.15, // floración por debajo de la cual se puede volver a disparar
};

/**
 * Personaje que camina por el plano medio, en bucle, y se detiene a mirar un
 * árbol seco antes de ponerse triste. Es un sprite único: no hay cuadros de
 * animación, así que el caminar y la tristeza se resuelven con transformaciones
 * (vaivén, inclinación y hundimiento) sobre la misma imagen.
 */
const PERSONAJE = {
  // Tiene que estar en la raíz del proyecto, junto a index.html, servido por el
  // mismo origen. Sin este archivo el sketch funciona igual, sin personaje.
  rutaImagen: 'personaje.png',
  // Pose feliz con las manos arriba. Es opcional: si falta, el estado feliz
  // usa el sprite de siempre (con el salto, pero sin cambiar la pose).
  rutaImagenFeliz: 'personaje-feliz.png',
  altura: 0.14, // fracción del alto del lienzo
  velocidad: 0.05, // fracción del alto por segundo (lento: está lejos)
  pasos: 1.45, // pasos por segundo
  balanceoPaso: 0.022, // radianes de vaivén mientras camina
  inclinacionMirar: -0.07, // se echa atrás para mirar hacia arriba
  inclinacionTriste: 0.1, // cabecea hacia adelante
  hundimiento: 0.92, // scaleY cuando está triste: se hunde en sí mismo
  suavizado: 5.5, // velocidad del pasaje entre poses (exponencial)
  duracionMirar: 1.3, // segundos mirando las ramas
  duracionTriste: 2.9, // segundos de tristeza
  cadaLagrima: 0.9, // segundos entre lágrima y lágrima mientras está triste
  // Felicidad: la dispara la planta crecida. En cuanto aparece, celebra con
  // los brazos arriba y ya no vuelve al ciclo triste.
  crecimientoFeliz: 0.05, // 0..1
  velocidadFeliz: 1.1, // multiplica la velocidad al caminar celebrando
  ritmoFeliz: 0.9, // multiplica la frecuencia del rebote de celebración
  saltoFeliz: 0.055, // fracción del alto que salta
  balanceoFeliz: 0.035, // radianes de vaivén con los brazos arriba
  inclinacionFeliz: -0.02, // se yergue apenas
  escalaFeliz: 1, // ajuste fino si la pose feliz tiene otra proporción
  // Fondo claro a recortar: sin esto la imagen blanca taparía el paisaje.
  toleranciaFondo: 28, // 0 desactiva el recorte
  // Dónde está el ojo en la imagen (0..1 desde arriba a la izquierda). Solo se
  // usa para que la lágrima nazca en el lugar correcto: si se recorta la
  // imagen, este número cambia.
  ojo: { x: 0.62, y: 0.2 },
};

/* ---------- Escenario: estado ---------- */

/**
 * Estado del paisaje de fondo. Las dos imágenes se precargan en setup(); hasta
 * que llegan se dibuja un gris plano como respaldo.
 */
const fondoPaisaje = {
  gris: null,
  atardecer: null,
  cargando: false,
  listo: false,
  encuadre: null, // { x, y, w, h } en píxeles del lienzo, compartido por ambos
};

let horizonteEscena = 0;
let arbolesViento = []; // [{ grafico, x, y, ancho, baseY, balanceo, fase }]
let matujosViento = []; // [{ x, y, alto, briznas }]
let polvoAire = []; // partículas en suspensión
let rachasViento = []; // líneas de aire
let nubesViento = []; // nubes suaves de la capa intermedia
let destellosHorizonte = []; // destellos cálidos fijos alrededor del horizonte
let oleadaFlores = []; // destellos de la floración, de vida corta

/** Estado del personaje. La imagen llega async; el resto existe desde setup. */
const personaje = {
  imagen: null,
  imagenFeliz: null,
  cargando: false,
  cargandoFeliz: false,
  x: 0,
  ancho: 0,
  alto: 0,
  arbol: null, // árbol seco al que mira
  xParada: 0,
  estado: 'caminando', // 'caminando' | 'mirando' | 'triste' | 'feliz'
  relojEstado: 0,
  relojLagrima: 0,
  miradaHecha: false, // ya frenó en el árbol en esta pasada
  fasePaso: 0,
  inclinacion: 0, // pose, sin el vaivén del paso
  hundimiento: 1,
  lagrimas: [],
};
let escenaDesactualizada = true; // true = reconstruir (setup o resize)
let relojEscena = 0; // segundos desde el arranque
let fuerzaViento = VIENTO.fuerzaMinima; // 0..1, ya suavizada
let direccionViento = VIENTO.direccionMedia; // 1 = derecha
const tonoMezclado = [0, 0, 0]; // buffer del follaje: evita basura por frame
let contextoFollaje = null; // contexto 2D cacheado para dibujar el follaje
let capaArbolPaisaje = null; // buffer del árbol colorido interactivo del fondo
let vidaPaisaje = 0; // 0..1, ya suavizada: cuánta vida tiene el bosque ahora
let segundosSinManos = 0; // ausencia sostenida, para la gracia del tracking
let progresoPaisaje = 0; // 0..1, crecimiento máximo entre plantas, ya suavizado
let progresoPaisajeBruto = 0; // lectura del frame, para detectar el reinicio
let opacidadAtardecer = 0; // 0..1, opacidad real de la capa a color
const floresArmadas = {}; // id de planta → true = la próxima floración dispara oleada

/* ---------- Escenario: construcción ---------- */

/**
 * Prepara la capa viva y el encaje de los fondos. Se llama en setup() y cada
 * vez que el canvas cambia de tamaño: sprites y encuadres están dimensionados
 * en píxeles, así que un resize los invalida.
 */
function construirEscenario() {
  if (typeof width !== 'number' || width <= 0 || height <= 0) return;

  escenaDesactualizada = false;
  horizonteEscena = height * 0.54;

  // Semillas: random() y noise() son deterministas, así que cada
  // reconstrucción devuelve exactamente la misma composición.
  randomSeed(SEMILLA);
  noiseSeed(SEMILLA);

  liberarEscenario();

  actualizarEncuadreFondo();

  arbolesViento = crearArbolesViento();
  matujosViento = crearMatujos();
  polvoAire = crearPolvo();
  rachasViento = crearRachas();
  nubesViento = crearNubesViento();
  destellosHorizonte = crearDestellosHorizonte();

  // El árbol colorido se compone aparte porque su interacción vive en
  // planta.js: acá solo se le presta un contexto del tamaño del lienzo.
  capaArbolPaisaje = createGraphics(width, height);
  capaArbolPaisaje.pixelDensity(1);
}

/** Suelta los buffers anteriores: sin esto cada resize deja canvas vivos. */
function liberarEscenario() {
  if (capaArbolPaisaje) {
    capaArbolPaisaje.remove();
    capaArbolPaisaje = null;
  }

  for (const arbol of arbolesViento) arbol.grafico.remove();
  arbolesViento = [];

  for (const nube of nubesViento) {
    if (nube.graficoGris) nube.graficoGris.remove();
    if (nube.graficoColor) nube.graficoColor.remove();
  }
  nubesViento = [];
}

/* ---------- Paisaje de fondo: precarga y encuadre ---------- */

/**
 * Precarga los dos PNG a la vez. No usa `loadImage` de p5 porque en p5 2.x es
 * asíncrono y devuelve una promesa; con `new Image()` el callback llega recién
 * cuando los píxeles están listos, que es lo que necesita la transición para
 * verse completa desde la primera interacción.
 */
function cargarFondosPaisaje() {
  if (fondoPaisaje.cargando || fondoPaisaje.listo) return;

  fondoPaisaje.cargando = true;

  const total = 2;
  let pendientes = total;

  const terminar = () => {
    pendientes -= 1;
    if (pendientes > 0) return;
    fondoPaisaje.cargando = false;
    fondoPaisaje.listo = Boolean(fondoPaisaje.gris || fondoPaisaje.atardecer);
    actualizarEncuadreFondo();
  };

  const cargar = (ruta, destino) => {
    const imagen = new Image();
    imagen.onload = () => {
      fondoPaisaje[destino] = imagen;
      terminar();
    };
    imagen.onerror = () => {
      console.error(
        `[fondo] No se pudo cargar "${ruta}". Guardala en la raíz del proyecto, junto a index.html.`
      );
      terminar();
    };
    imagen.src = ruta;
  };

  cargar(FONDO_PAISAJE.rutaGris, 'gris');
  cargar(FONDO_PAISAJE.rutaAtardecer, 'atardecer');
}

/**
 * Calcula el rectángulo de dibujo de los dos fondos: `cover` sobre el lienzo,
 * escalando el máximo entre ancho y alto, y anclado en el mismo punto. Como
 * las dos imágenes comparten composición, el rectángulo es uno solo y las
 * colinas no se mueven al cruzar de gris a color.
 */
function actualizarEncuadreFondo() {
  const referencia = fondoPaisaje.gris || fondoPaisaje.atardecer;
  if (!referencia) {
    fondoPaisaje.encuadre = null;
    return;
  }

  const anchoImagen = referencia.naturalWidth || referencia.width;
  const altoImagen = referencia.naturalHeight || referencia.height;
  if (!anchoImagen || !altoImagen) return;

  const escala = Math.max(width / anchoImagen, height / altoImagen);
  const anchoDibujo = anchoImagen * escala;
  const altoDibujo = altoImagen * escala;
  const anclaje = FONDO_PAISAJE.alineacion;

  fondoPaisaje.encuadre = {
    x: (width - anchoDibujo) * anclaje.x,
    y: (height - altoDibujo) * anclaje.y,
    w: anchoDibujo,
    h: altoDibujo,
  };
}

/**
 * Dibuja la capa del paisaje: gris abajo y atardecer encima con su opacidad.
 * Es la ÚNICA capa que participa de la transición; plantas, árboles y efectos
 * no cambian de opacidad con el crecimiento.
 */
function dibujarFondosPaisaje() {
  // Respaldo opaco: sin gris cargado la escena no queda transparente.
  background(PALETA.cieloBajo[0], PALETA.cieloBajo[1], PALETA.cieloBajo[2]);

  const encuadre = fondoPaisaje.encuadre;
  if (!encuadre) return;

  const contexto = contextoDeDibujo();
  if (!contexto) return;

  contexto.save();

  if (fondoPaisaje.gris) {
    contexto.globalAlpha = 1;
    contexto.drawImage(fondoPaisaje.gris, encuadre.x, encuadre.y, encuadre.w, encuadre.h);
  }

  if (fondoPaisaje.atardecer && opacidadAtardecer > 0.001) {
    contexto.globalAlpha = opacidadAtardecer;
    contexto.drawImage(fondoPaisaje.atardecer, encuadre.x, encuadre.y, encuadre.w, encuadre.h);
  }

  contexto.restore();
}

/* ---------- Paisaje interactivo: progreso y transición ---------- */

/**
 * Progreso del paisaje: el mayor crecimiento alcanzado entre todas las
 * plantas del catálogo. Con una sola planta coincide con ella; con varias,
 * manda la que más creció, como pide la escena.
 */
function progresoDePlantas() {
  if (typeof plantaDebug === 'undefined' || !plantaDebug) return 0;

  if (typeof plantaDebug.plantas === 'function') {
    const lista = plantaDebug.plantas();
    let maximo = 0;
    if (Array.isArray(lista)) {
      for (const planta of lista) {
        const valor = Number(planta && planta.crecimiento);
        if (Number.isFinite(valor) && valor > maximo) maximo = valor;
      }
    }
    return constrain(maximo, 0, 1);
  }

  if (typeof plantaDebug.crecimiento === 'function') {
    const valor = Number(plantaDebug.crecimiento());
    return Number.isFinite(valor) ? constrain(valor, 0, 1) : 0;
  }

  return 0;
}

/**
 * Un paso de la transición del paisaje.
 *
 * - La opacidad del atardecer sigue al crecimiento con amortiguación
 *   exponencial: sube suave y no depende del framerate.
 * - Al reiniciar, el crecimiento de las plantas cae de golpe a 0. Se detecta
 *   ese salto para limpiar la oleada y devolver el ciclo a gris.
 * - La floración dispara una única oleada por apertura; se rearma cuando la
 *   flor vuelve a cerrarse.
 */
function actualizarPaisajeInteractivo(dt) {
  const bruto = progresoDePlantas();

  // Reinicio: el crecimiento pasó de algo a nada en un solo frame. La capa
  // vuelve sola a gris por la amortiguación, pero los destellos se limpian ya.
  if (bruto <= 0.001 && progresoPaisajeBruto > 0.02) reiniciarEfectosPaisaje();

  progresoPaisajeBruto = bruto;

  // Suavizado del progreso: el crecimiento de planta.js ya viene filtrado, pero
  // la curva de la opacidad también se suaviza para que el cambio se lea lento.
  const objetivo = suavizar(bruto);
  const rapidez = objetivo > progresoPaisaje ? FONDO_PAISAJE.velocidadEntrada : FONDO_PAISAJE.velocidadSalida;
  progresoPaisaje += (objetivo - progresoPaisaje) * (1 - Math.exp(-rapidez * dt));
  if (Math.abs(objetivo - progresoPaisaje) < 0.001) progresoPaisaje = objetivo;

  opacidadAtardecer = progresoPaisaje;

  actualizarOleadaPorFlor();
}

/**
 * Dispara una oleada por cada planta que cruza el umbral de floración, y la
 * rearma cuando esa flor vuelve a cerrarse. Así la orquídea y la planta de
 * tres flores tienen su propio momento, y una misma flor no repite la oleada
 * mientras siga abierta.
 */
function actualizarOleadaPorFlor() {
  if (typeof plantaDebug === 'undefined' || !plantaDebug) return;
  if (typeof plantaDebug.plantas !== 'function') return;

  const lista = plantaDebug.plantas();
  if (!Array.isArray(lista)) return;

  for (const planta of lista) {
    if (!planta) continue;

    const id = String(planta.id || 'planta');
    const flor = Math.max(
      Number.isFinite(Number(planta.florecimiento)) ? Number(planta.florecimiento) : 0,
      Number.isFinite(Number(planta.apertura)) ? Number(planta.apertura) : 0
    );
    const armada = floresArmadas[id] !== false;

    if (armada && flor >= OLEADA_FLORES.disparo) {
      floresArmadas[id] = false;
      dispararOleadaFlores(centroDePlanta(planta));
    } else if (!armada && flor <= OLEADA_FLORES.rearme) {
      floresArmadas[id] = true;
    }
  }
}

/** Devuelve el paisaje a gris y limpia todo lo que dependía del crecimiento. */
function reiniciarEfectosPaisaje() {
  oleadaFlores = [];
  for (const clave of Object.keys(floresArmadas)) delete floresArmadas[clave];
}

/* ---------- Escenario: dibujo por frame ---------- */

/** Punto de entrada de la capa viva. Orden = de atrás hacia adelante. */
function dibujarEscenario(t, dt) {
  // 1. Paisaje: gris + atardecer con la opacidad del crecimiento.
  dibujarFondosPaisaje();

  // 2. Capa intermedia animada: delante del paisaje y detrás de las plantas.
  //    Nubes y destellos leen el mismo progreso que la transición.
  dibujarNubes(t, dt);
  dibujarDestellosHorizonte(t);
  actualizarDibujarOleadaFlores(dt);

  // 3. Capa viva del paisaje: aire, árboles, polvo y pasto.
  dibujarRachas(t, dt);
  // Los árboles se dibujan por planos para poder intercalar al personaje en el
  // medio: camina detrás de los árboles cercanos y delante de los lejanos.
  dibujarArbolesViento(t, 0);
  // El árbol colorido es paisaje interactivo: va delante de los árboles lejanos
  // y detrás de los medios, del personaje y de las plantas de `planta-overlay`.
  dibujarArbolPaisaje();
  dibujarArbolesViento(t, 1);
  dibujarArbolesViento(t, 2);
  actualizarDibujarPolvo(t, dt);
  dibujarMatujosViento(t);
}

/**
 * El árbol colorido del fondo: paisaje, no una planta de la capa de plantas.
 *
 * La interacción —crecer con el puño, florecer con la mano abierta, sacudirse,
 * inclinarse y mecerse con el viento— es EXACTAMENTE la de las plantas, porque
 * su estado lo lleva `planta.js`: acá no se reimplementa nada, solo se le presta
 * un contexto 2D del tamaño del lienzo y se compone en el orden del escenario.
 *
 * Vive acá y no en `#planta-overlay` por una sola razón: ese canvas está por
 * encima del de p5, así que ahí quedaría delante del personaje.
 */
function dibujarArbolPaisaje() {
  if (!capaArbolPaisaje) return;
  if (typeof plantaDebug === 'undefined') return;
  if (typeof plantaDebug.dibujarPaisaje !== 'function') return;

  const capa = capaArbolPaisaje;
  // `clearRect` directo sobre el contexto: es el mismo recurso que usa el
  // overlay de plantas y no depende de la API de p5.Graphics.
  capa.drawingContext.clearRect(0, 0, width, height);

  // `millis()` en milisegundos: es el reloj que espera el temblor y el vaivén.
  const dibujado = plantaDebug.dibujarPaisaje(capa.drawingContext, width, height, millis());

  // Sin crecimiento no hay nada que componer: se evita el blit de un buffer
  // vacío en cada frame.
  if (dibujado) image(capa, 0, 0);
}

/**
 * Avanza el viento. Es la única fuente de movimiento de la escena: árboles,
 * pasto, polvo y rachas leen `fuerzaViento` y `direccionViento`, así que todo
 * se mueve coordinado sin que haya que sincronizar nada a mano.
 */
function actualizarViento(dt) {
  const rafaga = noise(relojEscena * VIENTO.velocidadRafaga, VIENTO.semillaRafaga);
  const pulso = noise(relojEscena * VIENTO.velocidadRafaga * 3.1, VIENTO.semillaPulso);

  const objetivo = constrain(
    VIENTO.fuerzaMinima + (rafaga * 0.85 + pulso * 0.15) * (1 - VIENTO.fuerzaMinima),
    0,
    1
  );

  // Amortiguación exponencial, no lerp con alfa fijo: el resultado no depende
  // del framerate.
  const velocidad = objetivo > fuerzaViento ? VIENTO.ataque : VIENTO.relajo;
  fuerzaViento = lerp(fuerzaViento, objetivo, 1 - Math.exp(-velocidad * dt));

  const giro = noise(relojEscena * VIENTO.velocidadDireccion, VIENTO.semillaDireccion) * 2 - 1;
  direccionViento = VIENTO.direccionMedia + giro * VIENTO.direccionAmplitud;
}

/** Curva suave para degradados (smoothstep). */
function suavizar(t) {
  const acotado = Math.min(1, Math.max(0, t));
  return acotado * acotado * (3 - 2 * acotado);
}

/* ---------- Suelo ---------- */

/**
 * Parámetros de las tres franjas de terreno. Ya no se dibujan: el paisaje es
 * un PNG. Se conservan porque la base de árboles, pasto y plantas se apoya en
 * este mismo relieve, así los elementos no flotan ni quedan enterrados.
 */
const CAPAS_SUELO = [
  { base: 0.02, amplitud: 0.035, escala: 0.006, fase: 0 },
  { base: 0.13, amplitud: 0.05, escala: 0.009, fase: 40 },
  { base: 0.27, amplitud: 0.06, escala: 0.012, fase: 90 },
];

/**
 * Altura del borde superior de una capa en una x dada. Como noise() es
 * determinista, dibujar y plantar consultan exactamente la misma curva.
 */
function bordeDeSuelo(x, capa, horizonte) {
  const baseY = horizonte + height * capa.base;
  return baseY + (noise(x * capa.escala + capa.fase, capa.fase) - 0.5) * height * capa.amplitud;
}

/* ---------- Árboles ---------- */

/**
 * Árboles secos repartidos en los tres planos.
 * Los lejanos son chicos y claros (la bruma los come); los cercanos son
 * grandes, oscuros y con más ramificación.
 *
 * Cada árbol se hornea como sprite porque dibujarlo por frame costaría cientos
 * de trazos. `balanceo` es la amplitud de giro en radianes y escala con la
 * profundidad: un árbol cercano recorre más píxeles en la copa que uno lejano.
 */
function crearArbolesViento() {
  const lista = [];
  let semillaArbol = 0;

  const agregar = (x, y, alto, grosor, tono, niveles, inclinacion, balanceo, plano) => {
    // Semilla propia por árbol: el noise está en coordenadas locales, así que
    // sin este desplazamiento todos saldrían con la misma forma.
    semillaArbol += 37.7;

    const sprite = crearSpriteDeArbol(alto, grosor, tono, niveles, inclinacion, semillaArbol);
    const tonos = FOLLAJE.tonos[plano];
    lista.push({
      grafico: sprite.grafico,
      x,
      y,
      alto,
      ancho: sprite.ancho,
      baseY: sprite.baseY,
      balanceo,
      plano, // 0 lejos, 1 medio, 2 cerca: define el orden y dónde camina el personaje
      fase: random(TWO_PI), // desfase del vaivén: no se mueven en bloque
      hojas: sprite.hojas, // follaje en coordenadas del árbol, ya ordenado
      tonoTierno: tonos.tierno,
      tonoMaduro: tonos.maduro,
    });
  };

  // Plano lejano
  const posicionesLejanas = [0.06, 0.18, 0.33, 0.5, 0.67, 0.86];
  for (const fx of posicionesLejanas) {
    const x = width * (fx + random(-0.015, 0.015));
    // Base sobre el borde real de la capa, hundida unos píxeles: la raíz
    // tiene que apoyarse en la tierra, no quedar en el aire.
    const y = bordeDeSuelo(x, CAPAS_SUELO[0], horizonteEscena) + height * 0.004;
    const alto = height * random(0.09, 0.14);
    agregar(x, y, alto, 1.6, PALETA.arbolLejos, 3, random(-0.14, 0.14), 0.012, 0);
  }

  // Plano medio
  const posicionesMedias = [0.22, 0.44, 0.6, 0.82];
  for (const fx of posicionesMedias) {
    const x = width * (fx + random(-0.02, 0.02));
    const y = bordeDeSuelo(x, CAPAS_SUELO[1], horizonteEscena) + height * 0.005;
    const alto = height * random(0.16, 0.23);
    agregar(x, y, alto, 3.2, PALETA.arbolMedio, 4, random(-0.16, 0.16), 0.022, 1);
  }

  // Plano cercano: el del borde derecho queda cortado por el encuadre.
  const posicionesCercanas = [
    { fx: 0.09, alto: 0.42, grosor: 6.5 },
    { fx: 0.71, alto: 0.34, grosor: 5.5 },
    { fx: 0.95, alto: 0.46, grosor: 8 },
  ];

  for (const arbol of posicionesCercanas) {
    const x = width * arbol.fx;
    const y = bordeDeSuelo(x, CAPAS_SUELO[2], horizonteEscena) + height * 0.008;
    const alto = height * arbol.alto * random(0.94, 1.06);
    agregar(x, y, alto, arbol.grosor, PALETA.arbolCerca, 5, random(-0.18, 0.06), 0.035, 2);
  }

  return lista;
}

/**
 * Hornea un árbol en su propio canvas transparente con el pie en (0,0) del
 * buffer. El margen es generoso a propósito: las ramas se abren más que el
 * tronco y no pueden quedar cortadas.
 */
function crearSpriteDeArbol(alto, grosor, tono, niveles, inclinacion, semilla) {
  // 2.4× de ancho y 1.9× de alto: la recursión de ramas puede trepar más de
  // una vez la altura del árbol, y una rama cortada por el borde del buffer
  // se notaría como un muñón.
  const ancho = Math.max(48, Math.ceil(alto * 2.4));
  const altoBuffer = Math.max(48, Math.ceil(alto * 1.9));
  const baseY = altoBuffer - Math.ceil(alto * 0.06);

  const g = createGraphics(ancho, altoBuffer);
  g.pixelDensity(1);

  // El follaje se recoge en el mismo recorrido que dibuja las ramas: nace en
  // las puntas, así queda exactamente donde el árbol deja de crecer.
  const hojas = [];

  g.push();
  g.translate(ancho * 0.5, baseY);
  dibujarArbol(g, 0, 0, alto, grosor, tono, niveles, inclinacion, semilla, hojas);
  g.pop();

  return { grafico: g, ancho, baseY, hojas: prepararHojas(hojas, alto) };
}

/**
 * Dibuja los árboles con el giro que les da el viento. Pivota en la base: el
 * árbol se dobla, no se desliza. A 2° de giro el movimiento se lee en la copa
 * y no en la raíz, que es exactamente lo que hace un árbol con viento.
 */
function dibujarArbolesViento(t, plano) {
  const vida = vidaDelPaisaje();

  for (const arbol of arbolesViento) {
    if (arbol.plano !== plano) continue;

    const vaiven =
      Math.sin(t * VIENTO.velocidadVaiven + arbol.fase) * 0.35 + fuerzaViento * 0.9;
    const angulo = vaiven * arbol.balanceo * direccionViento;

    push();
    translate(arbol.x, arbol.y);
    rotate(angulo);
    // Fondo, no protagonista: el sprite y su follaje comparten la opacidad.
    tint(255, 255 * ARBOLES.alfa);
    image(arbol.grafico, -arbol.ancho * 0.5, -arbol.baseY);
    noTint();
    // Las hojas van después del sprite: nacen sobre las puntas y las ramas
    // finas se leen por detrás del follaje, como en un árbol real.
    dibujarFollaje(arbol, vida, ARBOLES.alfa);
    pop();
  }
}

/**
 * Dibuja las hojas que el crecimiento ya habilitó. Cada hoja tiene su propio
 * umbral (`orden`) y se abre en una ventana corta, así el bosque se llena de a
 * poco en vez de encenderse de golpe.
 *
 * Un solo `fill` por árbol y un polígono por hoja: seis vértices ya resueltos,
 * sin rotaciones ni trigonometría por frame.
 */
function dibujarFollaje(arbol, vida, alfa = 1) {
  const hojas = arbol.hojas;
  if (vida <= 0 || !hojas || hojas.length === 0) return;

  // Canvas 2D directo: cada hoja es un subcamino cerrado dentro de UN solo
  // path. Con un fill por hoja serían cientos de llamadas al canvas por frame;
  // así es un beginPath y un fill por árbol, y el costo no depende de la copa.
  const lienzo = contextoDeDibujo();
  if (!lienzo) return;

  const tono = mezclarTono(arbol.tonoTierno, arbol.tonoMaduro, vida);

  // p5 cachea `fillStyle` en el renderer: si se lo pisa sin devolverlo, un
  // `fill()` posterior con el mismo color que el cacheado se saltea la
  // asignación y el dibujo sale con el color del follaje. Se guarda y se
  // restaura, junto con el alfa global.
  const estiloPrevio = lienzo.fillStyle;
  const alfaPrevio = lienzo.globalAlpha;

  lienzo.fillStyle = `rgb(${Math.round(tono[0])}, ${Math.round(tono[1])}, ${Math.round(tono[2])})`;
  lienzo.globalAlpha = alfa;
  lienzo.beginPath();

  for (const hoja of hojas) {
    // La ventana se acorta para las últimas hojas, así la más lejana igual
    // llega a tamaño completo con vida 1 (y no queda a mitad de camino).
    const ventana = Math.min(FOLLAJE.ventanaAparicion, 1 - hoja.orden);
    const avance = (vida - hoja.orden) / ventana;
    if (avance <= 0) continue;

    // Aparece chica y se abre; al apagarse, se cierra. El piso de 0.25 es para
    // que el primer brote se vea: a 10% de crecimiento una hoja a tamaño 0.05
    // sería invisible.
    const escala = 0.25 + 0.75 * Math.min(1, avance);
    const vertices = hoja.vertices;

    lienzo.moveTo(hoja.x + vertices[0].dx * escala, hoja.y + vertices[0].dy * escala);
    for (let i = 1; i < vertices.length; i += 1) {
      lienzo.lineTo(hoja.x + vertices[i].dx * escala, hoja.y + vertices[i].dy * escala);
    }
    lienzo.closePath();
  }

  lienzo.fill();
  lienzo.fillStyle = estiloPrevio;
  lienzo.globalAlpha = alfaPrevio;
}

/**
 * Contexto 2D del canvas de p5.
 *
 * El modo global de p5 expone casi todo, pero `drawingContext` no está en la
 * lista de propiedades que copia en todas las versiones: si falta, se llega al
 * mismo contexto por la instancia. Se cachea, y se renueva solo si p5 cambia
 * de canvas (un resize no lo hace, pero no cuesta nada comprobarlo).
 */
function contextoDeDibujo() {
  if (typeof drawingContext !== 'undefined' && drawingContext) return drawingContext;

  const instancia = typeof p5 !== 'undefined' ? p5.instance : null;
  const lienzo = instancia && instancia.canvas ? instancia.canvas : null;
  if (!lienzo) return null;

  if (!contextoFollaje || contextoFollaje.canvas !== lienzo) {
    contextoFollaje = lienzo.getContext('2d');
  }

  return contextoFollaje;
}

/**
 * Vida del paisaje (0..1). La siembra el crecimiento que publica `planta.js`
 * (el puño cerrado) y la sostienen las manos en cuadro: sin manos, el bosque se
 * apaga solo y los árboles vuelven a su estado seco. Se actualiza una vez por
 * frame en `actualizarVida()`.
 */
function vidaDelPaisaje() {
  return vidaPaisaje;
}

/** Crecimiento de la planta, acotado y a prueba de `NaN`. */
function objetivoDeVida() {
  if (typeof plantaDebug === 'undefined' || !plantaDebug) return 0;
  if (typeof plantaDebug.crecimiento !== 'function') return 0;

  const valor = plantaDebug.crecimiento();
  return Number.isFinite(valor) ? constrain(valor, 0, 1) : 0;
}

/** ¿Hay al menos una mano detectada en cuadro? */
function hayManosEnCuadro() {
  if (typeof obtenerManos !== 'function') return false;

  const manos = obtenerManos();
  return Array.isArray(manos) && manos.length > 0;
}

/**
 * Un paso de la vida del paisaje.
 *
 * Con manos, el objetivo es el crecimiento de la planta. Sin manos, el objetivo
 * es 0: la vida se retira y las hojas se caen. Los primeros `graciaSinManos`
 * segundos de ausencia no mueven nada, así un parpadeo del tracking no apaga el
 * bosque a mitad de la presentación.
 */
function actualizarVida(dt) {
  const hayManos = hayManosEnCuadro();
  segundosSinManos = hayManos ? 0 : segundosSinManos + dt;

  const sostenida = hayManos || segundosSinManos < FOLLAJE.graciaSinManos;
  const objetivo = sostenida ? objetivoDeVida() : 0;

  // Amortiguación exponencial, no un lerp con alfa fijo: no depende del
  // framerate, igual que el viento y el crecimiento de la planta.
  const rapidez = objetivo > vidaPaisaje ? FOLLAJE.ataqueVida : FOLLAJE.relajoVida;
  const factor = 1 - Math.exp(-rapidez * dt);

  vidaPaisaje += (objetivo - vidaPaisaje) * factor;
  if (Math.abs(objetivo - vidaPaisaje) < 0.002) vidaPaisaje = objetivo;
}

/** Mezcla lineal de dos tonos en un array reutilizado: cero basura por frame. */
function mezclarTono(desde, hasta, t) {
  tonoMezclado[0] = desde[0] + (hasta[0] - desde[0]) * t;
  tonoMezclado[1] = desde[1] + (hasta[1] - desde[1]) * t;
  tonoMezclado[2] = desde[2] + (hasta[2] - desde[2]) * t;
  return tonoMezclado;
}

/**
 * Deja el follaje listo para dibujarse: descarta lo que no se vería, lo acota
 * al tope y le asigna a cada hoja su umbral de aparición.
 *
 * El orden no es al azar: se llena primero el corazón de la copa y después los
 * bordes, que es como rebrota un árbol. Se normaliza contra la hoja más
 * cercana y la más lejana de ESE árbol, así el primero y el último brote caen
 * siempre en los extremos y el follaje arranca con el primer nivel de la
 * planta. El número áureo reparte el resto para que dos hojas a la misma
 * distancia no salgan en el mismo frame.
 */
function prepararHojas(hojas, alto) {
  // Todas las hojas del árbol comparten el tamaño base de la copa, no el de la
  // rama donde nacieron: así el follaje de un árbol lejano tiene hojas finas y
  // el de uno cercano hojas grandes, y la densidad se lee igual en los tres
  // planos.
  const base = alto * FOLLAJE.tamanoHoja;
  const utiles = hojas.filter((hoja) => base * hoja.escala >= FOLLAJE.largoMinimo);
  if (utiles.length === 0) return [];

  const paso = Math.ceil(utiles.length / FOLLAJE.maximoPorArbol);
  const recortadas = paso > 1 ? utiles.filter((_, i) => i % paso === 0) : utiles;

  let sumaX = 0;
  let sumaY = 0;
  for (const hoja of recortadas) {
    sumaX += hoja.x;
    sumaY += hoja.y;
  }
  const centroX = sumaX / recortadas.length;
  const centroY = sumaY / recortadas.length;

  let minimo = Infinity;
  let maximo = 0;
  for (const hoja of recortadas) {
    const distancia = Math.hypot(hoja.x - centroX, hoja.y - centroY);
    hoja.distancia = distancia;
    minimo = Math.min(minimo, distancia);
    maximo = Math.max(maximo, distancia);
  }

  // Un árbol con todas las hojas a la misma distancia (imposible en la
  // práctica, pero evita dividir por cero) se llena de golpe.
  const rango = maximo - minimo;

  recortadas.forEach((hoja, i) => {
    const desdeElCentro = rango > 1 ? (hoja.distancia - minimo) / rango : 0;
    const reparto = ((i + 1) * 0.6180339887) % 1;
    hoja.orden = constrain(desdeElCentro * 0.8 + reparto * 0.2, 0, 0.999);
    hoja.largo = base * hoja.escala;
    hoja.vertices = geometriaDeHoja(hoja.largo, hoja.angulo, i);
  });

  return recortadas;
}

/**
 * Seis vértices de una hoja apuntada —base angosta, panza al medio, punta en el
 * extremo— ya rotados. Se calcula una vez al construir el árbol: dibujar es
 * solo sumar.
 */
function geometriaDeHoja(largo, angulo, indice) {
  const ancho = largo * FOLLAJE.anchoHoja;

  const forma = [
    [0, 0],
    [largo * 0.3, -ancho * 0.5],
    [largo * 0.72, -ancho * 0.34],
    [largo, 0],
    [largo * 0.72, ancho * 0.34],
    [largo * 0.3, ancho * 0.5],
  ];

  // Cada hoja se inclina un poco respecto de su rama: si todas siguieran el
  // mismo ángulo, la copa se vería como un peine. El número áureo reparte las
  // inclinaciones sin sortear nada, así el árbol es siempre el mismo.
  const inclinacion = angulo + 0.55 * (((indice + 1) * 0.6180339887) % 1 - 0.5) * 2;
  const cos = Math.cos(inclinacion);
  const sin = Math.sin(inclinacion);

  return forma.map(([u, v]) => ({
    dx: u * cos - v * sin,
    dy: u * sin + v * cos,
  }));
}

/**
 * Un brote pendiente: dónde nace y con qué ángulo. El tamaño y los vértices se
 * resuelven en prepararHojas(), que es el único lugar que conoce el alto del
 * árbol y el tope de hojas.
 */
function crearHoja(x, y, angulo, escala, indice) {
  return { x, y, angulo, escala, indice, distancia: 0, orden: 0, vertices: null };
}

/** Acceso de solo lectura para comprobar el paisaje desde la consola. */
window.escenarioDebug = {
  vida: () => vidaDelPaisaje(),
  hojasPorArbol: () => arbolesViento.map((arbol) => arbol.hojas.length),
  hojasTotales: () => arbolesViento.reduce((total, arbol) => total + arbol.hojas.length, 0),
  // Paisaje de fondo: encaje común, progreso y opacidad real del atardecer.
  fondo: () => ({
    grisCargado: Boolean(fondoPaisaje.gris),
    atardecerCargado: Boolean(fondoPaisaje.atardecer),
    listo: fondoPaisaje.listo,
    encuadre: fondoPaisaje.encuadre ? { ...fondoPaisaje.encuadre } : null,
    progreso: progresoPaisaje,
    opacidadAtardecer,
  }),
  nubes: () => nubesViento.length,
  destellosHorizonte: () => destellosHorizonte.length,
  oleada: () => oleadaFlores.length,
};

/**
 * Un árbol sin hojas: base ensanchada, tronco levemente curvado y ramas
 * que se abren desde la copa. Todo con trazos redondeados, sin relleno
 * fotográfico, para que quede ilustrado y orgánico.
 *
 * `g` es el destino del dibujo (un p5.Graphics o el canvas principal) y
 * `semilla` desplaza el campo de noise para que dos árboles no sean gemelos.
 */
function dibujarArbol(g, x, yBase, alto, grosor, tono, niveles, inclinacion, semilla, hojas) {
  const angulo = -HALF_PI + inclinacion;
  const altoTronco = alto * 0.45;
  const xCopa = x + Math.cos(angulo) * altoTronco;
  const yCopa = yBase + Math.sin(angulo) * altoTronco;

  // Base: la raíz agarra la tierra, por eso es más ancha que el tronco.
  g.noStroke();
  g.fill(tono[0], tono[1], tono[2]);
  g.ellipse(x, yBase, grosor * 2.1, grosor * 0.8);

  // Tronco en dos tramos con una curva suave: nada de líneas perfectas.
  g.stroke(tono[0], tono[1], tono[2]);
  g.strokeCap(ROUND);
  const xMedio = lerp(x, xCopa, 0.5) + Math.cos(angulo + HALF_PI) * alto * 0.035;
  const yMedio = lerp(yBase, yCopa, 0.55);

  g.strokeWeight(grosor);
  g.line(x, yBase, xMedio, yMedio);
  g.strokeWeight(grosor * 0.82);
  g.line(xMedio, yMedio, xCopa, yCopa);

  // Ramas principales desde la copa.
  dibujarRama(g, xCopa, yCopa, altoTronco * 0.85, angulo - 0.3, grosor * 0.68, niveles, tono, semilla, hojas);
  dibujarRama(g, xCopa, yCopa, altoTronco * 0.78, angulo + 0.26, grosor * 0.62, niveles, tono, semilla, hojas);
  dibujarRama(g, xMedio, yMedio, altoTronco * 0.55, angulo - 0.75, grosor * 0.45, niveles - 1, tono, semilla, hojas);
}

/**
 * Rama recursiva. Se abre en dos o tres direcciones con ángulos tomados de
 * noise() —no de random()— para que el árbol sea siempre el mismo.
 *
 * Si recibe `hojas`, cada nudo deja ahí su ramillete de follaje. Se recoge en
 * el mismo recorrido que dibuja: no hay una segunda geometría que pueda
 * desincronizarse de las ramas.
 */
function dibujarRama(g, x, y, largo, angulo, grosor, nivel, tono, semilla, hojas) {
  if (nivel <= 0 || grosor < 0.6 || largo < 2) return;

  const x2 = x + Math.cos(angulo) * largo;
  const y2 = y + Math.sin(angulo) * largo;

  g.stroke(tono[0], tono[1], tono[2]);
  g.strokeWeight(grosor);
  g.line(x, y, x2, y2);

  const apertura = 0.3 + noise(x * 0.015 + semilla, y * 0.015) * 0.35;
  const acortar = 0.64 + noise(y * 0.02, x * 0.02 + semilla) * 0.14;

  // Follaje: cada nudo lleva su ramillete. La punta define el borde de la copa
  // y las ramas de adentro le ponen cuerpo, que es lo que hace que el árbol
  // deje de leerse como un esqueleto.
  if (hojas) {
    for (const brote of FOLLAJE.racimo) {
      const direccion = angulo + brote.giro;
      hojas.push(
        crearHoja(
          x2 + Math.cos(direccion) * largo * brote.avance,
          y2 + Math.sin(direccion) * largo * brote.avance,
          direccion,
          brote.escala,
          hojas.length
        )
      );
    }
  }

  dibujarRama(g, x2, y2, largo * acortar, angulo - apertura, grosor * 0.62, nivel - 1, tono, semilla, hojas);
  dibujarRama(g, x2, y2, largo * acortar * 0.92, angulo + apertura * 0.8, grosor * 0.58, nivel - 1, tono, semilla, hojas);

  // Tercera rama ocasional: rompe la simetría del árbol.
  if (nivel > 2 && noise(x * 0.03 + semilla, y * 0.03) > 0.42) {
    dibujarRama(g, x2, y2, largo * acortar * 0.7, angulo + apertura * 0.1, grosor * 0.42, nivel - 1, tono, semilla, hojas);
  }
}

/* ============================================================
   CAPA VIVA
   Pasto, polvo, rachas y nubes. Son pocos trazos por frame, así que se
   pueden redibujar a 60 fps. Todo lee el mismo viento.
   ============================================================ */

/**
 * Genera los matujos una sola vez: posición, alto y la forma de cada brizna.
 * Si la posición se sorteara por frame, las matas bailarían por la pantalla en
 * lugar de doblarse con el viento.
 */
function crearMatujos() {
  const lista = [];

  for (let i = 0; i < MATUJOS.cantidad; i += 1) {
    const x = width * random(0.01, 0.99);
    const y = bordeDeSuelo(x, CAPAS_SUELO[2], horizonteEscena) + height * random(0.01, 0.17);
    const alto = height * random(MATUJOS.alturaMinima, MATUJOS.alturaMaxima);

    const briznas = [];
    const cantidadBriznas = 4 + Math.floor(random(4));
    for (let b = 0; b < cantidadBriznas; b += 1) {
      briznas.push({
        inclinacion: random(-0.55, 0.55),
        largo: random(0.6, 1),
        fase: random(TWO_PI),
        // Rigidez: cuánto se resiste a doblarse. Sin variedad, el matujo
        // entero se doblaría como una sola pieza.
        rigidez: random(0.55, 1),
      });
    }

    lista.push({ x, y, alto, briznas });
  }

  return lista;
}

/**
 * Pasto doblándose con el viento. Cada brizna CONSERVA SU LARGO y gira sobre su
 * base: por eso la punta baja al doblarse, y eso es lo que se lee como viento
 * y no como un estiramiento.
 */
function dibujarMatujosViento(t) {
  const tono = PALETA.pastoSeco;

  stroke(tono[0], tono[1], tono[2], 190);
  strokeWeight(1.2);
  noFill();

  for (const matujo of matujosViento) {
    for (const brizna of matujo.briznas) {
      const largo = matujo.alto * brizna.largo;
      const temblor =
        Math.sin(t * MATUJOS.velocidadTemblor + brizna.fase) * MATUJOS.temblorMaximo * fuerzaViento;
      const doblez =
        (fuerzaViento * MATUJOS.doblezMaximo * brizna.rigidez + temblor) * direccionViento;

      // La punta se ubica sobre el círculo de radio `largo`; el control va más
      // cerca de la vertical para que la curva no sea un arco rígido.
      //
      // El ángulo se acota antes de llegar a 90°: pasado ese punto la punta
      // apuntaría hacia abajo y la brizna se clavaría en la tierra. Aplanada
      // al máximo, en cambio, se lee como pasto doblegado por la ráfaga.
      const limite = MATUJOS.anguloMaximo;
      const anguloPunta = constrain(brizna.inclinacion + doblez, -limite, limite);
      const anguloControl = constrain(brizna.inclinacion + doblez * 0.4, -limite, limite);

      const xFin = matujo.x + Math.sin(anguloPunta) * largo;
      const yFin = matujo.y - Math.cos(anguloPunta) * largo;
      const cx = matujo.x + Math.sin(anguloControl) * largo * 0.55;
      const cy = matujo.y - Math.cos(anguloControl) * largo * 0.6;

      // Curva de Bézier cuadrática calculada a mano y muestreada como
      // polilínea. p5 2.x NO expone quadraticVertex(), así que no se puede usar.
      beginShape();
      vertex(matujo.x, matujo.y);
      for (let paso = 1; paso <= MATUJOS.segmentos; paso += 1) {
        const tt = paso / MATUJOS.segmentos;
        const inv = 1 - tt;
        vertex(
          inv * inv * matujo.x + 2 * inv * tt * cx + tt * tt * xFin,
          inv * inv * matujo.y + 2 * inv * tt * cy + tt * tt * yFin
        );
      }
      endShape();
    }
  }
}

/** Polvo en suspensión: el viento lo arrastra y lo recicla por los bordes. */
function crearPolvo() {
  const lista = [];

  for (let i = 0; i < POLVO_AIRE.cantidad; i += 1) {
    lista.push({
      x: random(width),
      y: random(0, horizonteEscena + height * 0.08),
      tamano: random(POLVO_AIRE.tamanoMinimo, POLVO_AIRE.tamanoMaximo),
      alfa: random(POLVO_AIRE.alfaMinimo, POLVO_AIRE.alfaMaximo),
      // Cada partícula pesa distinto: sin esto el polvo se movería en bloque.
      empuje: random(0.25, 1),
      deriva: random(-4, 4),
      fase: random(TWO_PI),
    });
  }

  return lista;
}

function actualizarDibujarPolvo(t, dt) {
  const tono = PALETA.polvo;
  const limiteY = horizonteEscena + height * 0.1;
  const velocidad = POLVO_AIRE.empujeMinimo + fuerzaViento * POLVO_AIRE.empujeMaximo;

  noStroke();

  for (const particula of polvoAire) {
    particula.x += velocidad * particula.empuje * direccionViento * dt;
    particula.y += (Math.sin(t * 1.4 + particula.fase) * 3 + particula.deriva) * dt;

    if (particula.x > width + 12) particula.x = -12;
    else if (particula.x < -12) particula.x = width + 12;

    if (particula.y < -12) particula.y = limiteY;
    else if (particula.y > limiteY) particula.y = -12;

    fill(tono[0], tono[1], tono[2], particula.alfa * (0.55 + fuerzaViento * 0.45));
    circle(particula.x, particula.y, particula.tamano);
  }
}

/** Rachas: líneas tenues que cruzan el cielo y delatan la corriente de aire. */
function crearRachas() {
  const lista = [];

  for (let i = 0; i < RACHAS.cantidad; i += 1) {
    lista.push({
      x: random(width),
      y: random(height * 0.02, horizonteEscena * 0.92),
      largo: width * random(RACHAS.largoMinimo, RACHAS.largoMaximo),
      velocidad: random(RACHAS.velocidadMinima, RACHAS.velocidadMaxima),
      alfa: random(0.4, 1),
      grosor: random(0.7, 1.6),
      fase: random(TWO_PI),
    });
  }

  return lista;
}

function dibujarRachas(t, dt) {
  const tono = PALETA.polvo;
  const alfa = RACHAS.alfa * (0.35 + fuerzaViento * 0.65);

  noFill();

  for (const racha of rachasViento) {
    // Más viento, más rápido: la ráfaga se ve en el aire, no solo en el pasto.
    racha.x += racha.velocidad * (1 + fuerzaViento * 2.5) * dt;
    if (racha.x > width) racha.x = -racha.largo;

    const y = racha.y + Math.sin(t * 0.8 + racha.fase) * height * 0.006;

    stroke(tono[0], tono[1], tono[2], alfa * racha.alfa);
    strokeWeight(racha.grosor);
    beginShape();
    vertex(racha.x, y);
    vertex(racha.x + racha.largo * 0.5, y + Math.sin(t * 1.3 + racha.fase) * 2);
    vertex(racha.x + racha.largo, y);
    endShape();
  }
}

/* ============================================================
   NUBES Y DESTELLOS
   Capa intermedia: delante del paisaje y detrás de las plantas.
   Todo lee `progresoPaisaje`, el mismo que gobierna la transición.
   ============================================================ */

/**
 * Hornea una nube suave en su propio canvas transparente. Son varias manchas
 * con degradado radial: el borde se desvanece solo y no hay geometría visible.
 * Se generan dos versiones por nube (gris y color) y se cruzan con la opacidad,
 * así el cambio de tono no necesita `tint()` por frame.
 */
function crearSpriteNube(ancho, alto, tono) {
  const g = createGraphics(Math.max(2, Math.ceil(ancho)), Math.max(2, Math.ceil(alto)));
  g.pixelDensity(1);
  g.clear();

  const contexto = g.drawingContext;
  if (!contexto) return g;

  const manchas = [
    [0.26, 0.58, 0.34],
    [0.48, 0.46, 0.44],
    [0.7, 0.57, 0.32],
    [0.42, 0.68, 0.4],
    [0.62, 0.66, 0.36],
  ];

  contexto.save();
  for (const [fx, fy, fr] of manchas) {
    const radio = ancho * fr * 0.5;
    const cx = ancho * fx;
    const cy = alto * fy;
    const degradado = contexto.createRadialGradient(cx, cy, 0, cx, cy, radio);
    degradado.addColorStop(0, `rgba(${tono[0]}, ${tono[1]}, ${tono[2]}, 0.85)`);
    degradado.addColorStop(0.45, `rgba(${tono[0]}, ${tono[1]}, ${tono[2]}, 0.38)`);
    degradado.addColorStop(1, `rgba(${tono[0]}, ${tono[1]}, ${tono[2]}, 0)`);
    contexto.fillStyle = degradado;
    contexto.beginPath();
    contexto.arc(cx, cy, radio, 0, Math.PI * 2);
    contexto.fill();
  }
  contexto.restore();

  return g;
}

/** Tres nubes con distinto alto, ancho y velocidad. */
function crearNubesViento() {
  const lista = [];

  NUBES.modelos.forEach((modelo, indice) => {
    const ancho = width * modelo.ancho;
    const alto = Math.max(24, ancho * NUBES.proporcion);
    const tono = modelo.tono === 'lila' ? NUBES.tonoLila : NUBES.tonoRosa;

    lista.push({
      graficoGris: crearSpriteNube(ancho, alto, NUBES.tonoGris),
      graficoColor: crearSpriteNube(ancho, alto, tono),
      ancho,
      alto,
      x: width * random(0.08, 0.92) + indice * width * 0.12,
      y: height * modelo.y,
      velocidad: modelo.velocidad,
      alfa: constrain(modelo.alfa, NUBES.alfaMinimo, NUBES.alfaMaximo),
      fase: random(TWO_PI),
    });
  });

  return lista;
}

/**
 * Nubes que cruzan despacio. Arrancan grises y vírgenes; con el atardecer se
 * funden hacia su tono rosa o lila. La opacidad total no cambia: una versión
 * baja mientras la otra sube, así el cruce no produce parpadeos.
 */
function dibujarNubes(t, dt) {
  if (nubesViento.length === 0) return;

  const contexto = contextoDeDibujo();
  if (!contexto) return;

  const progreso = progresoPaisaje;
  contexto.save();

  for (const nube of nubesViento) {
    nube.x += nube.velocidad * width * (0.55 + fuerzaViento * 0.7) * direccionViento * dt;

    const mitad = nube.ancho * 0.5;
    if (nube.x - mitad > width) nube.x = -mitad;
    else if (nube.x + mitad < 0) nube.x = width + mitad;

    const derivaY = Math.sin(t * 0.12 + nube.fase) * height * 0.004;
    const x = nube.x - mitad;
    const y = nube.y + derivaY - nube.alto * 0.5;

    const alfaGris = nube.alfa * (1 - progreso);
    if (alfaGris > 0.001) {
      contexto.globalAlpha = alfaGris;
      contexto.drawImage(nube.graficoGris.elt, x, y, nube.ancho, nube.alto);
    }

    const alfaColor = nube.alfa * progreso;
    if (alfaColor > 0.001) {
      contexto.globalAlpha = alfaColor;
      contexto.drawImage(nube.graficoColor.elt, x, y, nube.ancho, nube.alto);
    }
  }

  contexto.restore();
}

/** Destellos cálidos fijos alrededor del horizonte, cada uno con su pulso. */
function crearDestellosHorizonte() {
  const lista = [];

  for (let i = 0; i < DESTELLOS_PAISAJE.cantidad; i += 1) {
    lista.push({
      x: width * random(0.05, 0.95),
      y: height * random(DESTELLOS_PAISAJE.yMin, DESTELLOS_PAISAJE.yMax),
      radio: random(DESTELLOS_PAISAJE.radioMinimo, DESTELLOS_PAISAJE.radioMaximo),
      frecuencia: random(DESTELLOS_PAISAJE.frecuenciaMinima, DESTELLOS_PAISAJE.frecuenciaMaxima),
      fase: random(TWO_PI),
      tono: random() < 0.5 ? DESTELLOS_PAISAJE.tonoCalido : DESTELLOS_PAISAJE.tonoRosa,
    });
  }

  return lista;
}

/**
 * Los destellos del horizonte aparecen recién cuando asoma el atardecer y
 * titilan con un pulso propio. El pico nunca pasa de 0.18 de opacidad.
 */
function dibujarDestellosHorizonte(t) {
  if (destellosHorizonte.length === 0) return;

  const visibilidad = suavizar(
    constrain(
      (progresoPaisaje - DESTELLOS_PAISAJE.desde) /
        (DESTELLOS_PAISAJE.hasta - DESTELLOS_PAISAJE.desde),
      0,
      1
    )
  );
  if (visibilidad <= 0.001) return;

  noStroke();

  for (const destello of destellosHorizonte) {
    const pulso = 0.5 + 0.5 * Math.sin(t * Math.PI * 2 * destello.frecuencia + destello.fase);
    const alfa = DESTELLOS_PAISAJE.alfaMaximo * visibilidad * pulso * pulso;
    if (alfa < 0.004) continue;

    fill(destello.tono[0], destello.tono[1], destello.tono[2], 255 * alfa);
    circle(destello.x, destello.y, destello.radio * 2);
  }
}

/**
 * Centro aproximado de la flor de una planta: su base uniforme (la misma que
 * usa planta.js) subida por la altura declarada. El dibujo final vive en
 * `#planta-overlay`, así que lo que se pinte acá queda detrás.
 */
function centroDePlanta(planta) {
  const alto = (Number(planta && planta.altura) || 0.4) * height;
  const base = planta && planta.base;
  const x = base && Number.isFinite(Number(base.x)) ? Number(base.x) : width * (Number(planta && planta.x) || 0.5);
  // Respaldo mientras planta.js todavía no publicó la base.
  const yBase = base && Number.isFinite(Number(base.y)) ? Number(base.y) : height * 0.94;
  return { x, y: yBase - alto * 0.82 };
}

/** Centros de todas las plantas del catálogo (con respaldo si no hay ninguna). */
function centrosDeFlores() {
  const centros = [];

  if (typeof plantaDebug !== 'undefined' && plantaDebug && typeof plantaDebug.plantas === 'function') {
    const plantas = plantaDebug.plantas();
    if (Array.isArray(plantas)) {
      for (const planta of plantas) {
        if (planta) centros.push(centroDePlanta(planta));
      }
    }
  }

  if (centros.length === 0) centros.push({ x: width * 0.5, y: height * 0.4 });
  return centros;
}

/** Una oleada de destellos dorados y rosados, disparada una vez por floración. */
function dispararOleadaFlores(centroDeLaFlor) {
  const centros = centroDeLaFlor ? [centroDeLaFlor] : centrosDeFlores();

  for (let i = 0; i < OLEADA_FLORES.cantidad; i += 1) {
    const centro = centros[Math.floor(random(centros.length))] || centros[0];
    const angulo = random(TWO_PI);
    const velocidad = random(0.02, 0.07) * Math.min(width, height);
    const vida = random(OLEADA_FLORES.duracionMinima, OLEADA_FLORES.duracionMaxima);

    oleadaFlores.push({
      x: centro.x + random(-1, 1) * width * OLEADA_FLORES.dispersionX,
      y: centro.y + random(-1, 1) * height * OLEADA_FLORES.dispersionY,
      vx: Math.cos(angulo) * velocidad,
      vy: Math.sin(angulo) * velocidad - height * OLEADA_FLORES.subida,
      radio: random(OLEADA_FLORES.radioMinimo, OLEADA_FLORES.radioMaximo),
      vida,
      vidaMaxima: vida,
      tono: random() < 0.5 ? OLEADA_FLORES.tonoDorado : OLEADA_FLORES.tonoRosa,
    });
  }
}

/** Avanza y dibuja la oleada; cada destello entra y sale en su propia vida. */
function actualizarDibujarOleadaFlores(dt) {
  if (oleadaFlores.length === 0) return;

  const vivas = [];
  noStroke();

  for (const destello of oleadaFlores) {
    destello.x += destello.vx * dt;
    destello.y += destello.vy * dt;
    destello.vida -= dt;
    if (destello.vida <= 0) continue;

    const avance = 1 - destello.vida / destello.vidaMaxima;
    const alfa = OLEADA_FLORES.alfaMaximo * Math.sin(Math.PI * avance);
    if (alfa < 0.004) {
      vivas.push(destello);
      continue;
    }

    fill(destello.tono[0], destello.tono[1], destello.tono[2], 255 * alfa);
    circle(destello.x, destello.y, destello.radio * 2);
    vivas.push(destello);
  }

  oleadaFlores = vivas;
}

/* ============================================================
   PERSONAJE
   Camina por el plano medio, en bucle, y se detiene a mirar un
   árbol seco antes de ponerse triste. Es un sprite único: el
   caminar y la tristeza son transformaciones sobre la misma
   imagen, no cuadros de animación.
   ============================================================ */

/**
 * Carga el sprite. En p5 2.x `loadImage` es ASYNC —devuelve una promesa, no la
 * imagen—, y `setup()` es sincrónico a propósito. Se usan callbacks: si el
 * archivo falta, el paisaje ya está andando y solo se pierde el personaje.
 */
function cargarPersonaje() {
  if (personaje.imagen || personaje.cargando) return;

  if (typeof loadImage !== 'function') {
    console.error('[personaje] loadImage no está disponible.');
    return;
  }

  personaje.cargando = true;

  loadImage(
    PERSONAJE.rutaImagen,
    (imagen) => {
      personaje.cargando = false;
      recortarFondoImagen(imagen);

      personaje.imagen = imagen;
      // El ancho real depende de la proporción de la imagen; hasta que llega,
      // reiniciarPersonaje() usa una estimación.
      personaje.ancho = personaje.alto * (imagen.width / imagen.height);
      ubicarParada();

      console.info(`[personaje] Listo: ${imagen.width}×${imagen.height}`);

      // La pose feliz es opcional: si falta, el estado feliz usa esta misma.
      cargarPersonajeFeliz();
    },
    (error) => {
      personaje.cargando = false;
      console.error(
        `[personaje] No se pudo cargar "${PERSONAJE.rutaImagen}". Guardá la imagen en la raíz del proyecto, junto a index.html.`,
        error
      );
    }
  );
}

/**
 * Pose feliz, con las manos arriba. Se carga aparte y es opcional: si el
 * archivo no está, el personaje celebra igual con el sprite de siempre.
 */
function cargarPersonajeFeliz() {
  if (personaje.imagenFeliz || personaje.cargandoFeliz) return;

  if (typeof loadImage !== 'function') return;

  personaje.cargandoFeliz = true;

  loadImage(
    PERSONAJE.rutaImagenFeliz,
    (imagen) => {
      personaje.cargandoFeliz = false;
      recortarFondoImagen(imagen);
      personaje.imagenFeliz = imagen;
      console.info(`[personaje] Pose feliz lista: ${imagen.width}×${imagen.height}`);
    },
    () => {
      personaje.cargandoFeliz = false;
      console.warn(
        `[personaje] No se encontró "${PERSONAJE.rutaImagenFeliz}": el estado feliz usa la pose actual.`
      );
    }
  );
}

/** Vuelve el personaje al arranque del bucle. Se llama al construir la escena. */
function reiniciarPersonaje() {
  personaje.alto = height * PERSONAJE.altura;
  personaje.ancho = personaje.imagen
    ? personaje.alto * (personaje.imagen.width / personaje.imagen.height)
    : personaje.alto * 0.84; // proporción estimada mientras no hay imagen

  personaje.arbol = arbolDeMirada();
  ubicarParada();

  personaje.x = -personaje.ancho;
  personaje.estado = 'caminando';
  personaje.relojEstado = 0;
  personaje.relojLagrima = 0;
  personaje.miradaHecha = false;
  personaje.fasePaso = 0;
  personaje.inclinacion = 0;
  personaje.hundimiento = 1;
  personaje.lagrimas.length = 0;
}

/**
 * El árbol seco al que le va a doler mirar: el más alto del plano medio, que es
 * el que tiene ramas a su altura. Devuelve null si todavía no hay árboles.
 */
function arbolDeMirada() {
  let elegido = null;

  for (const arbol of arbolesViento) {
    if (arbol.plano !== 1) continue;
    if (!elegido || arbol.alto > elegido.alto) elegido = arbol;
  }

  return elegido;
}

/** La parada queda justo antes del árbol: lo mira de frente, no de costado. */
function ubicarParada() {
  const arbol = personaje.arbol;
  personaje.xParada = arbol ? arbol.x - personaje.ancho * 0.85 : width * 0.55;
}

/**
 * Camina → frena → mira las ramas → se pone triste → sigue caminando. Al salir
 * por la derecha reingresa por la izquierda: el bucle no tiene costura.
 * Mientras la vida del paisaje está activa (manos en cuadro + planta crecida)
 * el recorrido se interrumpe y celebra con la pose feliz.
 * Todo el avance sale de `dt`, así que no depende del framerate.
 */
function actualizarPersonaje(dt) {
  actualizarLagrimas(dt);

  if (!personaje.imagen) return;

  // La planta crecida lo pone feliz: no depende de que las manos sigan en
  // cuadro, porque la planta se queda. Antes de eso hace su recorrido normal.
  const crecimiento = typeof objetivoDeVida === 'function' ? objetivoDeVida() : 0;
  const quiereCelebrar = crecimiento >= PERSONAJE.crecimientoFeliz;

  if (quiereCelebrar && personaje.estado !== 'feliz') {
    personaje.estado = 'feliz';
    personaje.relojEstado = 0;
    personaje.lagrimas.length = 0;
  } else if (!quiereCelebrar && personaje.estado === 'feliz') {
    personaje.estado = 'caminando';
    personaje.relojEstado = 0;
  }

  personaje.relojEstado += dt;

  if (personaje.estado === 'feliz') {
    // Camina celebrando: así se lo ve aunque la planta crezca cuando está
    // entrando o saliendo de cuadro.
    personaje.x += height * PERSONAJE.velocidad * PERSONAJE.velocidadFeliz * dt;
    personaje.fasePaso += dt * PERSONAJE.pasos * PERSONAJE.ritmoFeliz;
  } else if (personaje.estado === 'caminando') {
    personaje.x += height * PERSONAJE.velocidad * dt;
    personaje.fasePaso += dt * PERSONAJE.pasos;

    // `miradaHecha` evita volver a frenar en el mismo árbol: retomando la
    // caminata ya está parado sobre la marca y sin la bandera se quedaría
    // mirando en bucle sin avanzar nunca.
    if (!personaje.miradaHecha && personaje.x >= personaje.xParada) {
      personaje.miradaHecha = true;
      personaje.estado = 'mirando';
      personaje.relojEstado = 0;
    }
  } else if (personaje.estado === 'mirando') {
    if (personaje.relojEstado >= PERSONAJE.duracionMirar) {
      personaje.estado = 'triste';
      personaje.relojEstado = 0;
      personaje.relojLagrima = 0;
      soltarLagrima();
    }
  } else {
    // Triste: mientras dure, se le escapa una lágrima cada tanto. Una sola
    // sería invisible a esta escala; un chorro parecería una canilla.
    personaje.relojLagrima += dt;
    if (personaje.relojLagrima >= PERSONAJE.cadaLagrima) {
      personaje.relojLagrima = 0;
      soltarLagrima();
    }

    if (personaje.relojEstado >= PERSONAJE.duracionTriste) {
      personaje.estado = 'caminando';
      personaje.relojEstado = 0;
    }
  }

  // Fuera de pantalla por la derecha: reingresa por la izquierda.
  if (personaje.x > width + personaje.ancho) {
    personaje.x = -personaje.ancho;
    personaje.estado = quiereCelebrar ? 'feliz' : 'caminando';
    personaje.relojEstado = 0;
    personaje.miradaHecha = false; // en la vuelta siguiente vuelve a frenar
    personaje.lagrimas.length = 0;
  }

  // Pose: mirar = se echa atrás para ver las ramas; triste = cabecea y se
  // hunde en sí mismo; feliz = se yergue. El pasaje es exponencial: no hay
  // salto entre estados.
  let objetivo = 0;
  if (personaje.estado === 'feliz') objetivo = PERSONAJE.inclinacionFeliz;
  else if (personaje.estado === 'mirando') objetivo = PERSONAJE.inclinacionMirar;
  else if (personaje.estado === 'triste') objetivo = PERSONAJE.inclinacionTriste;

  const k = 1 - Math.exp(-PERSONAJE.suavizado * dt);
  personaje.inclinacion = lerp(personaje.inclinacion, objetivo, k);

  const objetivoHundimiento = personaje.estado === 'triste' ? PERSONAJE.hundimiento : 1;
  personaje.hundimiento = lerp(personaje.hundimiento, objetivoHundimiento, k);
}

/**
 * Dibuja el sprite anclado en los pies, con el vaivén del paso. El origen es el
 * suelo, así que el hundimiento y el rebote no lo hacen flotar.
 */
function dibujarPersonaje() {
  if (!personaje.imagen) return;

  const alto = personaje.alto;
  // Base sobre la capa de suelo del plano medio: al caminar sigue el relieve,
  // así que sube y baja con la tierra en vez de moverse en línea recta.
  const base = bordeDeSuelo(personaje.x, CAPAS_SUELO[1], horizonteEscena) + height * 0.004;

  const caminando = personaje.estado === 'caminando';
  const celebrando = personaje.estado === 'feliz';

  // La pose feliz puede tener otra proporción (manos arriba): se escala por el
  // alto y el ancho sale de SU imagen, así nunca se estira.
  const imagen = celebrando && personaje.imagenFeliz ? personaje.imagenFeliz : personaje.imagen;
  const altoDibujo = alto * (celebrando ? PERSONAJE.escalaFeliz : 1);
  const anchoDibujo = altoDibujo * (imagen.width / imagen.height);

  const balanceo = caminando
    ? Math.sin(personaje.fasePaso * Math.PI) * PERSONAJE.balanceoPaso
    : celebrando
      ? Math.sin(personaje.fasePaso * Math.PI) * PERSONAJE.balanceoFeliz
      : 0;

  // Un rebote por paso al caminar; un salto más amplio al celebrar.
  const reboteCaminar = caminando
    ? Math.abs(Math.sin(personaje.fasePaso * Math.PI)) * alto * 0.03
    : 0;
  const reboteFeliz = celebrando
    ? Math.abs(Math.sin(personaje.fasePaso * Math.PI)) * alto * PERSONAJE.saltoFeliz
    : 0;
  const rebote = reboteCaminar + reboteFeliz;

  push();
  translate(personaje.x, base - rebote);
  rotate(personaje.inclinacion + balanceo);
  scale(1, personaje.hundimiento);
  image(imagen, -anchoDibujo * 0.5, -altoDibujo, anchoDibujo, altoDibujo);
  dibujarLagrimas();
  pop();
}

/* ---------- Personaje: lágrima ---------- */

/** Una lágrima nace en el ojo cuando se pone triste. */
function soltarLagrima() {
  personaje.lagrimas.push({
    x: (PERSONAJE.ojo.x - 0.5) * personaje.ancho,
    y: (PERSONAJE.ojo.y - 1) * personaje.alto,
    velocidad: 0,
    edad: 0,
  });
}

function actualizarLagrimas(dt) {
  for (const gota of personaje.lagrimas) {
    gota.velocidad += personaje.alto * 2.4 * dt;
    gota.y += gota.velocidad * dt;
    gota.edad += dt;
  }

  personaje.lagrimas = personaje.lagrimas.filter((gota) => gota.edad < 1.2);
}

/** Se dibuja dentro del push/rotate del personaje: coordenadas locales. */
function dibujarLagrimas() {
  if (!personaje.lagrimas.length) return;

  const diametro = max(1.8, personaje.alto * 0.045);

  noStroke();
  for (const gota of personaje.lagrimas) {
    fill(188, 222, 240, 210 * (1 - gota.edad / 1.2));
    circle(gota.x, gota.y, diametro);
  }
}

/* ---------- Personaje: recorte del fondo ---------- */

/**
 * Recorta el fondo claro del sprite para que el paisaje se vea detrás.
 * Inunda desde los bordes en vez de usar un umbral global: los ojos del
 * personaje también son blancos y con un umbral global se borrarían.
 */
function recortarFondoImagen(imagen) {
  if (!PERSONAJE.toleranciaFondo) return;

  imagen.loadPixels();
  const cambiados = recortarFondoClaro(
    imagen.pixels,
    imagen.width,
    imagen.height,
    PERSONAJE.toleranciaFondo
  );
  imagen.updatePixels();

  console.info(`[personaje] Fondo recortado: ${cambiados} px`);
}

/**
 * Vuelve transparente lo que sea claro Y esté conectado con el borde del
 * lienzo. Todo lo demás —incluidos los blancos internos, como los ojos— queda
 * intacto. `pixeles` es un RGBA de 4 bytes por píxel; devuelve cuántos cambió.
 */
function recortarFondoClaro(pixeles, ancho, alto, tolerancia) {
  const minimo = 255 - tolerancia;
  const total = ancho * alto;
  const visto = new Uint8Array(total);
  const pila = new Int32Array(total);
  let tope = 0;
  let cambiados = 0;

  const esFondo = (indice) => {
    const p = indice * 4;
    return (
      pixeles[p] >= minimo &&
      pixeles[p + 1] >= minimo &&
      pixeles[p + 2] >= minimo &&
      pixeles[p + 3] > 0
    );
  };

  // `visto` se marca al empujar: cada píxel entra a la pila una sola vez, así
  // que la pila nunca desborda.
  const empujar = (indice) => {
    if (indice < 0 || indice >= total || visto[indice]) return;
    visto[indice] = 1;
    if (esFondo(indice)) pila[tope++] = indice;
  };

  for (let x = 0; x < ancho; x += 1) {
    empujar(x);
    empujar((alto - 1) * ancho + x);
  }
  for (let y = 0; y < alto; y += 1) {
    empujar(y * ancho);
    empujar(y * ancho + ancho - 1);
  }

  while (tope > 0) {
    const indice = pila[--tope];
    pixeles[indice * 4 + 3] = 0;
    cambiados += 1;

    const x = indice % ancho;
    if (x > 0) empujar(indice - 1);
    if (x < ancho - 1) empujar(indice + 1);
    empujar(indice - ancho);
    empujar(indice + ancho);
  }

  return cambiados;
}

/* ============================================================
   CÁMARA
   ============================================================ */

/* ---------- Cámara: configuración ---------- */

// Si en este tiempo el navegador no entregó el stream, asumimos que falló.
// Hace falta porque createCapture() solo avisa cuando SALE BIEN: si el usuario
// niega el permiso, su callback nunca se llama y la página quedaría muda.
const ESPERA_CAMARA_MS = 12000;

/**
 * Encuadre que se le pide a la cámara. 16:9 es la proporción más ancha que
 * ofrecen las webcams: es la que deja más margen lateral para abrir los brazos.
 * 720p sobra para el modelo (MediaPipe reescala la entrada igual) y pesa menos
 * que 1080p al procesar.
 */
const ENCUADRE_CAMARA = {
  ancho: 1280,
  alto: 720,
  aspecto: 16 / 9,
};

let captura = null; // p5.Element que envuelve el <video>. Instancia única.
let estadoCamara = 'iniciando'; // 'iniciando' | 'lista' | 'error'
let mensajeCamara = null; // <p id="camara-mensaje">
let temporizadorCamara = null;

/* ---------- Cámara: inicio ---------- */

/**
 * Pide la cámara y monta el video una sola vez.
 * Idempotente: si ya existe una captura, no crea otra.
 */
function iniciarCamara() {
  if (captura) return;

  mensajeCamara = document.getElementById('camara-mensaje');

  // Sin contexto seguro (file://) el navegador ni siquiera expone getUserMedia.
  if (!navigator.mediaDevices || typeof navigator.mediaDevices.getUserMedia !== 'function') {
    mostrarErrorCamara(
      'Este navegador no puede acceder a la cámara. Abrí la página por http://localhost o por HTTPS.'
    );
    return;
  }

  cambiarEstadoCamara('iniciando');
  mostrarMensajeCamara('Solicitando permiso para usar la cámara…');

  // Da feedback inmediato si el sitio ya está bloqueado (no espera al timeout).
  vigilarPermisoCamara();

  try {
    // createCapture crea el <video>, pide el permiso y arranca el stream.
    //
    // p5 fusiona este objeto con { video: true, audio: false }, así que las
    // restricciones del stream van anidadas en `video`. Si se pasaran width y
    // height en el primer nivel, getUserMedia las ignoraría sin avisar.
    //
    // flipped: true espeja la imagen EN PANTALLA (vista selfie). Es solo
    // visual: los píxeles que recibirá ml5 NO vienen espejados. Por eso existe
    // mapearPuntoCamara(), que aplica espejo y recorte una sola vez.
    captura = createCapture(
      VIDEO,
      {
        flipped: true,
        video: {
          facingMode: 'user',
          width: { ideal: ENCUADRE_CAMARA.ancho },
          height: { ideal: ENCUADRE_CAMARA.alto },
          aspectRatio: { ideal: ENCUADRE_CAMARA.aspecto },
        },
      },
      alEstarListaLaCamara
    );
  } catch (error) {
    console.error('[camara] createCapture falló:', error);
    mostrarErrorCamara('No se pudo iniciar la cámara en este navegador.');
    return;
  }

  // El <video> nace pegado al body: lo movemos al marco de la cámara.
  captura.parent('camara-marco');

  // Requisitos de reproducción: sin audio y en línea (necesario en móviles).
  captura.elt.muted = true;
  captura.elt.autoplay = true;
  captura.elt.setAttribute('playsinline', '');

  // Red de seguridad para el caso en que el callback nunca se llame.
  temporizadorCamara = window.setTimeout(() => {
    if (estadoCamara === 'iniciando') {
      mostrarErrorCamara(
        'No se pudo acceder a la cámara. Revisá el permiso del navegador y que ningún otro programa la esté usando.'
      );
    }
  }, ESPERA_CAMARA_MS);
}

/* ---------- Cámara: resultados ---------- */

/** Callback de createCapture: corre recién cuando el stream tiene metadata. */
function alEstarListaLaCamara() {
  limpiarTemporizadorCamara();
  cambiarEstadoCamara('lista');
  mostrarMensajeCamara('');

  const video = captura ? captura.elt : null;
  if (video) {
    console.info(`[camara] Video listo: ${video.videoWidth}×${video.videoHeight}`);
  }

  // Recién acá hay video con frames: los modelos pueden empezar a mirar.
  iniciarBodyPose();
  iniciarHandPose();
}

/**
 * Muestra el error en el panel, lo registra en consola y libera la captura
 * fallida para no dejar un <video> muerto colgado en el DOM.
 */
function mostrarErrorCamara(texto) {
  limpiarTemporizadorCamara();
  cambiarEstadoCamara('error');
  mostrarMensajeCamara(texto);
  console.error('[camara]', texto);
  detenerCamara();
}

/* ---------- Cámara: utilidades ---------- */

/**
 * Detiene las pistas del stream y quita el video del DOM.
 * Después de esto se puede volver a llamar iniciarCamara().
 */
function detenerCamara() {
  if (!captura) return;

  detenerBodyPose();
  detenerHandPose();

  const video = captura.elt;
  const stream = video && video.srcObject;

  if (stream && typeof stream.getTracks === 'function') {
    for (const pista of stream.getTracks()) pista.stop();
  }

  captura.remove();
  captura = null;
  limpiarTemporizadorCamara();
}

function limpiarTemporizadorCamara() {
  if (temporizadorCamara) {
    window.clearTimeout(temporizadorCamara);
    temporizadorCamara = null;
  }
}

/** Cambia el estado y lo refleja en el HTML (lo usa el CSS). */
function cambiarEstadoCamara(estado) {
  estadoCamara = estado;

  const contenedor = document.getElementById('camara-contenedor');
  if (contenedor) contenedor.dataset.estado = estado;
}

/** Escribe el mensaje del panel. Cadena vacía = ocultarlo. */
function mostrarMensajeCamara(texto) {
  if (!mensajeCamara) mensajeCamara = document.getElementById('camara-mensaje');
  if (!mensajeCamara) return;

  mensajeCamara.textContent = texto;
  mensajeCamara.hidden = texto === '';
}

/**
 * Detecta el bloqueo del permiso apenas ocurre, sin esperar el timeout.
 * No todos los navegadores permiten consultar 'camera': si falla, no pasa nada,
 * el temporizador sigue siendo la red de seguridad.
 */
function vigilarPermisoCamara() {
  if (!navigator.permissions || typeof navigator.permissions.query !== 'function') return;

  const AVISO_BLOQUEO =
    'La cámara está bloqueada para este sitio. Habilitala en los permisos del navegador y recargá la página.';

  navigator.permissions
    .query({ name: 'camera' })
    .then((permiso) => {
      if (permiso.state === 'denied' && estadoCamara !== 'lista') {
        mostrarErrorCamara(AVISO_BLOQUEO);
        return;
      }

      permiso.onchange = () => {
        // Solo importa si todavía no hay video andando.
        if (permiso.state === 'denied' && estadoCamara !== 'lista') {
          mostrarErrorCamara(AVISO_BLOQUEO);
        }
      };
    })
    .catch(() => {
      // Navegador sin soporte para consultar la cámara: no hacemos nada.
    });
}

/* ---------- Puente hacia ml5.js ---------- */

/**
 * Devuelve el <video> crudo (HTMLVideoElement) o null si todavía no hay stream.
 *
 * Es el punto de entrada para la detección de manos, que NO está implementada:
 *   const video = obtenerVideoCamara();
 *   if (video) detector.detectStart(video, alDetectarManos);
 *
 * Se devuelve el elemento nativo a propósito: ml5 trabaja sobre el video, no
 * sobre el canvas, y así el reconocimiento no depende de cómo se dibuja la escena.
 */
function obtenerVideoCamara() {
  if (!captura || estadoCamara !== 'lista') return null;
  return captura.elt;
}

/* ---------- Encuadre: coordenadas de detección ↔ imagen mostrada ---------- */

/**
 * Convierte un punto de detección a coordenadas del área visible del panel.
 *
 * Entrada: x, y normalizados 0..1 del frame ORIGINAL de la cámara (lo que
 * devolverá MediaPipe/ml5, sin espejar).
 * Salida: { x, y, visible } normalizados 0..1 sobre el marco visible, ya
 * espejados y con el recorte de object-fit aplicado.
 *
 * Todavía no hay detección: existe para que, cuando se integre, las
 * coordenadas coincidan exactamente con lo que el usuario ve. Sin esto, con
 * `flipped: true` los puntos saldrían invertidos y cualquier gesto quedaría
 * del lado equivocado.
 *
 *   const video = obtenerVideoCamara();
 *   if (video) {
 *     const punto = mapearPuntoCamara(landmark.x, landmark.y);
 *     if (punto.visible) dibujarAlgo(punto.x * width, punto.y * height);
 *   }
 */
function mapearPuntoCamara(x, y) {
  const video = obtenerVideoCamara();
  const marco = document.getElementById('camara-marco');

  // Sin stream no hay transformación que aplicar.
  if (!video || !marco) return { x, y, visible: true };

  const anchoVideo = video.videoWidth;
  const altoVideo = video.videoHeight;
  const anchoMarco = marco.clientWidth;
  const altoMarco = marco.clientHeight;

  if (!anchoVideo || !altoVideo || !anchoMarco || !altoMarco) {
    return { x, y, visible: true };
  }

  // Mismo cálculo que hace object-fit: cover.
  const escala = Math.max(anchoMarco / anchoVideo, altoMarco / altoVideo);
  const anchoDibujado = anchoVideo * escala;
  const altoDibujado = altoVideo * escala;

  // object-position se lee del CSS: una sola fuente de verdad, sin duplicar
  // el 50% 40% acá dentro.
  const posicion = leerPosicion(getComputedStyle(video).objectPosition);

  const desplazamientoX = (anchoMarco - anchoDibujado) * posicion.x;
  const desplazamientoY = (altoMarco - altoDibujado) * posicion.y;

  // El <video> lleva scaleX(-1): se invierte x respecto del centro del marco.
  const pantallaX = 1 - (desplazamientoX + x * anchoDibujado) / anchoMarco;
  const pantallaY = (desplazamientoY + y * altoDibujado) / altoMarco;

  return {
    x: pantallaX,
    y: pantallaY,
    visible: pantallaX >= 0 && pantallaX <= 1 && pantallaY >= 0 && pantallaY <= 1,
  };
}

/** Lee un object-position tipo "50% 40%" y lo devuelve en fracción 0..1. */
function leerPosicion(valor) {
  const partes = String(valor).split(' ').map(parseFloat);
  return {
    x: Number.isFinite(partes[0]) ? partes[0] / 100 : 0.5,
    y: Number.isFinite(partes[1]) ? partes[1] / 100 : 0.5,
  };
}

/* ============================================================
   BODY POSE (ml5.js)
   Detección del tren superior: nariz, ojos, orejas, hombros,
   codos, muñecas y caderas. Rodillas, tobillos y pies quedan
   fuera a propósito: el proyecto trabaja de busto hacia arriba.

   OJO con las coordenadas: con MoveNet sobre un <video>, ml5
   devuelve los keypoints en PÍXELES del video (su método
   resizeKeypoints los escala a image.width/height), no en 0..1.
   Acá se normalizan al entrar, así el resto del código trabaja
   siempre en 0..1 y puede usar mapearPuntoCamara().
   ============================================================ */

/* ---------- Body Pose: configuración ---------- */

/** Puntos que nos interesan, en orden de lectura. */
const PUNTOS_BUSTO = [
  { clave: 'nose', etiqueta: 'nariz' },
  { clave: 'left_eye', etiqueta: 'ojo izq' },
  { clave: 'right_eye', etiqueta: 'ojo der' },
  { clave: 'left_ear', etiqueta: 'oreja izq' },
  { clave: 'right_ear', etiqueta: 'oreja der' },
  { clave: 'left_shoulder', etiqueta: 'hombro izq' },
  { clave: 'right_shoulder', etiqueta: 'hombro der' },
  { clave: 'left_elbow', etiqueta: 'codo izq' },
  { clave: 'right_elbow', etiqueta: 'codo der' },
  { clave: 'left_wrist', etiqueta: 'muñeca izq' },
  { clave: 'right_wrist', etiqueta: 'muñeca der' },
  { clave: 'left_hip', etiqueta: 'cadera izq' },
  { clave: 'right_hip', etiqueta: 'cadera der' },
];

/** Debajo de esto el punto existe pero no es confiable. */
const CONFIANZA_MINIMA = 0.3;

/** Para dar por detectado el busto hacen falta nariz y ambos hombros. */
const CONFIANZA_BUSTO = 0.4;

/** El DOM no necesita más de ~8 actualizaciones por segundo. */
const REFRESCO_LECTURA_MS = 120;

/** Aviso si la descarga del modelo no termina (ml5 + pesos ≈ 9 MB la 1ª vez). */
const ESPERA_MODELO_MS = 45000;

let bodyPose = null;
let estadoPose = 'inactivo'; // 'inactivo' | 'cargando' | 'listo' | 'error'
let poseBusto = null; // última pose normalizada (0..1) o null
let mensajePose = 'Cuerpo: esperando cámara…';
let ultimoPintadoPose = 0;
let cargandoBodyPose = false;
let temporizadorModelo = null;

/* ---------- Body Pose: inicialización ---------- */

/**
 * Carga el modelo y arranca la detección continua.
 * Idempotente: si ya hay instancia o una carga en curso, no hace nada.
 * Se llama recién cuando la cámara entregó su primer frame.
 */
async function iniciarBodyPose() {
  if (bodyPose || cargandoBodyPose) return;

  if (typeof ml5 === 'undefined' || typeof ml5.bodyPose !== 'function') {
    cambiarEstadoPose('error', 'Cuerpo: ml5 no cargó. Revisá la conexión y recargá.');
    return;
  }

  const video = obtenerVideoCamara();
  if (!video) {
    cambiarEstadoPose('error', 'Cuerpo: la cámara no está lista.');
    return;
  }

  cargandoBodyPose = true;
  cambiarEstadoPose('cargando', 'Cuerpo: cargando modelo…');
  console.info('[bodyPose] Cargando MoveNet SINGLEPOSE_LIGHTNING…');

  // Si la descarga se cuelga, no dejamos la UI muda para siempre.
  temporizadorModelo = window.setTimeout(() => {
    if (estadoPose === 'cargando') {
      cambiarEstadoPose(
        'error',
        'Cuerpo: el modelo no terminó de cargar. Revisá la conexión y recargá.'
      );
    }
  }, ESPERA_MODELO_MS);

  try {
    // OJO: con p5 2.x, ml5 promisifica sus constructores (p5 2.x ya no tiene
    // registerMethod, así que ml5 usa "async constructors"). `ml5.bodyPose()`
    // devuelve una PROMESA, no la instancia: acceder a `.ready` ahí es
    // undefined y rompe. Con p5 1.x devuelve la instancia y hay que esperar
    // `.ready`. `await` cubre los dos casos.
    const instancia = await ml5.bodyPose('MoveNet', {
      modelType: 'SINGLEPOSE_LIGHTNING',
      enableSmoothing: true,
      minPoseScore: 0.25,
    });

    // Red de seguridad para el camino de p5 1.x.
    if (instancia && instancia.ready && typeof instancia.ready.then === 'function') {
      await instancia.ready;
    }

    if (!instancia || typeof instancia.detectStart !== 'function') {
      throw new Error('ml5 no devolvió un modelo utilizable');
    }

    bodyPose = instancia;
    alCargarModeloPose();
  } catch (error) {
    manejarErrorPose(error);
  } finally {
    cargandoBodyPose = false;
    if (temporizadorModelo) {
      window.clearTimeout(temporizadorModelo);
      temporizadorModelo = null;
    }
  }
}

/** El modelo terminó de cargar: arranca el bucle de detección. */
function alCargarModeloPose() {
  const video = obtenerVideoCamara();
  if (!video) {
    cambiarEstadoPose('error', 'Cuerpo: la cámara se cerró antes de cargar el modelo.');
    return;
  }

  if (!bodyPose.detecting) {
    // detectStart corre su propio bucle y avisa por callback en cada frame.
    bodyPose.detectStart(video, alDetectarPoseBusto);
  }

  console.info('[bodyPose] Modelo listo: MoveNet SINGLEPOSE_LIGHTNING');
  cambiarEstadoPose('listo', 'Cuerpo: buscando…');
}

/**
 * Detiene el bucle de detección y limpia el estado.
 * `detectStop()` solo marca la señal: el bucle termina en el frame siguiente.
 */
function detenerBodyPose() {
  if (bodyPose && bodyPose.detecting) {
    bodyPose.detectStop();
  }
  poseBusto = null;
  cambiarEstadoPose('inactivo', 'Cuerpo: inactivo');
}

function manejarErrorPose(error) {
  console.error('[bodyPose]', error);
  const detalle = error instanceof Error ? error.message : String(error ?? 'error desconocido');
  cambiarEstadoPose('error', `Cuerpo: error del modelo (${detalle})`);
}

/* ---------- Body Pose: detección ---------- */

/**
 * Callback de detectStart: se ejecuta en cada frame procesado.
 * `poses` es un array; vacío significa que no hay nadie en cuadro.
 */
function alDetectarPoseBusto(poses) {
  if (!Array.isArray(poses) || poses.length === 0) {
    poseBusto = null;
    pintarPose();
    return;
  }

  poseBusto = normalizarPoseBusto(elegirMejorPose(poses));
  pintarPose();
}

/** Con varias poses en cuadro, nos quedamos con la de busto más confiable. */
function elegirMejorPose(poses) {
  let mejor = poses[0];
  let mejorPuntaje = -1;

  for (const pose of poses) {
    let puntaje = 0;
    for (const definir of PUNTOS_BUSTO) {
      const punto = pose[definir.clave];
      if (punto && typeof punto.confidence === 'number') puntaje += punto.confidence;
    }
    if (puntaje > mejorPuntaje) {
      mejorPuntaje = puntaje;
      mejor = pose;
    }
  }

  return mejor;
}

/**
 * Convierte la pose cruda de ml5 a un objeto normalizado y estable:
 * cada punto con x, y en 0..1 (del frame de cámara) y su confianza.
 */
function normalizarPoseBusto(pose) {
  const video = obtenerVideoCamara();

  // ml5 usa image.width / image.height para escalar: son los mismos valores
  // con los que hay que dividir para volver a 0..1.
  const ancho = (video && (video.width || video.videoWidth)) || 1;
  const alto = (video && (video.height || video.videoHeight)) || 1;

  const puntos = {};
  let narizVisible = false;
  let hombrosVisibles = 0;
  let sumaConfianza = 0;
  let cantidadConFuerza = 0;

  for (const definir of PUNTOS_BUSTO) {
    const crudo = pose[definir.clave];

    if (!crudo || typeof crudo.x !== 'number' || typeof crudo.y !== 'number') {
      puntos[definir.clave] = null;
      continue;
    }

    const confianza = typeof crudo.confidence === 'number' ? crudo.confidence : 0;

    puntos[definir.clave] = {
      etiqueta: definir.etiqueta,
      x: crudo.x / ancho,
      y: crudo.y / alto,
      confianza,
      visible: confianza >= CONFIANZA_MINIMA,
    };

    sumaConfianza += confianza;
    cantidadConFuerza += 1;

    if (definir.clave === 'nose' && confianza >= CONFIANZA_BUSTO) narizVisible = true;
    if (
      (definir.clave === 'left_shoulder' || definir.clave === 'right_shoulder') &&
      confianza >= CONFIANZA_BUSTO
    ) {
      hombrosVisibles += 1;
    }
  }

  return {
    timestamp: performance.now(),
    puntos,
    // El busto está completo si se ve la nariz y los dos hombros.
    bustoEnCuadro: narizVisible && hombrosVisibles === 2,
    hombrosVisibles,
    confianzaMedia: cantidadConFuerza ? sumaConfianza / cantidadConFuerza : 0,
  };
}

/* ---------- Body Pose: lectura en pantalla ---------- */

/**
 * Actualiza el estado y la tabla de puntos del panel de cámara.
 * Throttled: el modelo entrega ~30 resultados por segundo y no hace falta
 * tocar el DOM a esa velocidad.
 */
function pintarPose(forzar = false) {
  const ahora = performance.now();
  if (!forzar && ahora - ultimoPintadoPose < REFRESCO_LECTURA_MS) return;
  ultimoPintadoPose = ahora;

  const estadoEl = document.getElementById('pose-estado');
  const puntosEl = document.getElementById('pose-puntos');
  if (!estadoEl || !puntosEl) return;

  let estadoVisual = 'inactivo';
  let texto = mensajePose;

  if (estadoPose === 'cargando') {
    estadoVisual = 'parcial';
  } else if (estadoPose === 'error') {
    estadoVisual = 'error';
  } else if (estadoPose === 'listo') {
    if (!poseBusto) {
      estadoVisual = 'parcial';
      texto = 'Cuerpo: sin detección — entrá en cuadro';
    } else if (!poseBusto.bustoEnCuadro) {
      estadoVisual = 'parcial';
      texto = 'Cuerpo: busto incompleto — centrate y acercate';
    } else {
      estadoVisual = 'listo';
      texto = 'Cuerpo: busto detectado';
    }
  }

  estadoEl.dataset.estado = estadoVisual;
  if (estadoEl.textContent !== texto) estadoEl.textContent = texto;

  if (estadoPose === 'listo' && poseBusto) {
    puntosEl.hidden = false;
    const contenido = formatearPuntos(poseBusto.puntos);
    if (puntosEl.textContent !== contenido) puntosEl.textContent = contenido;
  } else {
    puntosEl.hidden = true;
  }
}

/** Tabla de texto con x, y y confianza por punto. */
function formatearPuntos(puntos) {
  const lineas = [`${'punto'.padEnd(11)} ${'x'.padStart(4)}  ${'y'.padStart(4)}  conf`];

  for (const definir of PUNTOS_BUSTO) {
    const punto = puntos[definir.clave];
    const etiqueta = definir.etiqueta.padEnd(11);

    if (!punto) {
      lineas.push(`${etiqueta}    —`);
      continue;
    }

    lineas.push(
      `${etiqueta} ${punto.x.toFixed(2).padStart(4)}  ${punto.y
        .toFixed(2)
        .padStart(4)}  ${punto.confianza.toFixed(2)}`
    );
  }

  return lineas.join('\n');
}

/** Cambia el estado del reconocimiento y repinta sin esperar al throttle. */
function cambiarEstadoPose(estado, mensaje) {
  estadoPose = estado;
  if (mensaje) mensajePose = mensaje;
  pintarPose(true);
}

/* ---------- Body Pose: API pública para el resto del sketch ---------- */

/**
 * Devuelve la última pose normalizada (0..1) o null.
 * Ver el bloque Body Pose: cada punto es { x, y, confianza, visible }.
 */
function obtenerPoseBusto() {
  return poseBusto;
}

/** Estado del reconocimiento corporal: 'inactivo' | 'cargando' | 'listo' | 'error'. */
function obtenerEstadoPose() {
  return estadoPose;
}

/* ============================================================
   HAND POSE (ml5.js)
   Detección de las dos manos y sus 21 puntos: muñeca, pulgar,
   índice, medio, anular y meñique, con articulaciones y puntas.

   Coordenadas: igual que Body Pose, ml5 multiplica los landmarks
   normalizados por video.width / video.height (ver src_X en el
   bundle), así que llegan en PÍXELES. Se normalizan al entrar.
   ============================================================ */

/* ---------- Hand Pose: configuración ---------- */

const MANOS_MAXIMAS = 2;

/** Confianza mínima por mano (ml5 da confianza por mano, no por punto). */
const CONFIANZA_MANO = 0.35;

/** Suavizado exponencial: 1 = sin suavizado, 0 = congelado. */
const ALFA_MANOS = 0.45;

/** Si una mano no se detecta en un frame, se sigue dibujando este tiempo. */
const GRACIA_MANOS_MS = 250;

/** Aviso si el modelo no termina de cargar. */
const ESPERA_MANOS_MS = 45000;

/* ---------- Gestos: configuración ---------- */

/**
 * Solo estos cuatro dedos deciden el gesto. El pulgar queda afuera a
 * propósito: en un puño real puede quedar afuera de la mano sin que el
 * gesto deje de ser un puño.
 *
 * Índices MediaPipe: mcp = nudillo, pip = articulación media, tip = punta.
 */
const DEDOS_GESTO = [
  { nombre: 'índice', mcp: 5, pip: 6, tip: 8 },
  { nombre: 'medio', mcp: 9, pip: 10, tip: 12 },
  { nombre: 'anular', mcp: 13, pip: 14, tip: 16 },
  { nombre: 'meñique', mcp: 17, pip: 18, tip: 20 },
];

const GESTO_ABIERTA = 'abierta';
const GESTO_CERRADO = 'cerrado';
const GESTO_INDEFINIDO = 'indefinido';

const ETIQUETAS_GESTO = {
  abierta: 'MANO ABIERTA',
  cerrado: 'PUÑO CERRADO',
  indefinido: 'GESTO NO RECONOCIDO',
};

// Histéresis: para ENTRAR en un estado hace falta más que para SALIR.
// Sin esto, una mano temblando en el límite parpadea entre estados.
const UMBRAL_ABIERTA = 0.62; // entra en "abierta"
const UMBRAL_ABIERTA_SALIDA = 0.52; // sigue en "abierta"
const UMBRAL_CERRADO = 0.3; // entra en "cerrado"
const UMBRAL_CERRADO_SALIDA = 0.4; // sigue en "cerrado"

/** Además de la histéresis, el cambio tiene que sostenerse este tiempo. */
const ESTABILIDAD_GESTO_MS = 150;

let handPose = null;
let estadoManos = 'inactivo'; // 'inactivo' | 'cargando' | 'listo' | 'error'
let manosActuales = []; // [{ handedness, confianza, keypoints: [{x,y}], actualizadoEn }]
let conexionesManos = []; // pares de índices que dibuja el esqueleto de la mano
let cargandoHandPose = false;
let temporizadorManos = null;
let ultimoPintadoManos = 0;
let mensajeManos = 'Manos: esperando cámara…';

/* ---------- Hand Pose: inicialización ---------- */

/**
 * Carga el modelo de manos y arranca su bucle de detección.
 * Idempotente. Se llama cuando la cámara ya tiene frames.
 */
async function iniciarHandPose() {
  if (handPose || cargandoHandPose) return;

  if (typeof ml5 === 'undefined' || typeof ml5.handPose !== 'function') {
    cambiarEstadoManos('error', 'Manos: ml5 no cargó.');
    return;
  }

  const video = obtenerVideoCamara();
  if (!video) {
    cambiarEstadoManos('error', 'Manos: la cámara no está lista.');
    return;
  }

  cargandoHandPose = true;
  cambiarEstadoManos('cargando', 'Manos: cargando modelo…');
  console.info('[handPose] Cargando MediaPipeHands…');

  temporizadorManos = window.setTimeout(() => {
    if (estadoManos === 'cargando') {
      cambiarEstadoManos('error', 'Manos: el modelo no terminó de cargar. Revisá la conexión.');
    }
  }, ESPERA_MANOS_MS);

  try {
    // Misma trampa que bodyPose: con p5 2.x ml5 promisifica los constructores
    // y esto devuelve una PROMESA. `await` funciona también con p5 1.x.
    //
    // modelType 'lite': hay dos modelos corriendo a la vez (cuerpo + manos).
    // 'full' da más precisión; si la máquina va sobrada, se puede cambiar.
    const instancia = await ml5.handPose({
      maxHands: MANOS_MAXIMAS,
      modelType: 'lite',
      runtime: 'tfjs',
    });

    if (instancia && instancia.ready && typeof instancia.ready.then === 'function') {
      await instancia.ready;
    }

    if (!instancia || typeof instancia.detectStart !== 'function') {
      throw new Error('ml5 no devolvió un modelo de manos utilizable');
    }

    handPose = instancia;

    // Las conexiones las informa el propio modelo: no se inventan índices.
    conexionesManos =
      typeof handPose.getConnections === 'function' ? handPose.getConnections() : [];

    handPose.detectStart(video, alDetectarManos);

    console.info('[handPose] Modelo listo: MediaPipeHands (lite)');
    cambiarEstadoManos('listo', 'Manos: esperando…');
  } catch (error) {
    manejarErrorManos(error);
  } finally {
    cargandoHandPose = false;
    if (temporizadorManos) {
      window.clearTimeout(temporizadorManos);
      temporizadorManos = null;
    }
  }
}

/** Detiene el bucle de manos y limpia el estado. */
function detenerHandPose() {
  if (handPose && handPose.detecting) handPose.detectStop();
  manosActuales = [];
  cambiarEstadoManos('inactivo', 'Manos: inactivo');
}

function manejarErrorManos(error) {
  console.error('[handPose]', error);
  const detalle = error instanceof Error ? error.message : String(error ?? 'error desconocido');
  cambiarEstadoManos('error', `Manos: error del modelo (${detalle})`);
}

/* ---------- Hand Pose: detección ---------- */

/**
 * Callback de detectStart. Llega un array de manos (0, 1 o 2).
 * Acá se normaliza, se filtra por confianza y se suaviza.
 */
function alDetectarManos(detectadas) {
  const ahora = performance.now();

  const validas = Array.isArray(detectadas)
    ? detectadas.filter((mano) => (mano?.confidence ?? 0) >= CONFIANZA_MANO)
    : [];

  const nuevas = validas.map((mano) => normalizarMano(mano, ahora));
  manosActuales = fusionarManos(nuevas, ahora);

  // El gesto se evalúa sobre los puntos YA suavizados: menos temblor.
  for (const mano of manosActuales) {
    mano.gesto = evaluarGesto(mano, ahora);
  }

  pintarManos();
}

/** Pasa una mano cruda de ml5 a coordenadas 0..1 con forma estable. */
function normalizarMano(mano, ahora) {
  const video = obtenerVideoCamara();

  // ml5 escala los landmarks con los atributos width/height del <video>.
  const ancho = (video && (video.width || video.videoWidth)) || 1;
  const alto = (video && (video.height || video.videoHeight)) || 1;

  const keypoints = (mano.keypoints || []).map((punto) => ({
    x: punto.x / ancho,
    y: punto.y / alto,
  }));

  return {
    handedness: typeof mano.handedness === 'string' ? mano.handedness : 'unknown',
    confianza: typeof mano.confidence === 'number' ? mano.confidence : 0,
    keypoints,
    actualizadoEn: ahora,
  };
}

/**
 * Mezcla las manos nuevas con las que ya veníamos mostrando:
 *  1. suaviza cada mano contra su versión anterior (misma etiqueta),
 *  2. mantiene viva unos ms una mano que no se detectó en este frame.
 * Eso es lo que evita el parpadeo cuando la mano se mueve rápido.
 */
function fusionarManos(nuevas, ahora) {
  const resultado = [];
  const libres = [...manosActuales];

  for (const nueva of nuevas) {
    let indice = libres.findIndex((previa) => previa.handedness === nueva.handedness);
    if (indice < 0 && libres.length > 0) indice = 0;

    const previa = indice >= 0 && libres.length > 0 ? libres.splice(indice, 1)[0] : null;
    resultado.push(previa ? suavizarMano(previa, nueva) : nueva);
  }

  for (const sobrante of libres) {
    if (ahora - sobrante.actualizadoEn < GRACIA_MANOS_MS) resultado.push(sobrante);
  }

  return resultado.slice(0, MANOS_MAXIMAS);
}

/** Interpola los 21 puntos contra la detección anterior. */
function suavizarMano(previa, nueva) {
  if (previa.keypoints.length !== nueva.keypoints.length) return nueva;

  return {
    handedness: nueva.handedness,
    confianza: nueva.confianza,
    actualizadoEn: nueva.actualizadoEn,
    // El estado del gesto viaja con la mano para que la histéresis no se
    // reinicie en cada frame.
    gesto: previa.gesto,
    keypoints: nueva.keypoints.map((punto, indice) => ({
      x: previa.keypoints[indice].x + (punto.x - previa.keypoints[indice].x) * ALFA_MANOS,
      y: previa.keypoints[indice].y + (punto.y - previa.keypoints[indice].y) * ALFA_MANOS,
    })),
  };
}

/* ---------- Gestos: clasificación ---------- */

/**
 * Qué tan abierta está la mano, de 0 (puño) a 1 (todos los dedos extendidos).
 *
 * No usa ángulos absolutos, así que no depende de cómo esté orientada la mano
 * respecto de la cámara. Combina dos señales por dedo, ambas adimensionales:
 *
 *   rectitud: distancia punta→nudillo dividida por el recorrido nudillo→punta.
 *             Un dedo estirado da ~1; uno doblado, mucho menos.
 *   alcance:  distancia punta→muñeca dividida por nudillo→muñeca.
 *             Un dedo extendido duplica esa distancia; uno cerrado la deja igual.
 */
function puntuacionApertura(keypoints) {
  const muneca = keypoints[0];
  if (!muneca) return 0;

  let suma = 0;

  for (const dedo of DEDOS_GESTO) {
    const mcp = keypoints[dedo.mcp];
    const pip = keypoints[dedo.pip];
    const punta = keypoints[dedo.tip];
    if (!mcp || !pip || !punta) continue;

    const rectitud =
      distanciaEntre(punta, mcp) /
      (distanciaEntre(mcp, pip) + distanciaEntre(pip, punta) + 1e-6);

    const alcance = distanciaEntre(punta, muneca) / (distanciaEntre(mcp, muneca) + 1e-6);

    const porRectitud = constrain((rectitud - 0.55) / 0.4, 0, 1);
    const porAlcance = constrain((alcance - 1.05) / 0.85, 0, 1);

    // La rectitud pesa más: es la señal menos sensible a la perspectiva.
    suma += porRectitud * 0.65 + porAlcance * 0.35;
  }

  return suma / DEDOS_GESTO.length;
}

/**
 * Máquina de estados del gesto, por mano.
 * Devuelve { estado, desde, candidato, candidatoDesde, puntuacion }.
 */
function evaluarGesto(mano, ahora) {
  const anterior = mano.gesto || {
    estado: GESTO_INDEFINIDO,
    desde: ahora,
    candidato: GESTO_INDEFINIDO,
    candidatoDesde: ahora,
  };

  const puntuacion = puntuacionApertura(mano.keypoints);
  const objetivo = gestoObjetivo(anterior.estado, puntuacion);

  // Sin cambio pendiente: se mantiene el estado actual.
  if (objetivo === anterior.estado) {
    return {
      estado: anterior.estado,
      desde: anterior.desde,
      candidato: objetivo,
      candidatoDesde: ahora,
      puntuacion,
    };
  }

  // Cambió el objetivo: se arranca (o reinicia) la cuenta de estabilidad.
  if (objetivo !== anterior.candidato) {
    return {
      estado: anterior.estado,
      desde: anterior.desde,
      candidato: objetivo,
      candidatoDesde: ahora,
      puntuacion,
    };
  }

  // El mismo objetivo se sostuvo lo suficiente: se confirma.
  if (ahora - anterior.candidatoDesde >= ESTABILIDAD_GESTO_MS) {
    return {
      estado: objetivo,
      desde: ahora,
      candidato: objetivo,
      candidatoDesde: ahora,
      puntuacion,
    };
  }

  return {
    estado: anterior.estado,
    desde: anterior.desde,
    candidato: objetivo,
    candidatoDesde: anterior.candidatoDesde,
    puntuacion,
  };
}

/** Aplica la histéresis: qué estado corresponde según el estado actual. */
function gestoObjetivo(estadoActual, puntuacion) {
  if (estadoActual === GESTO_ABIERTA) {
    if (puntuacion >= UMBRAL_ABIERTA_SALIDA) return GESTO_ABIERTA;
    if (puntuacion <= UMBRAL_CERRADO) return GESTO_CERRADO;
    return GESTO_INDEFINIDO;
  }

  if (estadoActual === GESTO_CERRADO) {
    if (puntuacion <= UMBRAL_CERRADO_SALIDA) return GESTO_CERRADO;
    if (puntuacion >= UMBRAL_ABIERTA) return GESTO_ABIERTA;
    return GESTO_INDEFINIDO;
  }

  if (puntuacion >= UMBRAL_ABIERTA) return GESTO_ABIERTA;
  if (puntuacion <= UMBRAL_CERRADO) return GESTO_CERRADO;
  return GESTO_INDEFINIDO;
}

/** Distancia euclidiana entre dos puntos normalizados. */
function distanciaEntre(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/* ---------- Hand Pose: lectura en pantalla ---------- */

/** Actualiza el contador de manos detectadas. Throttled como el resto. */
function pintarManos(forzar = false) {
  const ahora = performance.now();
  if (!forzar && ahora - ultimoPintadoManos < REFRESCO_LECTURA_MS) return;
  ultimoPintadoManos = ahora;

  const elemento = document.getElementById('manos-estado');
  if (!elemento) return;

  let estadoVisual = 'inactivo';
  let texto = mensajeManos;

  if (estadoManos === 'cargando') {
    estadoVisual = 'parcial';
  } else if (estadoManos === 'error') {
    estadoVisual = 'error';
  } else if (estadoManos === 'listo') {
    const cantidad = manosActuales.length;
    if (cantidad === 0) {
      estadoVisual = 'parcial';
      texto = 'Manos: ninguna detectada';
    } else {
      estadoVisual = 'listo';
      texto = `Manos: ${cantidad} ${cantidad === 1 ? 'detectada' : 'detectadas'}`;
    }
  }

  elemento.dataset.estado = estadoVisual;
  if (elemento.textContent !== texto) elemento.textContent = texto;

  pintarGestos();
}

/** Una línea por mano con el gesto reconocido. */
function pintarGestos() {
  const lista = document.getElementById('gestos-estado');
  if (!lista) return;

  if (estadoManos !== 'listo' || manosActuales.length === 0) {
    lista.hidden = true;
    lista.replaceChildren();
    return;
  }

  lista.hidden = false;

  // Se reutilizan los <li> para no crear nodos en cada actualización.
  while (lista.children.length < manosActuales.length) {
    lista.appendChild(document.createElement('li'));
  }
  while (lista.children.length > manosActuales.length) {
    lista.lastElementChild.remove();
  }

  manosActuales.forEach((mano, indice) => {
    const estado = mano.gesto ? mano.gesto.estado : GESTO_INDEFINIDO;
    const puntuacion = mano.gesto ? mano.gesto.puntuacion : 0;
    const lado =
      mano.handedness === 'Left' ? 'Izquierda' : mano.handedness === 'Right' ? 'Derecha' : 'Mano';

    const item = lista.children[indice];
    item.dataset.estado = estado;

    // La puntuación se muestra para poder calibrar los umbrales a mano.
    const texto = `${lado}: ${ETIQUETAS_GESTO[estado]} · ${puntuacion.toFixed(2)}`;
    if (item.textContent !== texto) item.textContent = texto;
  });
}

function cambiarEstadoManos(estado, mensaje) {
  estadoManos = estado;
  if (mensaje) mensajeManos = mensaje;
  pintarManos(true);
}

/* ---------- Hand Pose: API pública ---------- */

/**
 * Manos detectadas, ya normalizadas y suavizadas.
 *
 *   const manos = obtenerManos();      // 0, 1 o 2
 *   manos[0].handedness                 // 'Left' | 'Right' (según la cámara)
 *   manos[0].keypoints[8]               // punta del índice, { x, y } en 0..1
 *
 * Los índices siguen el orden de MediaPipe: 0 muñeca, 1-4 pulgar,
 * 5-8 índice, 9-12 medio, 13-16 anular, 17-20 meñique.
 * Para dibujar sobre la imagen espejada: mapearPuntoCamara(x, y).
 */
function obtenerManos() {
  return manosActuales;
}

/** Estado del modelo de manos: 'inactivo' | 'cargando' | 'listo' | 'error'. */
function obtenerEstadoManos() {
  return estadoManos;
}

/** Pares de índices que forman el esqueleto de la mano (los da ml5). */
function obtenerConexionesManos() {
  return conexionesManos;
}
