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

   Nota de rendimiento: la escena NO se redibuja completa por frame. El fondo
   (cielo, suelo, piedras y ramas caídas) se hornea una sola vez en un
   p5.Graphics y se dibuja con image(). Solo se anima la capa con pocos
   trazos: árboles cacheados como sprites, pasto, polvo y rachas.
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

  // Escenario vivo: draw() corre a 60 fps y el viento avanza cada frame.
  // El fondo se hornea una sola vez acá y solo se reconstruye al redimensionar.
  construirEscenario();

  // La imagen del personaje llega después (loadImage es async en p5 2.x).
  cargarPersonaje();

  // La cámara se pide al final: si falla, el escenario ya está funcionando.
  iniciarCamara();
}

/** Un frame de la escena: actualiza el viento y dibuja el paisaje vivo. */
function draw() {
  // Un resize durante el arrastre dispara muchos eventos: se reconstruye una
  // sola vez, en el frame siguiente, y no una vez por evento.
  if (escenaDesactualizada) construirEscenario();
  if (!fondoEstatico) return;

  // Acotado: al volver de una pestaña en segundo plano deltaTime puede valer
  // segundos y el viento daría un salto.
  const dt = Math.min(deltaTime / 1000, 0.05);
  relojEscena += dt;

  actualizarViento(dt);
  actualizarVida(dt);
  actualizarPersonaje(dt);
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

/* ============================================================
   ESCENARIO
   Paisaje deteriorado en tres planos de profundidad. El gris no es
   uniforme: cada plano es más oscuro y más nítido cuanto más cerca
   está, así el ojo construye distancia sin necesidad de perspectiva.
   ============================================================ */

/** Semilla fija: la composición es idéntica en cada reconstrucción. */
const SEMILLA = 20261105;

/** Paleta desaturada: frío arriba, tierra muerta abajo. */
const PALETA = {
  cieloAlto: [36, 40, 46],
  cieloBajo: [150, 154, 158],
  bruma: [162, 167, 172],
  polvo: [212, 216, 220],

  sueloLejos: [94, 96, 97],
  sueloMedio: [62, 63, 63],
  sueloCerca: [37, 37, 36],

  arbolLejos: [110, 116, 122],
  arbolMedio: [70, 74, 78],
  arbolCerca: [26, 27, 29],

  piedraLejos: [88, 89, 88],
  piedraMedia: [70, 71, 70],
  piedraCerca: [51, 51, 50],

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
 * Fábricas lejanas: dos siluetas sobre la capa más lejana y su humo.
 * Las chimeneas son parte del fondo congelado (no se mueven); el humo es capa
 * viva y lo arrastra el mismo viento que todo lo demás. Todas las medidas son
 * fracciones del alto del lienzo para que la escala no dependa del tamaño.
 */
const FABRICA = {
  fuentes: [
    { fx: 0.605, cuerpo: 0.024, ancho: 0.032, chimenea: 0.052 },
    { fx: 0.648, cuerpo: 0.017, ancho: 0.022, chimenea: 0.033 },
  ],
  color: [124, 128, 132], // apenas más claro que el suelo: se hunde en la bruma
  humoColor: [184, 188, 192],
  humoAlfa: 18, // leve a propósito: se tiene que adivinar, no tapar el paisaje
  humoPuffs: 11,
  humoVidaMinima: 6,
  humoVidaMaxima: 9,
  humoSubida: 0.17, // cuánto sube el penacho, en fracciones del alto
  humoDeriva: 0.12, // cuánto se abre a favor del viento
  humoDiametroInicial: 0.012,
  humoDiametroFinal: 0.055,
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

let fondoEstatico = null; // p5.Graphics con cielo, suelo, piedras y ramas
let horizonteEscena = 0;
let arbolesViento = []; // [{ grafico, x, y, ancho, baseY, balanceo, fase }]
let matujosViento = []; // [{ x, y, alto, briznas }]
let polvoAire = []; // partículas en suspensión
let rachasViento = []; // líneas de aire
let fabricasViento = []; // geometría de las chimeneas lejanas
let humoViento = []; // [{ fuente, puffs }] una columna por chimenea

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
let vidaPaisaje = 0; // 0..1, ya suavizada: cuánta vida tiene el bosque ahora
let segundosSinManos = 0; // ausencia sostenida, para la gracia del tracking

/* ---------- Escenario: construcción ---------- */

/**
 * Hornea el fondo y prepara la capa viva. Se llama en setup() y cada vez que
 * el canvas cambia de tamaño: buffers y sprites están dimensionados en píxeles,
 * así que un resize los invalida.
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

  // Las fábricas van primero: el fondo las dibuja y el humo necesita saber
  // dónde está la boca de cada chimenea.
  fabricasViento = crearFabricas();

  fondoEstatico = crearFondoEstatico();
  arbolesViento = crearArbolesViento();
  matujosViento = crearMatujos();
  polvoAire = crearPolvo();
  rachasViento = crearRachas();
  humoViento = crearHumo();

  // Al final: necesita los árboles ya creados para elegir a cuál mirar.
  reiniciarPersonaje();
}

/** Suelta los buffers anteriores: sin esto cada resize deja canvas vivos. */
function liberarEscenario() {
  if (fondoEstatico) {
    fondoEstatico.remove();
    fondoEstatico = null;
  }

  for (const arbol of arbolesViento) arbol.grafico.remove();
  arbolesViento = [];
}

/** Cielo, suelo, piedras y ramas caídas: lo que no se mueve nunca. */
function crearFondoEstatico() {
  const g = createGraphics(width, height);
  g.pixelDensity(1);

  g.background(PALETA.cieloBajo[0], PALETA.cieloBajo[1], PALETA.cieloBajo[2]);

  dibujarAtmosfera(g, horizonteEscena);
  dibujarSuelo(g, horizonteEscena);
  dibujarFabricas(g);
  dibujarElementos(g, horizonteEscena);

  return g;
}

/* ---------- Escenario: dibujo por frame ---------- */

/** Punto de entrada de la capa viva. Orden = de atrás hacia adelante. */
function dibujarEscenario(t, dt) {
  if (!fondoEstatico) return;

  image(fondoEstatico, 0, 0);
  // El humo y las rachas van detrás de los árboles: son aire de cielo, no polvo
  // encima de una copa.
  dibujarHumo(t, dt);
  dibujarRachas(t, dt);
  // Los árboles se dibujan por planos para poder intercalar al personaje en el
  // medio: camina detrás de los árboles cercanos y delante de los lejanos.
  dibujarArbolesViento(t, 0);
  dibujarArbolesViento(t, 1);
  dibujarPersonaje();
  dibujarArbolesViento(t, 2);
  actualizarDibujarPolvo(t, dt);
  dibujarMatujosViento(t);
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

/* ---------- Atmósfera ---------- */

/**
 * Cielo con gradiente y banda de bruma sobre el horizonte. La bruma es lo que
 * apaga el fondo y produce la sensación de distancia. El polvo que había acá
 * ahora es dinámico (ver capa viva): quieto no aportaba el aire que se mueve.
 */
function dibujarAtmosfera(g, horizonte) {
  const finCielo = horizonte + height * 0.04;

  // Gradiente vertical: oscuro arriba, claro al ras del suelo.
  g.strokeWeight(1);
  g.noFill();
  for (let y = 0; y < finCielo; y += 1) {
    const t = suavizar(y / finCielo);
    g.stroke(lerpColor(color(...PALETA.cieloAlto), color(...PALETA.cieloBajo), t));
    g.line(0, y, width, y);
  }

  // Banda de bruma: se acumula justo sobre el horizonte.
  g.noStroke();
  const altoBruma = height * 0.16;
  const pasos = 30;
  for (let i = 0; i < pasos; i += 1) {
    const t = i / (pasos - 1);
    g.fill(PALETA.bruma[0], PALETA.bruma[1], PALETA.bruma[2], 30 * t);
    g.rect(0, horizonte - altoBruma + t * altoBruma, width, altoBruma / pasos + 1);
  }
}

/* ---------- Suelo ---------- */

/**
 * Parámetros de las tres franjas de terreno. Viven acá porque el suelo y la
 * ubicación de árboles y piedras tienen que usar EL MISMO relieve: si no,
 * los elementos flotan sobre la cresta o quedan enterrados.
 */
const CAPAS_SUELO = [
  { base: 0.02, amplitud: 0.035, tono: 'sueloLejos', escala: 0.006, fase: 0 },
  { base: 0.13, amplitud: 0.05, tono: 'sueloMedio', escala: 0.009, fase: 40 },
  { base: 0.27, amplitud: 0.06, tono: 'sueloCerca', escala: 0.012, fase: 90 },
];

/**
 * Altura del borde superior de una capa en una x dada. Como noise() es
 * determinista, dibujar y plantar consultan exactamente la misma curva.
 */
function bordeDeSuelo(x, capa, horizonte) {
  const baseY = horizonte + height * capa.base;
  return baseY + (noise(x * capa.escala + capa.fase, capa.fase) - 0.5) * height * capa.amplitud;
}

/**
 * Tres capas de terreno. Cada una se dibuja completa hasta el borde inferior,
 * así la siguiente tapa a la anterior: eso crea el escalonado de profundidad.
 */
function dibujarSuelo(g, horizonte) {
  for (const capa of CAPAS_SUELO) {
    dibujarCapaDeSuelo(g, capa, horizonte);
  }
}

/**
 * Una franja de terreno con borde superior irregular (noise) y estratos
 * internos que siguen el mismo relieve, como capas de tierra seca.
 */
function dibujarCapaDeSuelo(g, capa, horizonte) {
  const tono = PALETA[capa.tono];
  const amplitud = height * capa.amplitud;

  g.noStroke();
  g.fill(tono[0], tono[1], tono[2]);

  g.beginShape();
  g.vertex(0, height);
  for (let x = 0; x <= width; x += 5) {
    g.vertex(x, bordeDeSuelo(x, capa, horizonte));
  }
  g.vertex(width, height);
  g.endShape(CLOSE);

  // Estratos: líneas suaves paralelas al borde, apenas más oscuras.
  g.noFill();
  for (let i = 1; i <= 3; i += 1) {
    g.stroke(tono[0] - 9, tono[1] - 9, tono[2] - 9, 95);
    g.strokeWeight(1);
    g.beginShape();
    for (let x = 0; x <= width; x += 8) {
      g.vertex(x, bordeDeSuelo(x, capa, horizonte) + amplitud * 0.85 * i);
    }
    g.endShape();
  }
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
    image(arbol.grafico, -arbol.ancho * 0.5, -arbol.baseY);
    // Las hojas van después del sprite: nacen sobre las puntas y las ramas
    // finas se leen por detrás del follaje, como en un árbol real.
    dibujarFollaje(arbol, vida);
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
function dibujarFollaje(arbol, vida) {
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
  lienzo.globalAlpha = 1;
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

/** Acceso de solo lectura para comprobar el follaje desde la consola. */
window.escenarioDebug = {
  vida: () => vidaDelPaisaje(),
  hojasPorArbol: () => arbolesViento.map((arbol) => arbol.hojas.length),
  hojasTotales: () => arbolesViento.reduce((total, arbol) => total + arbol.hojas.length, 0),
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

/* ---------- Elementos decorativos ---------- */

/** Piedras y ramas caídas. Más grandes cuanto más cerca. */
function dibujarElementos(g, horizonte) {
  // Piedras lejanas: apoyadas sobre la primera capa.
  for (let i = 0; i < 7; i += 1) {
    const x = random(width);
    const y = bordeDeSuelo(x, CAPAS_SUELO[0], horizonte) + height * random(0.01, 0.05);
    dibujarPiedra(g, x, y, random(3, 6), PALETA.piedraLejos);
  }

  // Piedras del plano medio
  for (let i = 0; i < 6; i += 1) {
    const x = random(width);
    const y = bordeDeSuelo(x, CAPAS_SUELO[1], horizonte) + height * random(0.02, 0.09);
    dibujarPiedra(g, x, y, random(6, 11), PALETA.piedraMedia);
  }

  // Piedras cercanas: las que dan escala al primer plano
  for (let i = 0; i < 5; i += 1) {
    const x = random(width);
    const y = bordeDeSuelo(x, CAPAS_SUELO[2], horizonte) + height * random(0.03, 0.13);
    dibujarPiedra(g, x, y, random(13, 22), PALETA.piedraCerca);
  }

  // Ramas caídas en el primer plano
  for (let i = 0; i < 3; i += 1) {
    const x = random(width);
    const y = bordeDeSuelo(x, CAPAS_SUELO[2], horizonte) + height * random(0.04, 0.14);
    dibujarRama(g, x, y, height * random(0.03, 0.06), random(-0.5, 0.5), 2, 2, PALETA.arbolCerca, i * 23.1);
  }

  // El pasto seco ya no vive acá: es capa viva, ver dibujarMatujosViento().
}

/** Piedra irregular y achatada, con una luz tenue arriba que le da volumen. */
function dibujarPiedra(g, x, y, tam, tono) {
  const lados = 7;

  g.noStroke();
  g.fill(tono[0], tono[1], tono[2]);
  g.beginShape();
  for (let i = 0; i < lados; i += 1) {
    const angulo = (TWO_PI / lados) * i;
    const radio = tam * (0.7 + noise(x * 0.05 + i, y * 0.05) * 0.55);
    // Más ancha que alta: ninguna piedra natural es una esfera perfecta.
    g.vertex(x + Math.cos(angulo) * radio * 1.25, y + Math.sin(angulo) * radio * 0.6);
  }
  g.endShape(CLOSE);

  g.noFill();
  g.stroke(tono[0] + 26, tono[1] + 26, tono[2] + 26, 120);
  g.strokeWeight(max(0.8, tam * 0.07));
  g.arc(x, y - tam * 0.05, tam * 1.9, tam * 0.85, PI + 0.4, TWO_PI - 0.4);
}

/* ---------- Fábricas ---------- */

/**
 * Geometría de las chimeneas lejanas. Se calcula una sola vez porque el fondo
 * las dibuja y el humo necesita la boca exacta de cada una para nacer de ahí.
 * Usa la primera capa de suelo, la misma de los árboles lejanos: así la base
 * se apoya en el relieve y no flota.
 */
function crearFabricas() {
  const lista = [];

  for (const fuente of FABRICA.fuentes) {
    const x = width * fuente.fx;
    const yBase = bordeDeSuelo(x, CAPAS_SUELO[0], horizonteEscena) + height * 0.004;
    const anchoCuerpo = height * fuente.ancho;
    const altoCuerpo = height * fuente.cuerpo;
    const altoChimenea = height * fuente.chimenea;

    lista.push({
      x,
      yBase,
      anchoCuerpo,
      altoCuerpo,
      altoChimenea,
      anchoChimenea: max(2, anchoCuerpo * 0.22),
      // La chimenea no sale del centro: una fábrica real tiene el horno a un
      // lado, y ese desfasaje es lo que la hace leer como fábrica y no como
      // un rectángulo con un palo.
      xChimenea: x + anchoCuerpo * 0.2,
      yTope: yBase - altoCuerpo - altoChimenea,
    });
  }

  return lista;
}

/**
 * Siluetas planas, sin ventanas ni detalles: a esta distancia, con esta paleta
 * y detrás de la bruma, solo se lee el contorno. El color es más claro que el
 * suelo para que el ojo las mande al fondo.
 */
function dibujarFabricas(g) {
  g.noStroke();
  g.fill(FABRICA.color[0], FABRICA.color[1], FABRICA.color[2]);

  for (const fuente of fabricasViento) {
    // Galpón: bajo y ancho.
    g.rect(
      fuente.x - fuente.anchoCuerpo * 0.5,
      fuente.yBase - fuente.altoCuerpo,
      fuente.anchoCuerpo,
      fuente.altoCuerpo
    );

    // Chimenea: más alta que el galpón, que es lo que la delata como fábrica.
    g.rect(
      fuente.xChimenea - fuente.anchoChimenea * 0.5,
      fuente.yTope,
      fuente.anchoChimenea,
      fuente.altoChimenea + fuente.altoCuerpo
    );
  }
}

/* ============================================================
   CAPA VIVA
   Pasto, polvo y rachas. Son pocos trazos por frame, así que se
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

/* ---------- Humo de fábrica ---------- */

/**
 * Una columna de bocanadas por chimenea. El progreso de cada una arranca
 * escalonado para que el penacho ya exista en el primer frame: si todas
 * nacieran en el mismo instante, la primera vez se vería salir un anillo.
 */
function crearHumo() {
  const lista = [];

  for (const fuente of fabricasViento) {
    const puffs = [];

    for (let i = 0; i < FABRICA.humoPuffs; i += 1) {
      puffs.push({
        progreso: i / FABRICA.humoPuffs,
        vida: random(FABRICA.humoVidaMinima, FABRICA.humoVidaMaxima),
        escala: random(0.7, 1.15),
        desvio: random(-0.35, 0.35),
        fase: random(TWO_PI),
      });
    }

    lista.push({ fuente, puffs });
  }

  return lista;
}

/**
 * Humo leve que sube de las chimeneas y se abre a favor del viento.
 * Cada bocanada es un círculo que crece y se desvanece mientras sube: es la
 * forma más barata de leer humo, y con alfa bajo no tapa el paisaje.
 */
function dibujarHumo(t, dt) {
  const tono = FABRICA.humoColor;
  const subida = height * FABRICA.humoSubida;
  const deriva = width * FABRICA.humoDeriva * (0.45 + fuerzaViento * 0.55) * direccionViento;

  noStroke();

  for (const columna of humoViento) {
    for (const puff of columna.puffs) {
      puff.progreso += dt / puff.vida;
      if (puff.progreso >= 1) puff.progreso -= 1;

      const p = puff.progreso;

      // Arranca en la boca de la chimenea y se abre en curva: exponente > 1 en
      // la deriva para que el penacho salga vertical y no torcido.
      const x =
        columna.fuente.xChimenea +
        Math.pow(p, 1.8) * deriva +
        puff.desvio * height * 0.02 * p +
        Math.sin(t * 0.9 + puff.fase) * height * 0.008 * p;
      const y = columna.fuente.yTope - Math.pow(p, 0.85) * subida;
      const diametro =
        lerp(
          height * FABRICA.humoDiametroInicial,
          height * FABRICA.humoDiametroFinal,
          Math.pow(p, 0.7)
        ) * puff.escala;

      // Fade-in corto y fade-out largo: nace denso y se desarma arriba.
      const alfa = FABRICA.humoAlfa * (1 - p) * Math.min(1, p * 5);
      if (alfa < 0.6) continue;

      fill(tono[0], tono[1], tono[2], alfa);
      circle(x, y, diametro);
    }
  }
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
