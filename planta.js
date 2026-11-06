/* ============================================================
   PLANTA — crecimiento por gesto de puño cerrado

   Capa independiente sobre el lienzo de p5. El paisaje ya tiene su propio
   bucle de viento, pero la planta NO se dibuja ahí: este canvas transparente
   del mismo tamaño que el de p5 se limpia y se repinta a 60 fps, y así el
   crecimiento no obliga a repintar el fondo ni el pasto.

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

  /** Histéresis de nivel: cuánto hay que pasar el borde para cambiar. */
  const MARGEN_NIVEL = 0.03;

  /** Por encima de esta velocidad de muñeca, la altura de la planta no cambia. */
  const VELOCIDAD_CONGELAMIENTO_NIVEL = 1.2;

  /** Velocidad del suavizado: más alto = responde antes y se ve más seco. */
  const VELOCIDAD_CRECIMIENTO = 4.5;

  const REFRESCO_TEXTO_MS = 120;

  /** El florecimiento va más lento que el crecimiento: se siente natural. */
  const VELOCIDAD_FLORACION = 2.6;

  const COLOR_TALLO = '#7a8470';
  const COLOR_HOJA = '#9aab86';
  const COLOR_PETALO = '#e6d3ae';
  const COLOR_CENTRO = '#caa46a';

  const PETALOS = 6;

  /**
   * Flores sobre el tallo. `t` es la posición (0 base, 1 punta) y `desfase`
   * escalona la apertura para que no se abran todas a la vez.
   */
  const FLORES = [
    { t: 1, lado: 0, escala: 1, desfase: 0 },
    { t: 0.9, lado: -1, escala: 0.7, desfase: 0.1 },
    { t: 0.84, lado: 1, escala: 0.62, desfase: 0.2 },
  ];

  /* ---------- Sacudida ---------- */

  /** Velocidad mínima de la muñeca, en unidades normalizadas por segundo. */
  const VELOCIDAD_MINIMA_SACUDIDA = 0.9;

  /** Desplazamiento mínimo por frame: descarta el temblor del tracking. */
  const PASO_MINIMO_SACUDIDA = 0.01;

  /** Cambios de dirección necesarios dentro de la ventana de tiempo. */
  const CAMBIOS_NECESARIOS = 3;
  const VENTANA_SACUDIDA_MS = 700;

  /** La sacudida entra rápido y se va lento. */
  const ATAQUE_SACUDIDA = 14;
  const RELAJO_SACUDIDA = 3.5;

  /** Temblor: amplitud en radianes y frecuencia angular por milisegundo. */
  const AMPLITUD_TEMBLOR = 0.09;
  const FRECUENCIA_TEMBLOR = 0.045;

  const MAX_PARTICULAS = 140;
  const EMISION_MAXIMA = 70; // partículas por segundo a intensidad 1
  const COLOR_POLEN = '#e8d9a8';

  /* ---------- Inclinación ---------- */

  /** Zona muerta: por debajo de este ángulo la planta no se mueve (~6°). */
  const ANGULO_MUERTO = 0.1;

  /** Ángulo de mano que corresponde a la inclinación máxima (~34°). */
  const ANGULO_MAXIMO = 0.6;

  /** Inclinación máxima de la planta en radianes (~16°). */
  const INCLINACION_MAXIMA = 0.28;

  /** Volver al centro es más lento que seguir la mano. */
  const VELOCIDAD_INCLINACION = 6;
  const VELOCIDAD_REGRESO = 1.8;

  /** Proporción del alto del lienzo que ocupa la planta al 100%. */
  const ALTURA_MAXIMA = 0.42;

  /* ---------- Estado ---------- */

  let lienzo = null;
  let ctx = null;
  let anchoCSS = 0;
  let altoCSS = 0;

  let crecimiento = 0; // valor mostrado (suavizado) 0..1
  let objetivo = 0; // nivel elegido 0..1
  let indiceNivel = 0; // nivel actual, para la histéresis
  let florecimiento = 0; // apertura de los pétalos 0..1
  let objetivoFloracion = 0;
  let ultimoFrame = 0;
  let ultimoTexto = 0;

  let intensidadSacudida = 0; // 0..1, ya suavizada
  let congelarAltura = false; // true cuando la mano va rápido o está sacudiendo
  let inclinacion = 0; // radianes, ya suavizada
  let objetivoInclinacion = 0;
  let particulas = [];
  let acumuladorEmision = 0;
  let relojDebug = 0;
  const estadosSacudida = {}; // un estado por mano (clave: handedness)

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

    actualizar(dt, ahora);

    ctx.clearRect(0, 0, anchoCSS, altoCSS);
    dibujarPlanta(anchoCSS, altoCSS, ahora);
    dibujarParticulas();
    pintarPorcentaje(ahora);
  }

  /** Un paso de simulación: cada interacción es un estado independiente. */
  function actualizar(dt, ahora) {
    // La sacudida va primero: el crecimiento consulta su intensidad del frame
    // actual para no reaccionar al movimiento vertical de la propia sacudida.
    actualizarSacudida(ahora, dt);
    actualizarCrecimiento(dt);
    actualizarFlorecimiento(dt);
    actualizarInclinacion(dt);
    actualizarParticulas(dt);
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

    return nivelConHisteresis(progresoDesdeAltura(mejorY));
  }

  /** Altura de mano (0 arriba, 1 abajo) → progreso 0..1 dentro de la banda. */
  function progresoDesdeAltura(y) {
    return limitar((BANDA_Y_ABAJO - y) / (BANDA_Y_ABAJO - BANDA_Y_ARRIBA), 0, 1);
  }

  /**
   * Mapeo puro altura → nivel, SIN histéresis. Es el que expone plantaDebug
   * y sirve para comprobar la progresión; el comportamiento real pasa por
   * nivelConHisteresis().
   */
  function nivelDesdeAltura(y) {
    const progreso = progresoDesdeAltura(y);
    const indice = Math.min(NIVELES.length - 1, Math.floor(progreso * NIVELES.length));
    return NIVELES[indice];
  }

  /**
   * Cambia de nivel solo si el progreso cruza el borde con margen.
   *
   * Sin esto, una mano quieta justo en el límite hace que la planta salte 20%
   * de altura cada pocos frames — y peor: inclinar la mano mueve el centro de
   * la palma un poco, y sacudir lo mueve bastante. La histéresis absorbe esas
   * variaciones sin volver lento el gesto.
   */
  function nivelConHisteresis(progreso) {
    const paso = 1 / NIVELES.length;

    while (
      indiceNivel < NIVELES.length - 1 &&
      progreso >= (indiceNivel + 1) * paso + MARGEN_NIVEL
    ) {
      indiceNivel += 1;
    }

    while (indiceNivel > 0 && progreso <= indiceNivel * paso - MARGEN_NIVEL) {
      indiceNivel -= 1;
    }

    return NIVELES[indiceNivel];
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
    // La altura solo sigue a la mano cuando el movimiento es tranquilo. Si la
    // muñeca va rápido o está en pleno vaivén —sacudida— el nivel no cambia:
    // eso no es "elegir una altura". Antes la planta saltaba decenas de veces
    // por segundo al sacudir.
    if (!congelarAltura) {
      const nuevoObjetivo = objetivoDesdeManos();
      if (nuevoObjetivo !== null) objetivo = nuevoObjetivo;
    }

    const factor = 1 - Math.exp(-VELOCIDAD_CRECIMIENTO * dt);
    crecimiento += (objetivo - crecimiento) * factor;

    if (Math.abs(objetivo - crecimiento) < 0.001) crecimiento = objetivo;
  }

  /**
   * El florecimiento depende SOLO de la mano abierta y es independiente del
   * crecimiento: abrir o cerrar la mano no toca la altura de la planta.
   */
  function actualizarFlorecimiento(dt) {
    objetivoFloracion = hayManoAbierta() ? 1 : 0;

    const factor = 1 - Math.exp(-VELOCIDAD_FLORACION * dt);
    florecimiento += (objetivoFloracion - florecimiento) * factor;

    if (Math.abs(objetivoFloracion - florecimiento) < 0.001) {
      florecimiento = objetivoFloracion;
    }
  }

  /** ¿Hay al menos una mano abierta? El puño no cuenta. */
  function hayManoAbierta() {
    if (typeof obtenerManos !== 'function') return false;

    const manos = obtenerManos();
    if (!manos || manos.length === 0) return false;

    return manos.some((mano) => mano.gesto && mano.gesto.estado === 'abierta');
  }

  /* ---------- Inclinación ---------- */

  /**
   * Inclinación objetivo en radianes, promediando las manos disponibles.
   * Sin manos el objetivo es 0: la planta se endereza sola y despacio.
   */
  function actualizarInclinacion(dt) {
    const objetivo = objetivoInclinacionDesdeManos();
    objetivoInclinacion = objetivo === null ? 0 : objetivo;

    // Volver al centro se siente mejor más lento que seguir la mano.
    const rapidez =
      Math.abs(objetivoInclinacion) < 0.01 ? VELOCIDAD_REGRESO : VELOCIDAD_INCLINACION;

    const factor = 1 - Math.exp(-rapidez * dt);
    inclinacion += (objetivoInclinacion - inclinacion) * factor;

    if (Math.abs(objetivoInclinacion - inclinacion) < 0.0005) inclinacion = objetivoInclinacion;
  }

  function objetivoInclinacionDesdeManos() {
    if (typeof obtenerManos !== 'function') return null;

    const manos = obtenerManos();
    if (!manos || manos.length === 0) return null;

    let suma = 0;
    let cuenta = 0;

    for (const mano of manos) {
      const valor = inclinacionDeMano(mano);
      if (valor === null) continue;
      suma += valor;
      cuenta += 1;
    }

    return cuenta === 0 ? null : suma / cuenta;
  }

  /**
   * Ángulo de la mano en el plano de la imagen.
   *
   * Se calcula con el VECTOR muñeca → centro de la palma, nunca con la
   * posición: mover la mano de lado no inclina nada, solo girarla. El centro
   * es el promedio de las cuatro bases de los dedos, así entran palma y dedos
   * y el ruido de un punto suelto se diluye.
   *
   * La x se espeja para que el sentido coincida con lo que ve el usuario.
   */
  function inclinacionDeMano(mano) {
    const puntos = mano.keypoints;
    if (!puntos) return null;

    const muneca = puntos[0];
    if (!muneca) return null;

    let sumaX = 0;
    let sumaY = 0;
    let cuenta = 0;

    for (const indice of [5, 9, 13, 17]) {
      const nudillo = puntos[indice];
      if (!nudillo) continue;
      sumaX += nudillo.x;
      sumaY += nudillo.y;
      cuenta += 1;
    }

    if (cuenta === 0) return null;

    const centroX = sumaX / cuenta;
    const centroY = sumaY / cuenta;

    // Vector muñeca → palma, con x espejada (la cámara se muestra en espejo).
    const dx = muneca.x - centroX;
    const dy = muneca.y - centroY;

    // Palma degenerada (puntos encimados): no hay orientación que sacar.
    if (Math.hypot(dx, dy) < 0.01) return null;

    // 0 = dedos hacia arriba; positivo = mano inclinada a la derecha.
    const angulo = Math.atan2(dx, dy);

    const excedente = Math.abs(angulo) - ANGULO_MUERTO;
    if (excedente <= 0) return 0;

    const normalizado =
      Math.min(1, excedente / (ANGULO_MAXIMO - ANGULO_MUERTO)) * Math.sign(angulo);

    return normalizado * INCLINACION_MAXIMA;
  }

  /* ---------- Sacudida ---------- */

  /**
   * Detecta agitación por la MUÑECA (keypoints[0]). No alcanza con que la mano
   * se mueva rápido: hacen falta cambios de dirección repetidos en poco tiempo.
   * Así un movimiento amplio y accidental no dispara la interacción.
   */
  function actualizarSacudida(ahora, dt) {
    let maxima = 0;
    let maximaVelocidad = 0;
    let vaiven = false;
    const vistas = new Set();

    if (typeof obtenerManos === 'function') {
      for (const mano of obtenerManos()) {
        const muneca = mano.keypoints && mano.keypoints[0];
        if (!muneca) continue;

        const clave = mano.handedness || 'Mano';
        vistas.add(clave);

        if (!estadosSacudida[clave]) {
          estadosSacudida[clave] = {
            x: muneca.x,
            y: muneca.y,
            t: ahora,
            direccion: 0,
            cambios: [],
            intensidad: 0,
            velocidad: 0,
          };
        }

        const estado = estadosSacudida[clave];
        const sacudiendo = detectarSacudida(estado, muneca, ahora);
        const factor = 1 - Math.exp(-(sacudiendo ? ATAQUE_SACUDIDA : RELAJO_SACUDIDA) * dt);

        estado.intensidad += ((sacudiendo ? 1 : 0) - estado.intensidad) * factor;
        maxima = Math.max(maxima, estado.intensidad);
        maximaVelocidad = Math.max(maximaVelocidad, estado.velocidad);

        // Dos reversiones en la ventana ya son vaivén, aunque la sacudida aún
        // no esté confirmada (hacen falta tres).
        if (estado.cambios.length >= 2) vaiven = true;
      }
    }

    // Manos que desaparecieron: se apagan suave, no de golpe.
    for (const clave of Object.keys(estadosSacudida)) {
      if (vistas.has(clave)) continue;

      const estado = estadosSacudida[clave];
      estado.intensidad += (0 - estado.intensidad) * (1 - Math.exp(-RELAJO_SACUDIDA * dt));

      if (estado.intensidad < 0.01) {
        delete estadosSacudida[clave];
      } else {
        maxima = Math.max(maxima, estado.intensidad);
      }
    }

    intensidadSacudida = maxima;

    // En los extremos del vaivén la velocidad instantánea pasa por cero, así
    // que la velocidad sola no alcanza: también congela el vaivén sostenido.
    congelarAltura =
      maximaVelocidad >= VELOCIDAD_CONGELAMIENTO_NIVEL || maxima > 0.1 || vaiven;
  }

  /** ¿La muñeca cambió de dirección lo suficiente como para contar? */
  function detectarSacudida(estado, muneca, ahora) {
    const dx = muneca.x - estado.x;
    const dy = muneca.y - estado.y;
    const dtSegundos = Math.max((ahora - estado.t) / 1000, 0.001);
    const velocidad = Math.hypot(dx, dy) / dtSegundos;

    estado.x = muneca.x;
    estado.y = muneca.y;
    estado.t = ahora;
    estado.velocidad = velocidad;

    // Un cambio de dirección solo cuenta si el movimiento fue real y rápido.
    if (Math.abs(dx) >= PASO_MINIMO_SACUDIDA && velocidad >= VELOCIDAD_MINIMA_SACUDIDA) {
      const direccion = Math.sign(dx);
      if (estado.direccion !== 0 && direccion !== estado.direccion) {
        estado.cambios.push(ahora);
      }
      estado.direccion = direccion;
    }

    // Los cambios viejos no cuentan: sacudir tiene que ser sostenido.
    while (estado.cambios.length > 0 && ahora - estado.cambios[0] > VENTANA_SACUDIDA_MS) {
      estado.cambios.shift();
    }

    return estado.cambios.length >= CAMBIOS_NECESARIOS;
  }

  /* ---------- Partículas ---------- */

  function actualizarParticulas(dt) {
    if (intensidadSacudida > 0.12 && crecimiento > 0.05) {
      acumuladorEmision += EMISION_MAXIMA * intensidadSacudida * dt;

      while (acumuladorEmision >= 1 && particulas.length < MAX_PARTICULAS) {
        emitirParticula();
        acumuladorEmision -= 1;
      }
    } else {
      acumuladorEmision = 0;
    }

    for (const particula of particulas) {
      // Roce: frenan rápido y quedan flotando.
      const roce = Math.exp(-1.6 * dt);
      particula.vx *= roce;
      particula.vy = particula.vy * roce - 18 * dt;

      particula.x += particula.vx * dt;
      particula.y += particula.vy * dt;
      particula.vida -= dt;
    }

    particulas = particulas.filter((particula) => particula.vida > 0);
  }

  function emitirParticula() {
    if (!anchoCSS || !altoCSS) return;

    const base = baseDeLaPlanta(anchoCSS, altoCSS);
    const altura = altoCSS * ALTURA_MAXIMA * crecimiento;
    if (altura < 10) return;

    // Nacen a lo largo del tallo, con más densidad hacia las flores.
    const t = 0.35 + Math.random() * 0.7;
    const punto = puntoDelTallo(base, altura, t);

    const escala = altoCSS * 0.1;
    const direccion = Math.random() * Math.PI * 2;
    const rapidez = escala * (0.25 + Math.random() * 0.75);
    const vida = 0.9 + Math.random() * 1.4;

    // Cada una con su tamaño, su velocidad y su duración: nada de copias iguales.
    particulas.push({
      x: punto.x + (Math.random() - 0.5) * altura * 0.18,
      y: punto.y + (Math.random() - 0.5) * altura * 0.1,
      vx: Math.cos(direccion) * rapidez,
      vy: Math.sin(direccion) * rapidez - escala * 0.25,
      vida,
      vidaMax: vida,
      tamano: altoCSS * (0.0015 + Math.random() * 0.0035),
    });
  }

  function dibujarParticulas() {
    if (particulas.length === 0) return;

    ctx.fillStyle = COLOR_POLEN;

    for (const particula of particulas) {
      const alfa = Math.max(0, particula.vida / particula.vidaMax);
      if (alfa <= 0.01) continue;

      ctx.globalAlpha = alfa;
      ctx.beginPath();
      ctx.arc(particula.x, particula.y, particula.tamano, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.globalAlpha = 1;
  }

  /* ---------- Dibujo ---------- */

  function dibujarPlanta(ancho, alto, ahora) {
    if (crecimiento <= 0.004) return;

    const base = baseDeLaPlanta(ancho, alto);
    const altura = alto * ALTURA_MAXIMA * crecimiento;

    // El temblor pivota en la base, como un tallo real: no se traslada entero.
    ctx.save();

    const temblor =
      intensidadSacudida > 0.001
        ? Math.sin(ahora * FRECUENCIA_TEMBLOR) * intensidadSacudida * AMPLITUD_TEMBLOR
        : 0;
    const anguloPlanta = inclinacion + temblor;

    if (Math.abs(anguloPlanta) > 0.001) {
      ctx.translate(base.x, base.y);
      ctx.rotate(anguloPlanta);
      ctx.translate(-base.x, -base.y);
    }

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

    dibujarFlores(base, altura);
    ctx.restore();
  }

  /** Flores en el extremo del tallo y en dos tallitos laterales. */
  function dibujarFlores(base, altura) {
    if (altura < 10) return;

    for (const flor of FLORES) {
      const punto = puntoDelTallo(base, altura, flor.t);
      const tallo = altura * 0.07 * flor.escala;

      let x = punto.x;
      let y = punto.y;

      if (flor.lado !== 0) {
        x = punto.x + flor.lado * tallo;
        y = punto.y - tallo * 0.5;

        ctx.strokeStyle = COLOR_TALLO;
        ctx.lineWidth = Math.max(1, 1.6 * crecimiento);
        ctx.beginPath();
        ctx.moveTo(punto.x, punto.y);
        ctx.lineTo(x, y);
        ctx.stroke();
      }

      // Cada flor arranca un poco después que la anterior.
      const apertura = limitar((florecimiento - flor.desfase) / (1 - flor.desfase), 0, 1);
      dibujarFlor(x, y, altura * 0.085 * flor.escala, apertura);
    }
  }

  /**
   * Un pétalo cerrado es un óvalo chico y apretado contra el centro; abierto,
   * el mismo óvalo se estira y se aleja. La interpolación es continua, así que
   * no hay salto entre "capullo" y "flor".
   */
  function dibujarFlor(x, y, tamano, apertura) {
    const desde = -Math.PI / 2;

    ctx.fillStyle = COLOR_PETALO;

    for (let i = 0; i < PETALOS; i += 1) {
      const angulo = desde + ((Math.PI * 2) / PETALOS) * i;
      const largo = tamano * (0.22 + 0.78 * apertura);
      const ancho = tamano * (0.3 + 0.1 * apertura);
      const distancia = tamano * (0.1 + 0.55 * apertura);

      ctx.save();
      ctx.translate(x + Math.cos(angulo) * distancia, y + Math.sin(angulo) * distancia);
      ctx.rotate(angulo + Math.PI / 2);
      ctx.beginPath();
      ctx.ellipse(0, 0, ancho, largo, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    ctx.fillStyle = COLOR_CENTRO;
    ctx.beginPath();
    ctx.arc(x, y, tamano * (0.14 + 0.1 * apertura), 0, Math.PI * 2);
    ctx.fill();
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
    const floracion = Math.round(florecimiento * 100);
    const texto = `Crecimiento: ${porcentaje}% · Floración: ${floracion}%`;
    if (elemento.textContent !== texto) elemento.textContent = texto;

    const estado = porcentaje > 0 || floracion > 0 ? 'listo' : 'inactivo';
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
    florecimiento: () => florecimiento,
    sacudida: () => intensidadSacudida,
    inclinacion: () => inclinacion,
    particulas: () => particulas.length,
    // Permite probar la emisión de partículas sin un canvas real.
    dimensiones: (ancho, alto) => {
      anchoCSS = ancho;
      altoCSS = alto;
    },
    // Simula un frame con reloj propio, para poder probar sin navegador.
    paso: (dt) => {
      relojDebug += dt * 1000;
      actualizar(dt, relojDebug);
    },
    niveles: NIVELES.slice(),
  };

  iniciar();
})();
