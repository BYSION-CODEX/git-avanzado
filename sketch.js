/* ============================================================
   El cambio florece contigo — sketch de p5.js
   Modo global: p5.js llama a setup() y draw() por su cuenta.

   Estado actual:
   - Escenario estático: paisaje gris deteriorado, sin flores ni crecimiento.
   - Captura de video de la cámara montada en #camara-contenedor.
   - SIN reconocimiento corporal y SIN ml5.js todavía.

   Nota de rendimiento: la escena se redibuja completa una sola vez porque
   hay noLoop(). Cuando llegue la animación, el paisaje debe renderizarse a un
   p5.Graphics una vez y dibujarse con image(); hacerlo por frame con esta
   cantidad de trazos cuesta caro.
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

  // Escenario estático: se dibuja una vez y se repinta al redimensionar.
  // Quitar noLoop() cuando empiece la animación del jardín.
  noLoop();

  // La cámara se pide al final: si falla, el escenario ya está funcionando.
  iniciarCamara();
}

/** Dibuja el escenario completo. Estático: no hay estado que actualizar. */
function draw() {
  dibujarEscenario();
}

/**
 * Mantiene el canvas del tamaño de su contenedor cuando cambia la ventana.
 * Con noLoop() activo hace falta redraw() para repintar el nuevo tamaño.
 */
function windowResized() {
  const contenedor = document.getElementById('lienzo-contenedor');
  if (!contenedor || typeof width === 'undefined') return;

  resizeCanvas(contenedor.clientWidth, contenedor.clientHeight);
  redraw();
}

/* ============================================================
   ESCENARIO
   Paisaje deteriorado en tres planos de profundidad. El gris no es
   uniforme: cada plano es más oscuro y más nítido cuanto más cerca
   está, así el ojo construye distancia sin necesidad de perspectiva.
   ============================================================ */

/** Semilla fija: la composición es idéntica en cada repintado. */
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
};

/** Punto de entrada del escenario. Orden = profundidad, de atrás hacia adelante. */
function dibujarEscenario() {
  // Semillas: random() y noise() devuelven siempre lo mismo. Sin esto, cada
  // redibujado (o cada resize) generaría un paisaje distinto.
  randomSeed(SEMILLA);
  noiseSeed(SEMILLA);

  const horizonte = height * 0.54;

  background(PALETA.cieloBajo[0], PALETA.cieloBajo[1], PALETA.cieloBajo[2]);

  dibujarAtmosfera(horizonte);
  dibujarSuelo(horizonte);
  dibujarArboles(horizonte);
  dibujarElementos(horizonte);
}

/** Curva suave para degradados (smoothstep). */
function suavizar(t) {
  const acotado = Math.min(1, Math.max(0, t));
  return acotado * acotado * (3 - 2 * acotado);
}

/* ---------- Atmósfera ---------- */

/**
 * Cielo con gradiente, banda de bruma sobre el horizonte y polvo en
 * suspensión. La bruma es lo que apaga el fondo y produce la sensación
 * de aire quieto y ausencia de vida.
 */
function dibujarAtmosfera(horizonte) {
  const finCielo = horizonte + height * 0.04;

  // Gradiente vertical: oscuro arriba, claro al ras del suelo.
  strokeWeight(1);
  noFill();
  for (let y = 0; y < finCielo; y += 1) {
    const t = suavizar(y / finCielo);
    stroke(lerpColor(color(...PALETA.cieloAlto), color(...PALETA.cieloBajo), t));
    line(0, y, width, y);
  }

  // Banda de bruma: se acumula justo sobre el horizonte.
  noStroke();
  const altoBruma = height * 0.16;
  const pasos = 30;
  for (let i = 0; i < pasos; i += 1) {
    const t = i / (pasos - 1);
    fill(PALETA.bruma[0], PALETA.bruma[1], PALETA.bruma[2], 30 * t);
    rect(0, horizonte - altoBruma + t * altoBruma, width, altoBruma / pasos + 1);
  }

  // Polvo fino: puntos casi imperceptibles que dan textura al aire.
  for (let i = 0; i < 120; i += 1) {
    const x = random(width);
    const y = random(horizonte + height * 0.03);
    fill(PALETA.polvo[0], PALETA.polvo[1], PALETA.polvo[2], random(5, 18));
    circle(x, y, random(1, 2.2));
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
function dibujarSuelo(horizonte) {
  for (const capa of CAPAS_SUELO) {
    dibujarCapaDeSuelo(capa, horizonte);
  }
}

/**
 * Una franja de terreno con borde superior irregular (noise) y estratos
 * internos que siguen el mismo relieve, como capas de tierra seca.
 */
function dibujarCapaDeSuelo(capa, horizonte) {
  const tono = PALETA[capa.tono];
  const amplitud = height * capa.amplitud;

  noStroke();
  fill(tono[0], tono[1], tono[2]);

  beginShape();
  vertex(0, height);
  for (let x = 0; x <= width; x += 5) {
    vertex(x, bordeDeSuelo(x, capa, horizonte));
  }
  vertex(width, height);
  endShape(CLOSE);

  // Estratos: líneas suaves paralelas al borde, apenas más oscuras.
  noFill();
  for (let i = 1; i <= 3; i += 1) {
    stroke(tono[0] - 9, tono[1] - 9, tono[2] - 9, 95);
    strokeWeight(1);
    beginShape();
    for (let x = 0; x <= width; x += 8) {
      vertex(x, bordeDeSuelo(x, capa, horizonte) + amplitud * 0.85 * i);
    }
    endShape();
  }
}

/* ---------- Árboles ---------- */

/**
 * Árboles secos repartidos en los tres planos.
 * Los lejanos son chicos y claros (la bruma los come); los cercanos son
 * grandes, oscuros y con más ramificación.
 */
function dibujarArboles(horizonte) {
  // Plano lejano
  const posicionesLejanas = [0.06, 0.18, 0.33, 0.5, 0.67, 0.86];
  for (const fx of posicionesLejanas) {
    const x = width * (fx + random(-0.015, 0.015));
    // Base sobre el borde real de la capa, hundida unos píxeles: la raíz
    // tiene que apoyarse en la tierra, no quedar en el aire.
    const y = bordeDeSuelo(x, CAPAS_SUELO[0], horizonte) + height * 0.004;
    const alto = height * random(0.09, 0.14);
    dibujarArbol(x, y, alto, 1.6, PALETA.arbolLejos, 3, random(-0.14, 0.14));
  }

  // Plano medio
  const posicionesMedias = [0.22, 0.44, 0.6, 0.82];
  for (const fx of posicionesMedias) {
    const x = width * (fx + random(-0.02, 0.02));
    const y = bordeDeSuelo(x, CAPAS_SUELO[1], horizonte) + height * 0.005;
    const alto = height * random(0.16, 0.23);
    dibujarArbol(x, y, alto, 3.2, PALETA.arbolMedio, 4, random(-0.16, 0.16));
  }

  // Plano cercano: el del borde derecho queda cortado por el encuadre.
  const posicionesCercanas = [
    { fx: 0.09, alto: 0.42, grosor: 6.5 },
    { fx: 0.71, alto: 0.34, grosor: 5.5 },
    { fx: 0.95, alto: 0.46, grosor: 8 },
  ];

  for (const arbol of posicionesCercanas) {
    const x = width * arbol.fx;
    const y = bordeDeSuelo(x, CAPAS_SUELO[2], horizonte) + height * 0.008;
    const alto = height * arbol.alto * random(0.94, 1.06);
    dibujarArbol(x, y, alto, arbol.grosor, PALETA.arbolCerca, 5, random(-0.18, 0.06));
  }
}

/**
 * Un árbol sin hojas: base ensanchada, tronco levemente curvado y ramas
 * que se abren desde la copa. Todo con trazos redondeados, sin relleno
 * fotográfico, para que quede ilustrado y orgánico.
 */
function dibujarArbol(x, yBase, alto, grosor, tono, niveles, inclinacion) {
  const angulo = -HALF_PI + inclinacion;
  const altoTronco = alto * 0.45;
  const xCopa = x + Math.cos(angulo) * altoTronco;
  const yCopa = yBase + Math.sin(angulo) * altoTronco;

  // Base: la raíz agarra la tierra, por eso es más ancha que el tronco.
  noStroke();
  fill(tono[0], tono[1], tono[2]);
  ellipse(x, yBase, grosor * 2.1, grosor * 0.8);

  // Tronco en dos tramos con una curva suave: nada de líneas perfectas.
  stroke(tono[0], tono[1], tono[2]);
  strokeCap(ROUND);
  const xMedio = lerp(x, xCopa, 0.5) + Math.cos(angulo + HALF_PI) * alto * 0.035;
  const yMedio = lerp(yBase, yCopa, 0.55);

  strokeWeight(grosor);
  line(x, yBase, xMedio, yMedio);
  strokeWeight(grosor * 0.82);
  line(xMedio, yMedio, xCopa, yCopa);

  // Ramas principales desde la copa.
  dibujarRama(xCopa, yCopa, altoTronco * 0.85, angulo - 0.3, grosor * 0.68, niveles, tono);
  dibujarRama(xCopa, yCopa, altoTronco * 0.78, angulo + 0.26, grosor * 0.62, niveles, tono);
  dibujarRama(xMedio, yMedio, altoTronco * 0.55, angulo - 0.75, grosor * 0.45, niveles - 1, tono);
}

/**
 * Rama recursiva. Se abre en dos o tres direcciones con ángulos tomados de
 * noise() —no de random()— para que el árbol sea siempre el mismo.
 */
function dibujarRama(x, y, largo, angulo, grosor, nivel, tono) {
  if (nivel <= 0 || grosor < 0.6 || largo < 2) return;

  const x2 = x + Math.cos(angulo) * largo;
  const y2 = y + Math.sin(angulo) * largo;

  stroke(tono[0], tono[1], tono[2]);
  strokeWeight(grosor);
  line(x, y, x2, y2);

  const apertura = 0.3 + noise(x * 0.015, y * 0.015) * 0.35;
  const acortar = 0.64 + noise(y * 0.02, x * 0.02) * 0.14;

  dibujarRama(x2, y2, largo * acortar, angulo - apertura, grosor * 0.62, nivel - 1, tono);
  dibujarRama(x2, y2, largo * acortar * 0.92, angulo + apertura * 0.8, grosor * 0.58, nivel - 1, tono);

  // Tercera rama ocasional: rompe la simetría del árbol.
  if (nivel > 2 && noise(x * 0.03, y * 0.03) > 0.42) {
    dibujarRama(x2, y2, largo * acortar * 0.7, angulo + apertura * 0.1, grosor * 0.42, nivel - 1, tono);
  }
}

/* ---------- Elementos decorativos ---------- */

/** Piedras, matojos secos y ramas caídas. Más grandes cuanto más cerca. */
function dibujarElementos(horizonte) {
  // Piedras lejanas: apoyadas sobre la primera capa.
  for (let i = 0; i < 7; i += 1) {
    const x = random(width);
    const y = bordeDeSuelo(x, CAPAS_SUELO[0], horizonte) + height * random(0.01, 0.05);
    dibujarPiedra(x, y, random(3, 6), PALETA.piedraLejos);
  }

  // Piedras del plano medio
  for (let i = 0; i < 6; i += 1) {
    const x = random(width);
    const y = bordeDeSuelo(x, CAPAS_SUELO[1], horizonte) + height * random(0.02, 0.09);
    dibujarPiedra(x, y, random(6, 11), PALETA.piedraMedia);
  }

  // Piedras cercanas: las que dan escala al primer plano
  for (let i = 0; i < 5; i += 1) {
    const x = random(width);
    const y = bordeDeSuelo(x, CAPAS_SUELO[2], horizonte) + height * random(0.03, 0.13);
    dibujarPiedra(x, y, random(13, 22), PALETA.piedraCerca);
  }

  // Matojos secos: briznas que se doblan, nunca verticales del todo
  for (let i = 0; i < 9; i += 1) {
    const x = random(width);
    const y = bordeDeSuelo(x, CAPAS_SUELO[2], horizonte) + height * random(0.01, 0.16);
    dibujarMatujo(x, y, height * random(0.022, 0.05), PALETA.pastoSeco);
  }

  // Ramas caídas en el primer plano
  for (let i = 0; i < 3; i += 1) {
    const x = random(width);
    const y = bordeDeSuelo(x, CAPAS_SUELO[2], horizonte) + height * random(0.04, 0.14);
    dibujarRama(x, y, height * random(0.03, 0.06), random(-0.5, 0.5), 2, 2, PALETA.arbolCerca);
  }
}

/** Piedra irregular y achatada, con una luz tenue arriba que le da volumen. */
function dibujarPiedra(x, y, tam, tono) {
  const lados = 7;

  noStroke();
  fill(tono[0], tono[1], tono[2]);
  beginShape();
  for (let i = 0; i < lados; i += 1) {
    const angulo = (TWO_PI / lados) * i;
    const radio = tam * (0.7 + noise(x * 0.05 + i, y * 0.05) * 0.55);
    // Más ancha que alta: ninguna piedra natural es una esfera perfecta.
    vertex(x + Math.cos(angulo) * radio * 1.25, y + Math.sin(angulo) * radio * 0.6);
  }
  endShape(CLOSE);

  noFill();
  stroke(tono[0] + 26, tono[1] + 26, tono[2] + 26, 120);
  strokeWeight(max(0.8, tam * 0.07));
  arc(x, y - tam * 0.05, tam * 1.9, tam * 0.85, PI + 0.4, TWO_PI - 0.4);
}

/** Matujo de pasto seco: varias briznas curvas que nacen del mismo punto. */
function dibujarMatujo(x, y, alto, tono) {
  const briznas = 5 + Math.floor(random(3));

  stroke(tono[0], tono[1], tono[2], 190);
  strokeWeight(1.2);
  noFill();

  for (let i = 0; i < briznas; i += 1) {
    const inclinacion = random(-0.55, 0.55);
    const alturaBrizna = alto * random(0.6, 1);
    const xFin = x + Math.sin(inclinacion) * alturaBrizna;
    const yFin = y - Math.cos(inclinacion) * alturaBrizna;

    // Control de la curva: a media altura, desplazado hacia la inclinación.
    const cx = x + Math.sin(inclinacion * 0.5) * alturaBrizna * 0.6;
    const cy = y - alturaBrizna * 0.6;

    // Curva de Bézier cuadrática calculada a mano y muestreada como polilínea.
    // p5 2.x NO expone quadraticVertex(), así que no se puede usar.
    const segmentos = 6;
    beginShape();
    vertex(x, y);
    for (let paso = 1; paso <= segmentos; paso += 1) {
      const t = paso / segmentos;
      const inv = 1 - t;
      vertex(
        inv * inv * x + 2 * inv * t * cx + t * t * xFin,
        inv * inv * y + 2 * inv * t * cy + t * t * yFin
      );
    }
    endShape();
  }
}

/* ============================================================
   CÁMARA
   ============================================================ */

/* ---------- Cámara: configuración ---------- */

// Si en este tiempo el navegador no entregó el stream, asumimos que falló.
// Hace falta porque createCapture() solo avisa cuando SALE BIEN: si el usuario
// niega el permiso, su callback nunca se llama y la página quedaría muda.
const ESPERA_CAMARA_MS = 12000;

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
    // flipped: true espeja la imagen EN PANTALLA (vista selfie). Es solo visual:
    // los píxeles que recibirá ml5 NO vienen espejados. Cuando se integre la
    // detección, el espejo de coordenadas (x = 1 - x) se aplica una sola vez ahí.
    captura = createCapture(VIDEO, { flipped: true }, alEstarListaLaCamara);
  } catch (error) {
    console.error('[camara] createCapture falló:', error);
    mostrarErrorCamara('No se pudo iniciar la cámara en este navegador.');
    return;
  }

  // El <video> nace pegado al body: lo movemos al panel de la cámara.
  captura.parent('camara-contenedor');

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
