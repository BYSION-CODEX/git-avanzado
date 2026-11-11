/* ============================================================
   PLANTA — crecimiento por gesto de puño cerrado

   Capa independiente sobre el lienzo de p5. El paisaje ya tiene su propio
   bucle de viento, pero la planta NO se dibuja ahí: este canvas transparente
   del mismo tamaño que el de p5 se limpia y se repinta a 60 fps, y así el
   crecimiento no obliga a repintar el fondo ni el pasto.

   Cada planta es una ilustración propia (`flor.png`, `planta-morada.png`, …):
   acá no se redibuja ninguna, solo se escalan, se inclinan, se sacuden y se
   revelan. La interacción es UNA sola y la comparten todas.

   Entradas: obtenerManos() de sketch.js (manos normalizadas 0..1, ya
   suavizadas, con su gesto). Salidas: las plantas y el porcentaje en el
   panel de cámara (el de la planta central, que es el contrato de siempre).

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

  /* ---------- Catálogo de plantas ---------- */

  /**
   * Una entrada = una ilustración + su lugar en el escenario.
   *
   * La interacción —crecimiento con el puño, floración con la mano abierta,
   * sacudida y inclinación— es una sola y la comparten todas las plantas. Acá
   * solo se decide de dónde nace cada imagen, cuánto mide y qué parte se
   * revela al florecer. Para sumar otra planta alcanza con agregar un objeto a
   * esta lista: no hay que tocar ninguna interacción.
   *
   * El orden de la lista es el orden de dibujo (la primera queda debajo).
   * `x` va en fracción del ancho del lienzo; `altura`, en fracción del alto al
   * 100% de crecimiento. La proporción NO se declara: sale del PNG al cargar.
   */
  const PLANTAS = [
    {
      id: 'arbol_colorido',
      archivo: 'arbol-colorido.png',
      /**
       * `paisaje: true` = esta entrada NO se dibuja en #planta-overlay.
       *
       * Ese canvas va por encima del de p5, así que cualquier planta del
       * catálogo queda DELANTE del personaje. Este árbol tiene que quedar
       * detrás, así que sketch.js le presta su capa viva y lo pinta llamando a
       * `plantaDebug.dibujarPaisaje()`. La interacción es la misma de siempre:
       * este flag solo cambia quién dibuja.
       */
      paisaje: true,
      // Va entre los árboles lejanos y los medios, sobre el suelo medio y más
      // alto que ellos (0.16–0.23): se lee como el ejemplar que domina el fondo.
      x: 0.38,
      altura: 0.4,
      capaSuelo: 1,
      separacionSuelo: 0.005,
      // El tronco serpentea; esto solo decide por dónde nace el polen.
      talloX: 0.42,
      faseViento: 5.3,
      // Viene en RGB con fondo blanco: mismo recorte al cargar que las demás.
      toleranciaFondo: 28,
      /**
       * Tres copas. El revelado nace donde el tronco se abre en dos y
       * `juntura` repinta todo lo que queda por debajo, así el tronco nunca se
       * despega del suelo. `radioMaximo` cubre la copa más lejana.
       */
      corola: {
        centroX: 0.46,
        centroY: 0.42,
        radioMinimo: 0.1,
        radioMaximo: 0.66,
        suavizado: 0.06,
        juntura: 0.56,
      },
    },
    {
      id: 'planta_azul',
      archivo: 'planta-azul.png',
      // Segunda planta de fondo: va PRIMERA en la lista para quedar debajo de
      // las tres del primer plano, sobre el suelo medio y a escala de los
      // árboles de ese plano (0.16–0.23 del alto).
      x: 0.86,
      altura: 0.24,
      capaSuelo: 1,
      separacionSuelo: 0.005,
      // El tallo de esta ilustración está a la izquierda del centro.
      talloX: 0.44,
      faseViento: 4.1,
      // Igual que las otras dos: viene en RGB sin alfa.
      toleranciaFondo: 28,
      // Dos cabezuelas en el extremo superior y las hojas a media altura. El
      // revelado corta por debajo de las cabezuelas, así el tallo y las hojas
      // quedan siempre unidos al suelo.
      corola: {
        centroX: 0.5,
        centroY: 0.13,
        radioMinimo: 0.06,
        radioMaximo: 0.42,
        suavizado: 0.03,
        juntura: 0.28,
      },
    },
    {
      id: 'planta_central',
      archivo: 'flor.png',
      // Es la que publica el porcentaje y la que lee sketch.js.
      principal: true,
      x: 0.5,
      altura: 0.42,
      capaSuelo: 2,
      separacionSuelo: 0.01,
      // Su tallo es recto y centrado en la ilustración.
      talloX: 0.5,
      // Desfase del vaivén ambiental, para que no se muevan al unísono.
      faseViento: 0,
      // `flor.png` ya viene con alfa: no hay fondo que recortar.
      toleranciaFondo: 0,
      /**
       * Geometría del florecimiento, en fracciones del alto de la ilustración.
       * La corola se descubre desde su base —donde nace del tallo— hacia
       * afuera. Es un revelado, no una deformación: los pétalos no se estiran,
       * se dejan de tapar. `radioMaximo` cubre la corola a florecimiento 1.
       * `juntura` es la altura por debajo de la cual la imagen se repinta
       * completa: el tallo y las hojas no florecen. `null` desactiva el
       * revelado (la ilustración se dibuja entera siempre).
       */
      corola: {
        centroX: 0.5,
        centroY: 0.3,
        radioMinimo: 0.13,
        radioMaximo: 0.4,
        suavizado: 0.03,
        juntura: 0.318,
      },
    },
    {
      id: 'planta_morada',
      archivo: 'planta-morada.png',
      // A la izquierda de la central, más baja y sin invadir su espacio: se
      // lee como el primer plano del jardín.
      x: 0.25,
      altura: 0.36,
      capaSuelo: 2,
      separacionSuelo: 0.01,
      // El tallo de esta ilustración está un poco a la izquierda del centro.
      talloX: 0.48,
      faseViento: 1.4,
      // Viene en RGB sin alfa: el fondo blanco se recorta al cargar.
      toleranciaFondo: 28,
      // Las tres campanas viven en el tercio superior; las hojas, justo debajo.
      // El revelado nace en el centro del manojo y `juntura` corta por encima
      // de las hojas, así el tallo y las hojas nunca se separan del suelo.
      corola: {
        centroX: 0.5,
        centroY: 0.26,
        radioMinimo: 0.12,
        radioMaximo: 0.5,
        suavizado: 0.03,
        juntura: 0.36,
      },
    },
    {
      id: 'planta_naranja',
      archivo: 'planta-naranja.png',
      // A la derecha de la central, misma altura que la morada: el jardín queda
      // simétrico y ninguna de las dos invade el centro.
      x: 0.76,
      altura: 0.36,
      capaSuelo: 2,
      separacionSuelo: 0.01,
      // Tallo recto y centrado en la ilustración.
      talloX: 0.5,
      faseViento: 2.8,
      // También viene en RGB sin alfa: mismo recorte al cargar.
      toleranciaFondo: 28,
      // Cinco flores en abanico sobre el tercio superior. El revelado nace en
      // el centro del abanico y `juntura` corta por debajo de la flor más baja,
      // así el tallo nunca se despega del suelo.
      corola: {
        centroX: 0.5,
        centroY: 0.24,
        radioMinimo: 0.1,
        radioMaximo: 0.48,
        suavizado: 0.03,
        juntura: 0.42,
      },
    },
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
    amplitud: 0.045, // rad a viento máximo (~3°)
    velocidad: 1.7, // rad/s del vaivén, como los árboles
    velocidadDeriva: 0.35, // rad/s de la deriva lenta
  };

  /* ---------- Estado ---------- */

  let lienzo = null;
  let ctx = null;
  let anchoCSS = 0;
  let altoCSS = 0;

  /**
   * Estado COMPARTIDO por todas las plantas: los objetivos salen de las manos,
   * y cada planta los alcanza con su propio suavizado.
   */
  let objetivo = 0; // nivel elegido 0..1
  let indiceNivel = 0; // nivel actual, para la histéresis
  let objetivoFloracion = 0;
  let ultimoFrame = 0;
  let ultimoTexto = 0;

  let intensidadSacudida = 0; // 0..1, ya suavizada
  let congelarAltura = false; // true cuando la mano va rápido o está sacudiendo
  let inclinacion = 0; // radianes, ya suavizada
  let velocidadInclinacion = 0; // rad/s, para el resorte
  let objetivoInclinacion = 0;
  let relojDebug = 0;
  const estadosSacudida = {}; // un estado por mano (clave: handedness)

  /** Una instancia por entrada del catálogo: imagen y animación propias. */
  const plantas = PLANTAS.map(crearPlanta);

  /**
   * La central es la que publica el porcentaje y la que lee sketch.js.
   * Se marca con `principal: true` en el catálogo y NO se busca por posición:
   * el orden de la lista es el orden de dibujo, y una planta de fondo puede ir
   * primero sin romper el contrato.
   */
  const principal =
    plantas.find((planta) => planta.def.principal) || plantas[plantas.length - 1];

  function crearPlanta(def) {
    return {
      def,
      imagen: null,
      lista: false,
      proporcion: 1, // ancho / alto, se lee al cargar la ilustración
      crecimiento: 0, // valor mostrado (suavizado) 0..1
      florecimiento: 0, // revelado de la corola 0..1
      particulas: [],
      acumuladorEmision: 0,
    };
  }

  /* ---------- Arranque ---------- */

  function iniciar() {
    lienzo = document.getElementById('planta-overlay');
    if (!lienzo) {
      console.warn('[planta] No se encontró #planta-overlay.');
      return;
    }

    ctx = lienzo.getContext('2d');
    if (!ctx) return;

    cargarImagenes();
    requestAnimationFrame(bucle);
  }

  /**
   * Cada ilustración se carga con callbacks, como el personaje: hasta que no
   * está lista esa planta no se dibuja. Si falta un archivo, la experiencia
   * sigue andando y solo se pierde esa planta.
   */
  function cargarImagenes() {
    for (const planta of plantas) cargarImagen(planta);
  }

  function cargarImagen(planta) {
    const imagen = new Image();
    imagen.onload = () => {
      planta.proporcion = imagen.naturalWidth / imagen.naturalHeight;
      planta.imagen = recortarFondo(planta, imagen);
      planta.lista = true;
    };
    imagen.onerror = () => {
      console.warn(
        '[planta] No se pudo cargar ' + planta.def.archivo + '; esa planta no se dibuja.'
      );
    };
    imagen.src = planta.def.archivo;
    planta.imagen = imagen;
  }

  /**
   * Un PNG puede venir con fondo blanco y sin canal alfa (es el caso de
   * `planta-morada.png`). Se recorta al cargar con el MISMO algoritmo del
   * personaje: inunda desde los bordes en vez de aplicar un umbral global, así
   * los blancos internos de la ilustración —brillos, bordes de pétalo— quedan
   * intactos. `toleranciaFondo: 0` desactiva el recorte.
   *
   * `recortarFondoClaro()` vive en sketch.js y se reutiliza acá a propósito:
   * un solo algoritmo de recorte en todo el proyecto.
   */
  function recortarFondo(planta, imagen) {
    const tolerancia = planta.def.toleranciaFondo;
    if (!tolerancia) return imagen;

    if (typeof recortarFondoClaro !== 'function') {
      console.warn(
        '[planta] Falta recortarFondoClaro() de sketch.js; ' +
          planta.def.archivo +
          ' se dibuja con su fondo.'
      );
      return imagen;
    }

    const lienzo = document.createElement('canvas');
    lienzo.width = imagen.naturalWidth;
    lienzo.height = imagen.naturalHeight;

    const contexto = lienzo.getContext('2d');
    if (!contexto) return imagen;

    contexto.drawImage(imagen, 0, 0);

    let datos;
    try {
      datos = contexto.getImageData(0, 0, lienzo.width, lienzo.height);
    } catch (error) {
      // Origen cruzado: el canvas queda manchado y no se puede leer.
      console.warn('[planta] No se pudo leer ' + planta.def.archivo + ': ' + error.message);
      return imagen;
    }

    recortarFondoClaro(datos.data, lienzo.width, lienzo.height, tolerancia);
    limpiarBlancosEncerrados(datos.data);

    contexto.putImageData(datos, 0, 0);

    return lienzo;
  }

  /**
   * El fondo que la ilustración encierra —el hueco entre dos campanas, por
   * ejemplo— no lo alcanza ninguna inundación desde el borde. Se limpia solo el
   * blanco PURO: en estas ilustraciones planas el dibujo nunca llega a 250 en
   * los tres canales, así que no se come ningún detalle.
   */
  function limpiarBlancosEncerrados(pixeles) {
    for (let p = 0; p < pixeles.length; p += 4) {
      if (pixeles[p + 3] === 0) continue;
      if (pixeles[p] >= 250 && pixeles[p + 1] >= 250 && pixeles[p + 2] >= 250) {
        pixeles[p + 3] = 0;
      }
    }
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

    // Orden del catálogo: la primera queda debajo. Las entradas de paisaje no
    // se dibujan acá: las pinta sketch.js en su capa viva, detrás del personaje,
    // con `plantaDebug.dibujarPaisaje()`.
    for (const planta of plantas) {
      if (planta.def.paisaje) continue;
      dibujarPlanta(planta, anchoCSS, altoCSS, ahora);
    }
    for (const planta of plantas) {
      if (planta.def.paisaje) continue;
      dibujarParticulas(planta);
    }

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

    // El objetivo es uno solo; cada planta lo alcanza con su propio estado,
    // así crecen juntas sin compartir la variable de dibujo.
    for (const planta of plantas) {
      planta.crecimiento += (objetivo - planta.crecimiento) * factor;
      if (Math.abs(objetivo - planta.crecimiento) < 0.001) planta.crecimiento = objetivo;
    }
  }

  /**
   * El florecimiento depende SOLO de la mano abierta y es independiente del
   * crecimiento: abrir o cerrar la mano no toca la altura de la planta.
   */
  function actualizarFlorecimiento(dt) {
    objetivoFloracion = hayManoAbierta() ? 1 : 0;

    const factor = 1 - Math.exp(-VELOCIDAD_FLORACION * dt);

    for (const planta of plantas) {
      planta.florecimiento += (objetivoFloracion - planta.florecimiento) * factor;

      if (Math.abs(objetivoFloracion - planta.florecimiento) < 0.001) {
        planta.florecimiento = objetivoFloracion;
      }
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
    for (const planta of plantas) actualizarParticulasDe(planta, dt);
  }

  function actualizarParticulasDe(planta, dt) {
    if (intensidadSacudida > 0.12 && planta.crecimiento > 0.05) {
      planta.acumuladorEmision += EMISION_MAXIMA * intensidadSacudida * dt;

      while (planta.acumuladorEmision >= 1 && planta.particulas.length < MAX_PARTICULAS) {
        emitirParticula(planta);
        planta.acumuladorEmision -= 1;
      }
    } else {
      planta.acumuladorEmision = 0;
    }

    for (const particula of planta.particulas) {
      // Roce: frenan rápido y quedan flotando.
      const roce = Math.exp(-1.6 * dt);
      particula.vx *= roce;
      particula.vy = particula.vy * roce - 18 * dt;

      particula.x += particula.vx * dt;
      particula.y += particula.vy * dt;
      particula.vida -= dt;
    }

    planta.particulas = planta.particulas.filter((particula) => particula.vida > 0);
  }

  function emitirParticula(planta) {
    if (!anchoCSS || !altoCSS) return;

    const base = baseDeLaPlanta(planta.def, anchoCSS, altoCSS);
    const altura = altoCSS * planta.def.altura * planta.crecimiento;
    if (altura < 10) return;

    // Nacen a lo largo del tallo, con más densidad hacia las flores.
    const t = 0.35 + Math.random() * 0.7;
    const desplazamiento = altura * planta.proporcion * (planta.def.talloX - 0.5);
    const punto = puntoDelTallo(base, altura, t, desplazamiento);

    const escala = altoCSS * 0.1;
    const direccion = Math.random() * Math.PI * 2;
    const rapidez = escala * (0.25 + Math.random() * 0.75);
    const vida = 0.9 + Math.random() * 1.4;

    // Cada una con su tamaño, su velocidad y su duración: nada de copias iguales.
    planta.particulas.push({
      x: punto.x + (Math.random() - 0.5) * altura * 0.18,
      y: punto.y + (Math.random() - 0.5) * altura * 0.1,
      vx: Math.cos(direccion) * rapidez,
      vy: Math.sin(direccion) * rapidez - escala * 0.25,
      vida,
      vidaMax: vida,
      tamano: altoCSS * (0.0015 + Math.random() * 0.0035),
    });
  }

  function dibujarParticulas(planta, contexto = ctx) {
    if (planta.particulas.length === 0) return;

    const c = contexto || ctx;
    c.fillStyle = COLOR_POLEN;

    for (const particula of planta.particulas) {
      const alfa = Math.max(0, particula.vida / particula.vidaMax);
      if (alfa <= 0.01) continue;

      c.globalAlpha = alfa;
      c.beginPath();
      c.arc(particula.x, particula.y, particula.tamano, 0, Math.PI * 2);
      c.fill();
    }

    c.globalAlpha = 1;
  }

  /* ---------- Dibujo ---------- */

  /**
   * La ilustración entera, escalada de forma uniforme con el crecimiento y
   * anclada en el suelo: la base queda fija y la flor crece hacia arriba.
   * No se recorta ni se deforma, así que la proporción original se conserva.
   *
   * `contexto` permite dibujar en OTRO canvas 2D con las mismas coordenadas
   * (mismo ancho y alto lógicos). Lo usa sketch.js para el árbol de paisaje: la
   * animación es esta misma, solo cambia la capa donde termina el píxel.
   */
  function dibujarPlanta(planta, ancho, alto, ahora, contexto = ctx) {
    if (!planta.lista || planta.crecimiento <= 0.004) return;

    const c = contexto || ctx;
    const base = baseDeLaPlanta(planta.def, ancho, alto);
    const alturaDibujo = alto * planta.def.altura * planta.crecimiento;
    const anchoDibujo = alturaDibujo * planta.proporcion;
    const x = base.x - anchoDibujo * 0.5;
    const y = base.y - alturaDibujo;

    // El temblor pivota en la base, como un tallo real: no se traslada entero.
    c.save();

    const anguloPlanta =
      inclinacion + temblorDeSacudida(ahora) + balanceoDelAire(ahora, planta);

    if (Math.abs(anguloPlanta) > 0.001) {
      c.translate(base.x, base.y);
      c.rotate(anguloPlanta);
      c.translate(-base.x, -base.y);
    }

    c.drawImage(planta.imagen, x, y, anchoDibujo, alturaDibujo);

    // Con la mano abierta la corola se descubre; a 1 se ve la ilustración
    // completa y no hace falta enmascarar nada.
    if (planta.def.corola && planta.florecimiento < 0.999) {
      revelarCorola(planta, x, y, anchoDibujo, alturaDibujo, c);
    }

    c.restore();
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
   *
   * `faseViento` corre el reloj de cada planta para que no se muevan al unísono.
   */
  function balanceoDelAire(ahora, planta) {
    const segundos = ahora * 0.001 + planta.def.faseViento;
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
   *
   * La geometría es la de ESTA planta (`def.corola`): cada ilustración tiene
   * su corola en otro lugar, y así una no le impone sus números a la otra.
   */
  function revelarCorola(planta, x, y, ancho, alto, contexto = ctx) {
    const corola = planta.def.corola;
    const c = contexto || ctx;
    const centroX = x + ancho * corola.centroX;
    const centroY = y + alto * corola.centroY;
    const radio =
      alto * (corola.radioMinimo + (corola.radioMaximo - corola.radioMinimo) * planta.florecimiento);
    const borde = radio + alto * corola.suavizado;

    c.save();

    // `destination-in` borra TODO lo que la máscara no cubre, no solo el
    // rectángulo que se rellena. En un lienzo compartido eso se llevaría
    // puestas a las demás plantas, así que primero se acota el efecto a la
    // caja de ESTA ilustración.
    c.beginPath();
    c.rect(x, y, ancho, alto);
    c.clip();

    const degradado = c.createRadialGradient(centroX, centroY, 0, centroX, centroY, borde);
    degradado.addColorStop(0, 'rgba(0, 0, 0, 1)');
    degradado.addColorStop(radio / borde, 'rgba(0, 0, 0, 1)');
    degradado.addColorStop(1, 'rgba(0, 0, 0, 0)');

    // `destination-in` deja solo lo que cae dentro del degradado.
    c.globalCompositeOperation = 'destination-in';
    c.fillStyle = degradado;
    c.fillRect(x, y, ancho, alto);

    // El tallo y las hojas no florecen: se repintan completos.
    c.globalCompositeOperation = 'source-over';
    c.beginPath();
    c.rect(x, y + alto * corola.juntura, ancho, alto * (1 - corola.juntura));
    c.clip();
    c.drawImage(planta.imagen, x, y, ancho, alto);

    c.restore();
  }

  /**
   * Punto del tallo en t = 0 (base) .. 1 (punta). El tallo de la ilustración
   * es recto y vertical, así que las partículas nacen exactamente sobre él.
   */
  function puntoDelTallo(base, altura, t, desplazamientoX) {
    return { x: base.x + desplazamientoX, y: base.y - altura * t };
  }

  /**
   * Dónde nace la planta: sobre el borde real de la capa de suelo cercana.
   * bordeDeSuelo() y CAPAS_SUELO vienen de sketch.js, así que la base coincide
   * con la tierra dibujada y no queda flotando. La x y la altura salen de la
   * entrada del catálogo, no de un valor global.
   */
  function baseDeLaPlanta(def, ancho, alto) {
    const x = ancho * def.x;
    const horizonte = alto * 0.54;

    if (typeof bordeDeSuelo === 'function' && typeof CAPAS_SUELO !== 'undefined') {
      return {
        x,
        y: bordeDeSuelo(x, CAPAS_SUELO[def.capaSuelo], horizonte) + alto * def.separacionSuelo,
      };
    }

    return { x, y: horizonte + alto * 0.28 };
  }

  /* ---------- Lectura en pantalla ---------- */

  function pintarPorcentaje(ahora) {
    if (ahora - ultimoTexto < REFRESCO_TEXTO_MS) return;
    ultimoTexto = ahora;

    const elemento = document.getElementById('crecimiento-estado');
    if (!elemento) return;

    const porcentaje = Math.round(principal.crecimiento * 100);
    const floracion = Math.round(principal.florecimiento * 100);
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
  // Los métodos históricos hablan de la planta central (la que lee sketch.js);
  // `plantas()` y `crecimientoDe()` permiten mirar cualquiera del catálogo.
  window.plantaDebug = {
    nivelDesdeAltura: (y) => nivelDesdeAltura(y),
    crecimiento: () => principal.crecimiento,
    objetivo: () => objetivo,
    florecimiento: () => principal.florecimiento,
    sacudida: () => intensidadSacudida,
    inclinacion: () => inclinacion,
    particulas: () => principal.particulas.length,
    plantas: () =>
      plantas.map((planta) => ({
        id: planta.def.id,
        archivo: planta.def.archivo,
        cargada: planta.lista,
        crecimiento: planta.crecimiento,
        florecimiento: planta.florecimiento,
        particulas: planta.particulas.length,
        proporcion: planta.proporcion,
      })),
    crecimientoDe: (id) => {
      const planta = plantas.find((candidata) => candidata.def.id === id);
      return planta ? planta.crecimiento : null;
    },
    /**
     * Dibuja las entradas marcadas con `paisaje: true` en OTRO contexto 2D, con
     * las mismas coordenadas lógicas del lienzo. La usa sketch.js para el árbol
     * colorido: comparte la interacción entera, pero se pinta en la capa viva
     * del escenario para quedar detrás del personaje.
     *
     * Devuelve true si dibujó algo, así sketch.js puede saltearse la
     * composición cuando el árbol todavía no creció.
     */
    dibujarPaisaje: (contexto, ancho, alto, ahora) => {
      if (!contexto) return false;

      let dibujado = false;

      for (const planta of plantas) {
        if (!planta.def.paisaje) continue;
        dibujarPlanta(planta, ancho, alto, ahora, contexto);
        dibujarParticulas(planta, contexto);
        if (planta.lista && planta.crecimiento > 0.004) dibujado = true;
      }

      return dibujado;
    },
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
