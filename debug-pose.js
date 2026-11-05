/* ============================================================
   MODO DEPURACIÓN — esqueleto de Body Pose sobre la cámara

   Capa independiente: no toca el escenario, ni el canvas de p5,
   ni la lógica de detección. Solo LEE la última pose y la dibuja
   sobre la imagen.

   Alineación: el canvas ocupa exactamente el mismo rectángulo que
   el <video> (#camara-marco), y cada punto se convierte con
   mapearPuntoCamara(), que aplica el espejo y el recorte de
   object-fit. Por eso el esqueleto cae donde está el cuerpo y no
   corrido ni invertido.

   Solo tren superior: no se dibujan rodillas, tobillos ni pies.
   ============================================================ */

/**
 * Interruptor del modo de depuración.
 *   true  -> dibuja esqueleto e indicador
 *   false -> este archivo no hace absolutamente nada
 *
 * Para la presentación final alcanza con borrar el <script> de index.html.
 */
const DEPURACION_POSE = true;

(function () {
  if (!DEPURACION_POSE) return;

  /* ---------- Configuración ---------- */

  /** Conexiones del tren superior. 'cuello' es un punto virtual. */
  const CONEXIONES = [
    // cabeza
    ['nose', 'left_eye'],
    ['nose', 'right_eye'],
    ['left_eye', 'left_ear'],
    ['right_eye', 'right_ear'],
    ['cuello', 'nose'],
    // tronco
    ['left_shoulder', 'right_shoulder'],
    ['left_shoulder', 'left_hip'],
    ['right_shoulder', 'right_hip'],
    ['left_hip', 'right_hip'],
    // brazos
    ['left_shoulder', 'left_elbow'],
    ['left_elbow', 'left_wrist'],
    ['right_shoulder', 'right_elbow'],
    ['right_elbow', 'right_wrist'],
  ];

  /** Qué se dibuja y con qué tamaño. Las claves son los nombres de ml5. */
  const RADIOS = {
    nose: 4.5,
    left_eye: 2.6,
    right_eye: 2.6,
    left_ear: 2.6,
    right_ear: 2.6,
    left_shoulder: 4,
    right_shoulder: 4,
    left_elbow: 3.4,
    right_elbow: 3.4,
    left_wrist: 3.4,
    right_wrist: 3.4,
    left_hip: 4,
    right_hip: 4,
  };

  const COLOR_CABEZA = '#ffd9a0';
  const COLOR_CUERPO = '#7fe3ff';
  const COLOR_LINEA = 'rgba(127, 227, 255, 0.55)';

  // Mismos tonos que los estados de #pose-estado en style.css.
  const COLOR_OK = '#7fd1a5';
  const COLOR_PARCIAL = '#e0b25f';
  const COLOR_FALLA = '#e2707a';

  /* ---------- Estado del módulo ---------- */

  let lienzo = null;
  let ctx = null;
  let anchoCSS = 0;
  let altoCSS = 0;

  /* ---------- Arranque ---------- */

  function iniciar() {
    // Si sketch.js no cargó, este módulo no tiene de dónde leer.
    if (
      typeof obtenerEstadoPose !== 'function' ||
      typeof obtenerPoseBusto !== 'function' ||
      typeof mapearPuntoCamara !== 'function'
    ) {
      console.warn('[debugPose] sketch.js no expone la API necesaria; modo depuración apagado.');
      return;
    }

    lienzo = document.getElementById('pose-overlay');
    if (!lienzo) {
      console.warn('[debugPose] No se encontró #pose-overlay.');
      return;
    }

    ctx = lienzo.getContext('2d');
    if (!ctx) return;

    requestAnimationFrame(bucle);
  }

  /** Bucle propio: el escenario usa noLoop(), así que no podemos colgarnos de draw(). */
  function bucle() {
    requestAnimationFrame(bucle);

    const marco = document.getElementById('camara-marco');
    if (!marco) return;

    ajustarLienzo(marco);
    if (!anchoCSS || !altoCSS) return;

    ctx.clearRect(0, 0, anchoCSS, altoCSS);

    const estado = obtenerEstadoPose();

    // Sin cámara no hay nada que anotar: el panel muestra su propio mensaje.
    if (estado === 'inactivo') return;

    const pose = obtenerPoseBusto();
    if (pose) dibujarEsqueleto(pose);

    dibujarIndicador(estado, pose);
  }

  /** Mantiene el canvas del tamaño exacto del marco, con densidad de pantalla. */
  function ajustarLienzo(marco) {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const ancho = marco.clientWidth;
    const alto = marco.clientHeight;
    if (!ancho || !alto) return;

    const anchoFisico = Math.round(ancho * dpr);
    if (ancho === anchoCSS && alto === altoCSS && lienzo.width === anchoFisico) return;

    anchoCSS = ancho;
    altoCSS = alto;
    lienzo.width = anchoFisico;
    lienzo.height = Math.round(alto * dpr);

    // Cambiar width/height resetea el contexto: hay que reaplicar la escala.
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  /* ---------- Esqueleto ---------- */

  function dibujarEsqueleto(pose) {
    const puntos = {};

    // Un punto se dibuja solo si la detección tiene confianza suficiente
    // (pose.puntos[clave].visible) y si cae dentro del recorte visible.
    for (const clave of Object.keys(RADIOS)) {
      const punto = pose.puntos[clave];
      if (!punto || !punto.visible) continue;

      const mapeado = mapearPuntoCamara(punto.x, punto.y);
      if (!mapeado.visible) continue;

      puntos[clave] = { x: mapeado.x * anchoCSS, y: mapeado.y * altoCSS };
    }

    // Cuello virtual: punto medio de los hombros. Sin él, la cabeza queda
    // flotando y el esqueleto se lee peor.
    if (puntos.left_shoulder && puntos.right_shoulder) {
      puntos.cuello = {
        x: (puntos.left_shoulder.x + puntos.right_shoulder.x) / 2,
        y: (puntos.left_shoulder.y + puntos.right_shoulder.y) / 2,
      };
    }

    // Las líneas necesitan los dos extremos: si falta uno, no se dibuja nada.
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.strokeStyle = COLOR_LINEA;

    for (const [desde, hasta] of CONEXIONES) {
      const a = puntos[desde];
      const b = puntos[hasta];
      if (!a || !b) continue;

      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }

    for (const [clave, punto] of Object.entries(puntos)) {
      if (clave === 'cuello') continue;
      const color = esCabeza(clave) ? COLOR_CABEZA : COLOR_CUERPO;
      dibujarPunto(punto.x, punto.y, RADIOS[clave], color);
    }
  }

  function esCabeza(clave) {
    return clave === 'nose' || clave.includes('_eye') || clave.includes('_ear');
  }

  /** Punto con un aro oscuro: se lee igual sobre fondo claro u oscuro. */
  function dibujarPunto(x, y, radio, color) {
    ctx.beginPath();
    ctx.arc(x, y, radio + 1.3, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(8, 10, 14, 0.8)';
    ctx.fill();

    ctx.beginPath();
    ctx.arc(x, y, radio, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
  }

  /* ---------- Indicador de detección ---------- */

  function dibujarIndicador(estado, pose) {
    const { texto, color } = describirEstado(estado, pose);

    // Marco tenue: se ve de reojo sin tapar la imagen.
    ctx.globalAlpha = 0.45;
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.strokeRect(1, 1, anchoCSS - 2, altoCSS - 2);
    ctx.globalAlpha = 1;

    ctx.font = '600 11px "Segoe UI", system-ui, sans-serif';
    ctx.textBaseline = 'middle';

    const alto = 22;
    const ancho = Math.max(124, ctx.measureText(texto).width + 34);
    const x = 10;
    const y = altoCSS - alto - 10;

    ctx.fillStyle = 'rgba(8, 10, 14, 0.72)';
    ctx.beginPath();
    if (typeof ctx.roundRect === 'function') {
      ctx.roundRect(x, y, ancho, alto, alto / 2);
    } else {
      ctx.rect(x, y, ancho, alto);
    }
    ctx.fill();

    ctx.beginPath();
    ctx.arc(x + 13, y + alto / 2, 3.5, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();

    ctx.fillStyle = color;
    ctx.fillText(texto, x + 23, y + alto / 2 + 0.5);
  }

  function describirEstado(estado, pose) {
    if (estado === 'error') return { texto: 'ERROR DE MODELO', color: COLOR_FALLA };
    if (estado === 'cargando') return { texto: 'CARGANDO MODELO', color: COLOR_PARCIAL };
    if (!pose) return { texto: 'SIN DETECCIÓN', color: COLOR_FALLA };
    if (!pose.bustoEnCuadro) return { texto: 'BUSTO PARCIAL', color: COLOR_PARCIAL };
    return { texto: 'BUSTO OK', color: COLOR_OK };
  }

  iniciar();
})();
