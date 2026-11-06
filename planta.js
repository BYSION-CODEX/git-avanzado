/* ============================================================
   PLANTA — crecimiento por gesto de puño cerrado

   Capa independiente sobre el lienzo de p5. El paisaje ya tiene su propio
   bucle de viento, pero la planta NO se dibuja ahí: este canvas transparente
   del mismo tamaño que el de p5 se limpia y se repinta a 60 fps, y así el
   crecimiento no obliga a repintar el fondo ni el pasto.

   La flor es la ilustración `flor.png`: acá no se redibuja, solo se escala,
   se inclina, se sacude y se revela. La interacción es la misma de siempre.

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

  /** Ilustración de la flor: PNG con transparencia, se dibuja tal cual. */
  const ARCHIVO_FLOR = 'flor.png';

  /**
   * Geometría del florecimiento, en fracciones del alto de la ilustración.
   *
   * La corola se descubre desde su base —donde nace del tallo— hacia afuera.
   * Es un revelado, no una deformación: los pétalos no se estiran, se dejan de
   * tapar. `radioMaximo` cubre la corola entera cuando florecimiento llega a 1.
   */
  const COROLA = {
    centroX: 0.5,
    centroY: 0.3,
    radioMinimo: 0.13,
    radioMaximo: 0.4,
    suavizado: 0.03,
    juntura: 0.318,
  };

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

  /** Temblor de la sacudida: dos armónicos, a la frecuencia de un tallo real. */
  const AMPLITUD_TEMBLOR = 0.06;
  const FRECUENCIA_TEMBLOR = 0.019; // rad/ms ≈ 3 Hz

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

  /**
   * La inclinación es un resorte amortiguado, no un lerp: la flor tiene inercia,
   * acompaña la mano y se asienta sola con un vaivén corto. Seguir la mano es
   * más rígido que volver al centro, igual que antes.
   */
  const RESORTE_INCLINACION = {
    rigidezSeguir: 60,
    amortiguacionSeguir: 10,
    rigidezVolver: 16,
    amortiguacionVolver: 7,
  };

  /**
   * Vaivén ambiental: la flor se mece con el MISMO viento que los árboles.
   * Lee `fuerzaViento` y `direccionViento` de sketch.js; es solo dibujo, no
   * toca la inclinación que controla la mano.
   */
  const VIENTO_PLANTA = {
    amplitud: 0.035, // rad a viento máximo (~2°)
    velocidad: 1.7, // rad/s del vaivén, como los árboles
    velocidadDeriva: 0.35, // rad/s de la deriva lenta
  };

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
  let florecimiento = 0; // revelado de la corola 0..1
  let objetivoFloracion = 0;
  let ultimoFrame = 0;
  let ultimoTexto = 0;

  let intensidadSacudida = 0; // 0..1, ya suavizada
  let congelarAltura = false; // true cuando la mano va rápido o está sacudiendo
  let inclinacion = 0; // radianes, ya suavizada
  let velocidadInclinacion = 0; // rad/s, para el resorte
  let objetivoInclinacion = 0;
  let particulas = [];
  let acumuladorEmision = 0;
  let relojDebug = 0;
  const estadosSacudida = {}; // un estado por mano (clave: handedness)

  let imagenFlor = null;
  let imagenLista = false;
  let proporcionFlor = 1; // ancho / alto, se lee al cargar la ilustración

  /* ---------- Arranque ---------- */

  function iniciar() {
    lienzo = document.getElementById('planta-overlay');
    if (!lienzo) {
      console.warn('[planta] No se encontró #planta-overlay.');
      return;
    }

    ctx = lienzo.getContext('2d');
    if (!ctx) return;

    cargarFlor();
    requestAnimationFrame(bucle);
  }

  /**
   * La ilustración se carga con callbacks, como el personaje: hasta que no
   * está lista no se dibuja nada. Si falta el archivo, la experiencia sigue
   * andando y solo se pierde la planta.
   */
  function cargarFlor() {
    imagenFlor = new Image();
    imagenFlor.onload = () => {
      proporcionFlor = imagenFlor.naturalWidth / imagenFlor.naturalHeight;
      imagenLista = true;
    };
    imagenFlor.onerror = () => {
      console.warn('[planta] No se pudo cargar ' + ARCHIVO_FLOR + '; la planta no se dibuja.');
    };
    imagenFlor.src = ARCHIVO_FLOR;
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

    // Seguir la mano es más rígido que volver al centro: mismo contraste de
    // antes, ahora con inercia de resorte y no con un lerp.
    const siguiendo = objetivo !== null;
    const rigidez = siguiendo
      ? RESORTE_INCLINACION.rigidezSeguir
      : RESORTE_INCLINACION.rigidezVolver;
    const amortiguacion = siguiendo
      ? RESORTE_INCLINACION.amortiguacionSeguir
      : RESORTE_INCLINACION.amortiguacionVolver;

    // Subpasos: con un dt grande (pestaña en segundo plano) el resorte
    // explícito se vuelve inestable.
    let restante = dt;
    while (restante > 0) {
      const paso = Math.min(restante, 1 / 120);
      const aceleracion =
        (objetivoInclinacion - inclinacion) * rigidez - velocidadInclinacion * amortiguacion;

      velocidadInclinacion += aceleracion * paso;
      inclinacion += velocidadInclinacion * paso;
      restante -= paso;
    }

    inclinacion = limitar(inclinacion, -0.34, 0.34);

    if (
      Math.abs(objetivoInclinacion - inclinacion) < 0.0005 &&
      Math.abs(velocidadInclinacion) < 0.0005
    ) {
      inclinacion = objetivoInclinacion;
      velocidadInclinacion = 0;
    }
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

  /**
   * La ilustración entera, escalada de forma uniforme con el crecimiento y
   * anclada en el suelo: la base queda fija y la flor crece hacia arriba.
   * No se recorta ni se deforma, así que la proporción original se conserva.
   */
  function dibujarPlanta(ancho, alto, ahora) {
    if (!imagenLista || crecimiento <= 0.004) return;

    const base = baseDeLaPlanta(ancho, alto);
    const alturaDibujo = alto * ALTURA_MAXIMA * crecimiento;
    const anchoDibujo = alturaDibujo * proporcionFlor;
    const x = base.x - anchoDibujo * 0.5;
    const y = base.y - alturaDibujo;

    // El temblor pivota en la base, como un tallo real: no se traslada entero.
    ctx.save();

    const anguloPlanta = inclinacion + temblorDeSacudida(ahora) + balanceoDelAire(ahora);

    if (Math.abs(anguloPlanta) > 0.001) {
      ctx.translate(base.x, base.y);
      ctx.rotate(anguloPlanta);
      ctx.translate(-base.x, -base.y);
    }

    ctx.drawImage(imagenFlor, x, y, anchoDibujo, alturaDibujo);

    // Con la mano abierta la corola se descubre; a 1 se ve la ilustración
    // completa y no hace falta enmascarar nada.
    if (florecimiento < 0.999) revelarCorola(x, y, anchoDibujo, alturaDibujo);

    ctx.restore();
  }

  /**
   * Temblor de la sacudida. Dos armónicos en vez de un seno puro: el tallo se
   * ve vibrar, no oscilar como un metrónomo. La intensidad ya viene suavizada
   * por `actualizarSacudida`.
   */
  function temblorDeSacudida(ahora) {
    if (intensidadSacudida <= 0.001) return 0;

    const base = Math.sin(ahora * FRECUENCIA_TEMBLOR);
    const armonico = Math.sin(ahora * FRECUENCIA_TEMBLOR * 1.73 + 1.1) * 0.35;

    return (base + armonico) * intensidadSacudida * AMPLITUD_TEMBLOR;
  }

  /**
   * Vaivén ambiental con el viento de la escena. Es solo presentación: se suma
   * al ángulo de dibujo y no toca `inclinacion`, que sigue siendo la que manda
   * la mano. En el banco de pruebas, sin sketch.js, usa un viento suave.
   */
  function balanceoDelAire(ahora) {
    const segundos = ahora * 0.001;
    const fuerza = typeof fuerzaViento === 'number' ? limitar(fuerzaViento, 0, 1) : 0.35;
    const empuje = typeof direccionViento === 'number' ? direccionViento : 1;

    const vaiven =
      Math.sin(segundos * VIENTO_PLANTA.velocidad + 0.7) * 0.45 + fuerza * 0.55;
    const deriva = Math.sin(segundos * VIENTO_PLANTA.velocidadDeriva + 2.1) * 0.2;

    return (vaiven + deriva) * VIENTO_PLANTA.amplitud * empuje;
  }

  /**
   * Florecimiento sin tocar la ilustración: la corola se descubre desde su
   * base hacia afuera con un degradado radial. El tallo y las hojas quedan
   * siempre completos, así que la flor nunca se separa del suelo.
   */
  function revelarCorola(x, y, ancho, alto) {
    const centroX = x + ancho * COROLA.centroX;
    const centroY = y + alto * COROLA.centroY;
    const radio =
      alto *
      (COROLA.radioMinimo + (COROLA.radioMaximo - COROLA.radioMinimo) * florecimiento);
    const borde = radio + alto * COROLA.suavizado;

    ctx.save();

    const degradado = ctx.createRadialGradient(centroX, centroY, 0, centroX, centroY, borde);
    degradado.addColorStop(0, 'rgba(0, 0, 0, 1)');
    degradado.addColorStop(radio / borde, 'rgba(0, 0, 0, 1)');
    degradado.addColorStop(1, 'rgba(0, 0, 0, 0)');

    // `destination-in` deja solo lo que cae dentro del degradado.
    ctx.globalCompositeOperation = 'destination-in';
    ctx.fillStyle = degradado;
    ctx.fillRect(x, y, ancho, alto);

    // El tallo y las hojas no florecen: se repintan completos.
    ctx.globalCompositeOperation = 'source-over';
    ctx.beginPath();
    ctx.rect(x, y + alto * COROLA.juntura, ancho, alto * (1 - COROLA.juntura));
    ctx.clip();
    ctx.drawImage(imagenFlor, x, y, ancho, alto);

    ctx.restore();
  }

  /**
   * Punto del tallo en t = 0 (base) .. 1 (punta). El tallo de la ilustración
   * es recto y vertical, así que las partículas nacen exactamente sobre él.
   */
  function puntoDelTallo(base, altura, t) {
    return { x: base.x, y: base.y - altura * t };
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
