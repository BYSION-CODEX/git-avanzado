/* ============================================================
   El cambio florece contigo — sketch de p5.js
   Modo global: p5.js llama a setup() y draw() por su cuenta.

   Estado actual:
   - Canvas montado en #lienzo-contenedor (estático, sin animación).
   - Captura de video de la cámara montada en #camara-contenedor.
   - SIN reconocimiento corporal y SIN ml5.js todavía.
   ============================================================ */

/* ---------- Cámara ---------- */

// Si en este tiempo el navegador no entregó el stream, asumimos que falló.
// Hace falta porque createCapture() solo avisa cuando SALE BIEN: si el usuario
// niega el permiso, su callback nunca se llama y la página quedaría muda.
const ESPERA_CAMARA_MS = 12000;

let captura = null; // p5.Element que envuelve el <video>. Instancia única.
let estadoCamara = 'iniciando'; // 'iniciando' | 'lista' | 'error'
let mensajeCamara = null; // <p id="camara-mensaje">
let temporizadorCamara = null;

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

  // Placeholder estático: no hay nada que animar todavía.
  // Quitar noLoop() cuando empiece la animación del jardín.
  noLoop();

  // La cámara se pide al final: si falla, el lienzo ya está funcionando.
  iniciarCamara();
}

/**
 * Dibujo del lienzo. Por ahora, solo un fondo y una etiqueta fija
 * que confirma visualmente que p5.js está corriendo.
 */
function draw() {
  background(20);

  push();
  fill(140);
  noStroke();
  textAlign(CENTER, CENTER);
  textSize(13);
  text('Lienzo p5.js listo', width / 2, height / 2);
  pop();
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
    captura = createCapture(VIDEO, alEstarListaLaCamara);
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
