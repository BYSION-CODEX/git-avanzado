/* ============================================================
   PLANTA — crecimiento por gesto de puño cerrado

   Capa independiente sobre el lienzo de p5. El paisaje sigue con
   noLoop(): redibujar sus ~1600 trazos en cada frame para animar el
   crecimiento sería inviable. Acá solo se redibuja la planta, a 60 fps,
   sobre un canvas transparente del mismo tamaño que el de p5.

   Entradas: obtenerManos() de sketch.js (manos normalizadas 0..1, ya
   suavizadas, con su gesto). Salidas: la planta y el porcentaje en el
   panel de cámara.

   No toca cámara, Body Pose, Hand Pose ni el paisaje.
   ============================================================ */

(function () {
  /* ---------- Configuración ---------- */

  /** Los cinco niveles pedidos. */
  const NIVELES = [0.1, 0.3, 0.5, 0.75, 1];

  /**
   * Banda vertical útil, en coordenadas 0..1 de la imagen de cámara
   * (0 = arriba). Fuera de esta banda el gesto no aporta más recorrido.
   */
  const BANDA_Y_ABAJO = 0.85;
  const BANDA_Y_ARRIBA = 0.2;

  /** Velocidad del suavizado: más alto = responde antes y se ve más seco. */
  const VELOCIDAD_CRECIMIENTO = 4.5;

  const REFRESCO_TEXTO_MS = 120;

  const COLOR_TALLO = '#7a8470';
  const COLOR_HOJA = '#9aab86';

  /** Proporción del alto del lienzo que ocupa la planta al 100%. */
  const ALTURA_MAXIMA = 0.42;

  /* ---------- Estado ---------- */

  let lienzo = null;
  let ctx = null;
  let anchoCSS = 0;
  let altoCSS = 0;

  let crecimiento = 0; // valor mostrado (suavizado) 0..1
  let objetivo = 0; // nivel elegido 0..1
  let ultimoFrame = 0;
  let ultimoTexto = 0;

  /* ---------- Arranque ---------- */

  function iniciar() {
    lienzo = document.getElementById('planta-overlay');
    if (!lienzo) {
      console.warn('[planta] No se encontró #planta-overlay.');
      return;
    }

    ctx = lienzo.getContext('2d');
    if (!ctx) return;

    requestAnimationFrame(bucle);
  }

  function bucle(ahora) {
    requestAnimationFrame(bucle);

    const contenedor = document.getElementById('lienzo-contenedor');
    if (!contenedor) return;

    ajustarLienzo(contenedor);
    if (!anchoCSS || !altoCSS) return;

    const dt = ultimoFrame ? Math.min((ahora - ultimoFrame) / 1000, 0.1) : 0.016;
    ultimoFrame = ahora;

    actualizarCrecimiento(dt);

    ctx.clearRect(0, 0, anchoCSS, altoCSS);
    dibujarPlanta(anchoCSS, altoCSS);
    pintarPorcentaje(ahora);
  }

  /** Mismo tamaño exacto que el canvas de p5, con densidad de pantalla. */
  function ajustarLienzo(contenedor) {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const ancho = contenedor.clientWidth;
    const alto = contenedor.clientHeight;
    if (!ancho || !alto) return;

    const anchoFisico = Math.round(ancho * dpr);
    if (ancho === anchoCSS && alto === altoCSS && lienzo.width === anchoFisico) return;

    anchoCSS = ancho;
    altoCSS = alto;
    lienzo.width = anchoFisico;
    lienzo.height = Math.round(alto * dpr);

    // Cambiar width/height resetea el contexto.
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  /* ---------- Crecimiento ---------- */

  /**
   * Nivel objetivo según la altura del puño, o null si no hay puño cerrado.
   * Sin puño el objetivo no cambia: la planta se queda donde está.
   */
  function objetivoDesdeManos() {
    if (typeof obtenerManos !== 'function') return null;

    const manos = obtenerManos();
    if (!manos || manos.length === 0) return null;

    // Con dos puños manda el que está más alto.
    let mejorY = null;
    for (const mano of manos) {
      if (!mano.gesto || mano.gesto.estado !== 'cerrado') continue;
      const y = alturaDeLaPalma(mano);
      if (mejorY === null || y < mejorY) mejorY = y;
    }

    if (mejorY === null) return null;

    return nivelDesdeAltura(mejorY);
  }

  /**
   * Altura de mano (0 arriba, 1 abajo) → uno de los cinco niveles.
   * Normalizada, así no depende del tamaño de la cámara.
   */
  function nivelDesdeAltura(y) {
    const progreso = limitar((BANDA_Y_ABAJO - y) / (BANDA_Y_ABAJO - BANDA_Y_ARRIBA), 0, 1);
    const indice = Math.min(NIVELES.length - 1, Math.floor(progreso * NIVELES.length));
    return NIVELES[indice];
  }

  /** Centro de la palma: promedio de muñeca (0) y base del dedo medio (9). */
  function alturaDeLaPalma(mano) {
    const muneca = mano.keypoints[0];
    const medio = mano.keypoints[9];
    if (!muneca || !medio) return 0.5;
    return (muneca.y + medio.y) / 2;
  }

  /** Suavizado independiente del framerate (no un lerp con alfa fijo). */
  function actualizarCrecimiento(dt) {
    const nuevoObjetivo = objetivoDesdeManos();
    if (nuevoObjetivo !== null) objetivo = nuevoObjetivo;

    const factor = 1 - Math.exp(-VELOCIDAD_CRECIMIENTO * dt);
    crecimiento += (objetivo - crecimiento) * factor;

    if (Math.abs(objetivo - crecimiento) < 0.001) crecimiento = objetivo;
  }

  /* ---------- Dibujo ---------- */

  function dibujarPlanta(ancho, alto) {
    if (crecimiento <= 0.004) return;

    const base = baseDeLaPlanta(ancho, alto);
    const altura = alto * ALTURA_MAXIMA * crecimiento;

    // Tallo: una curva suave, más gruesa cuanto más creció.
    ctx.lineCap = 'round';
    ctx.strokeStyle = COLOR_TALLO;
    ctx.lineWidth = Math.max(1.2, 5 * crecimiento);

    ctx.beginPath();
    const segmentos = 12;
    for (let i = 0; i <= segmentos; i += 1) {
      const t = i / segmentos;
      const punto = puntoDelTallo(base, altura, t);
      if (i === 0) ctx.moveTo(punto.x, punto.y);
      else ctx.lineTo(punto.x, punto.y);
    }
    ctx.stroke();

    // Hojas: aparecen a medida que la planta pasa su altura.
    const hojas = [
      { t: 0.32, lado: -1 },
      { t: 0.55, lado: 1 },
      { t: 0.78, lado: -1 },
    ];

    ctx.fillStyle = COLOR_HOJA;
    for (const hoja of hojas) {
      if (crecimiento < hoja.t) continue;
      const punto = puntoDelTallo(base, altura, hoja.t);
      const tamano = altura * 0.16 * (0.5 + hoja.t * 0.7);
      dibujarHoja(punto.x, punto.y, tamano, hoja.lado);
    }
  }

  /** Punto del tallo en t = 0 (base) .. 1 (punta). Curva determinista. */
  function puntoDelTallo(base, altura, t) {
    return {
      x: base.x + Math.sin(t * 2.1) * altura * 0.06,
      y: base.y - altura * t,
    };
  }

  function dibujarHoja(x, y, tamano, lado) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(lado * -0.55);
    ctx.beginPath();
    ctx.ellipse(lado * tamano * 0.9, 0, tamano * 2, tamano * 0.75, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  /**
   * Dónde nace la planta: sobre el borde real de la capa de suelo cercana.
   * bordeDeSuelo() y CAPAS_SUELO vienen de sketch.js, así que la base coincide
   * con la tierra dibujada y no queda flotando.
   */
  function baseDeLaPlanta(ancho, alto) {
    const x = ancho * 0.5;
    const horizonte = alto * 0.54;

    if (typeof bordeDeSuelo === 'function' && typeof CAPAS_SUELO !== 'undefined') {
      return { x, y: bordeDeSuelo(x, CAPAS_SUELO[2], horizonte) + alto * 0.01 };
    }

    return { x, y: horizonte + alto * 0.28 };
  }

  /* ---------- Lectura en pantalla ---------- */

  function pintarPorcentaje(ahora) {
    if (ahora - ultimoTexto < REFRESCO_TEXTO_MS) return;
    ultimoTexto = ahora;

    const elemento = document.getElementById('crecimiento-estado');
    if (!elemento) return;

    const porcentaje = Math.round(crecimiento * 100);
    const texto = `Crecimiento: ${porcentaje}%`;
    if (elemento.textContent !== texto) elemento.textContent = texto;

    const estado = porcentaje > 0 ? 'listo' : 'inactivo';
    if (elemento.dataset.estado !== estado) elemento.dataset.estado = estado;
  }

  /* ---------- Utilidades ---------- */

  function limitar(valor, minimo, maximo) {
    return Math.min(maximo, Math.max(minimo, valor));
  }

  // Acceso de solo lectura para comprobar el mapeo desde la consola.
  window.plantaDebug = {
    nivelDesdeAltura: (y) => nivelDesdeAltura(y),
    crecimiento: () => crecimiento,
    objetivo: () => objetivo,
    niveles: NIVELES.slice(),
  };

  iniciar();
})();
