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

  /* ---------- Orquídea: piezas y montaje ---------- */

  /**
   * Geometría del montaje, en fracciones de `full` (el alto máximo de la
   * orquídea = `alto del lienzo * def.altura`). Los números salieron de la
   * lámina de referencia de los tres estados.
   *
   * `ancho` es el ancho dibujado de la pieza; `ax`/`ay` es el punto de esa
   * pieza que se clava en el esqueleto (0..1, con origen arriba a la
   * izquierda). Así una hoja gira desde su base y un pétalo desde su unión.
   */
  const ORQUIDEA = {
    /** El tallo crece entre estos dos largos (fracciones de `full`). */
    talloMinimo: 0.26,
    talloMaximo: 0.76,
    /** El tallo nativo se angosta: se dibuja más fino que su proporción. */
    talloAngosto: 0.5,
    /** El tallo nativo ocupa 0.82 de su ancho en la punta y 0.516 en la base. */
    talloPunta: 0.82,
    talloBase: 0.516,
    /** La flor se apoya apenas por encima de la punta del tallo. */
    florSobrePunta: 0.045,
    /** Segundos que tarda la flor principal en abrirse entera. */
    aperturaSegundos: 1.8,
    /** Segundos que tardan las ramas y la flor azul en desplegarse. */
    ramasSegundos: 1.2,
    /** Cierre: más rápido que la apertura, para que no quede deformada. */
    cierreSegundos: 1,
    cierreRamasSegundos: 0.8,
    /** Las ramas arrancan cuando la flor principal ya lleva un tercio. */
    ramasDesdeApertura: 0.33,
    piezas: {
      tallo: { archivo: 'orquidea-tallo.png' },
      hojaBaseIzquierda: { archivo: 'orquidea-hoja-base-izquierda.png', ancho: 0.22, ax: 0.95, ay: 0.68 },
      hojaBaseDerecha: { archivo: 'orquidea-hoja-base-derecha.png', ancho: 0.24, ax: 0.05, ay: 0.68 },
      hojaAlta: { archivo: 'orquidea-hoja-alta.png', ancho: 0.36, ax: 0.06, ay: 0.97 },
      hojaPequena: { archivo: 'orquidea-hoja-pequena.png', ancho: 0.16, ax: 0.06, ay: 0.97 },
      capulloPrincipal: { archivo: 'orquidea-capullo-principal.png', ancho: 0.095, ax: 0.455, ay: 1 },
      capulloLateral: { archivo: 'orquidea-capullo-lateral.png', ancho: 0.075, ax: 0.5, ay: 0.5 },
      petaloSuperior: { archivo: 'orquidea-petalo-superior.png', ancho: 0.205, ax: 0.5, ay: 0.97 },
      petaloFrontalIzquierdo: { archivo: 'orquidea-petalo-frontal-izquierdo.png', ancho: 0.205, ax: 0.92, ay: 0.5 },
      petaloFrontalDerecho: { archivo: 'orquidea-petalo-frontal-derecho.png', ancho: 0.205, ax: 0.08, ay: 0.5 },
      petaloInferiorIzquierdo: { archivo: 'orquidea-petalo-inferior-izquierdo.png', ancho: 0.155, ax: 0.9, ay: 0.5 },
      petaloInferiorDerecho: { archivo: 'orquidea-petalo-inferior-derecho.png', ancho: 0.155, ax: 0.1, ay: 0.5 },
      corazon: { archivo: 'orquidea-corazon.png', ancho: 0.165, ax: 0.5, ay: 0.55 },
      pistilo: { archivo: 'orquidea-pistilo.png', ancho: 0.056, ax: 0.5, ay: 0.88 },
      azulAtras: { archivo: 'orquidea-flor-azul-atras.png', ancho: 0.195, ax: 0.5, ay: 0.5 },
      azulPetalos: { archivo: 'orquidea-flor-azul-petalos.png', ancho: 0.185, ax: 0.5, ay: 0.5 },
      azulCorazon: { archivo: 'orquidea-flor-azul-corazon.png', ancho: 0.077, ax: 0.5, ay: 0.5 },
      azulPistilo: { archivo: 'orquidea-flor-azul-pistilo.png', ancho: 0.04, ax: 0.5, ay: 0.5 },
      ramaDerecha: { archivo: 'orquidea-rama-derecha.png' },
      ramaIzquierda: { archivo: 'orquidea-rama-izquierda.png' },
    },
    /**
     * La flor azul viene en dos PNG agrupados. Los tres pétalos de atrás
     * (`azulAtras`) están SEPARADOS entre sí y se pueden recortar limpios, así
     * que cada uno se anima con su propio giro. Los dos frontales
     * (`azulPetalos`) están unidos por el centro: se animan como una unidad,
     * tal como pide el recorte.
     */
    azulAtrasRecortes: [
      { x: 1117, y: 0, w: 1264, h: 1216, fase: 0 },
      { x: 0, y: 760, w: 806, h: 813, fase: 2.1 },
      { x: 1193, y: 1776, w: 872, h: 712, fase: 4.2 },
    ],
    /** Un pétalo por entrada, con su posición y su retardo de apertura. */
    petalos: [
      { clave: 'petaloSuperior', x: 0, y: 0.012, retardo: 0, giroCerrado: 0, escalaCerrada: 0.5, fase: 0 },
      { clave: 'petaloFrontalIzquierdo', x: -0.065, y: 0.01, retardo: 0.14, giroCerrado: 0.55, escalaCerrada: 0.35, fase: 1.7 },
      { clave: 'petaloFrontalDerecho', x: 0.065, y: 0.01, retardo: 0.14, giroCerrado: -0.55, escalaCerrada: 0.35, fase: 3.1 },
      { clave: 'petaloInferiorIzquierdo', x: -0.008, y: 0.075, retardo: 0.28, giroCerrado: 0.45, escalaCerrada: 0.4, fase: 4.2 },
      { clave: 'petaloInferiorDerecho', x: 0.008, y: 0.075, retardo: 0.28, giroCerrado: -0.45, escalaCerrada: 0.4, fase: 5.5 },
    ],
    /** Las ramas nacen del tallo y terminan en cada flor. */
    ramaDerecha: { archivo: 'orquidea-rama-derecha.png', anchoNativo: 2202, altoNativo: 1832, ax: 0.06, ay: 0.96, tx: 0.94, ty: 0.04 },
    ramaIzquierda: { archivo: 'orquidea-rama-izquierda.png', anchoNativo: 2199, altoNativo: 1984, ax: 0.94, ay: 0.98, tx: 0.06, ty: 0.02 },
    // Puntos del esqueleto, en fracciones de `full` con origen en la base.
    unionDerecha: { x: 0.011, y: 0.4 },
    unionIzquierda: { x: 0, y: 0.345 },
    centroAzul: { x: 0.185, y: 0.565 },
    centroCapulloLateral: { x: -0.195, y: 0.505 },
    /**
     * La flor principal florece en orden: el pétalo superior primero, después
     * los frontales y al final los inferiores y el corazón. La apertura es un
     * estado propio, no el `florecimiento` genérico: acá abrir la mano dispara
     * las ramas, no la corola.
     */
  };


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
      id: 'orquidea',
      /**
       * Es la única entrada de montaje: `personalizado` desvía el dibujo a
       * `dibujarOrquidea()`. La interacción sigue siendo la misma (crecimiento
       * con el puño, inclinación, sacudida y viento); lo que cambia es que sus
       * piezas se animan por separado con un estado propio.
       */
      archivo: 'orquidea-tallo.png',
      personalizado: 'orquidea',
      // Centrada y a escala de protagonista: es la única planta del catálogo.
      x: 0.5,
      altura: 0.44,
      capaSuelo: 2,
      separacionSuelo: 0.01,
      talloX: 0.5,
      faseViento: 3.6,
      // Todo el montaje viene con alfa: no hay fondo que recortar.
      toleranciaFondo: 0,
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
   * La planta que publica el porcentaje y la que lee sketch.js. Se marca con
   * `principal: true` en el catálogo; si ninguna lo declara, se usa la última.
   * Hoy el catálogo tiene solo la orquídea, así que es ella la que alimenta el
   * follaje y al personaje.
   */
  const principal =
    plantas.find((planta) => planta.def.principal) || plantas[plantas.length - 1];

  function crearPlanta(def) {
    return {
      def,
      imagen: null,
      partes: null, // solo la orquídea: piezas del montaje por clave
      partesListas: 0,
      lista: false,
      proporcion: 1, // ancho / alto, se lee al cargar la ilustración
      crecimiento: 0, // valor mostrado (suavizado) 0..1
      florecimiento: 0, // revelado de la corola 0..1
      // Secuencia propia de la orquídea. En las demás plantas queda en 0.
      orquidea: { llegoArriba: false, apertura: 0, ramas: 0 },
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
    if (planta.def.personalizado === 'orquidea') {
      cargarOrquidea(planta);
      return;
    }

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
   * Carga las piezas del montaje de la orquídea. Cada archivo entra a
   * `planta.partes` con su clave; recién cuando terminaron todos (bien o mal)
   * la planta queda `lista`, y las piezas que falten simplemente no se dibujan.
   */
  function cargarOrquidea(planta) {
    const piezas = Object.entries(ORQUIDEA.piezas);
    planta.partes = {};
    planta.partesListas = 0;

    const terminar = () => {
      planta.partesListas += 1;
      if (planta.partesListas === piezas.length) {
        planta.proporcion = 1;
        planta.lista = true;
      }
    };

    for (const [clave, pieza] of piezas) {
      const imagen = new Image();
      imagen.onload = () => {
        planta.partes[clave] = imagen;
        terminar();
      };
      imagen.onerror = () => {
        console.warn(
          '[planta] No se pudo cargar ' + pieza.archivo + '; falta esa pieza de la orquídea.'
        );
        terminar();
      };
      imagen.src = pieza.archivo;
    }
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
    actualizarOrquidea(dt);
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

  /* ---------- Orquídea: secuencia ---------- */

  /**
   * La flor solo se muestra abierta cuando se juntan DOS condiciones:
   *
   *   1. el tallo está en la punta (crecimiento >= 0.985);
   *   2. hay una mano abierta.
   *
   * Si falta cualquiera de las dos, la orquídea vuelve a su estado normal de
   * planta crecida: el capullo cerrado en la punta del tallo y sin ramas. La
   * apertura NO es acumulativa: es reversible. Si el puño baja, la flor se
   * cierra y vuelve a ser capullo, porque si no el capullo/flor quedaría
   * estirado sobre un tallo más corto.
   *
   * `ramas` sigue a `apertura` con la misma lógica: abrir la mano en la punta
   * despliega ramas, flor azul, capullo lateral y hoja pequeña; cerrar la mano
   * (o bajar) las repliega.
   */
  function actualizarOrquidea(dt) {
    const planta = plantas.find((candidata) => candidata.def.personalizado === 'orquidea');
    if (!planta) return;

    const estado = planta.orquidea;
    const enLaPunta = planta.crecimiento >= 0.985;
    const manoAbierta = hayManoAbierta();

    estado.llegoArriba = enLaPunta;

    // Abrir es más lento que cerrar: la flor se despliega pétalo por pétalo,
    // pero cuando la mano se va o el tallo baja, se recoge enseguida.
    const objetivoApertura = enLaPunta && manoAbierta ? 1 : 0;
    const velocidadApertura =
      objetivoApertura > estado.apertura
        ? 1 / ORQUIDEA.aperturaSegundos
        : 1 / ORQUIDEA.cierreSegundos;
    estado.apertura = moverHacia(
      estado.apertura,
      objetivoApertura,
      velocidadApertura * dt
    );

    const objetivoRamas =
      estado.apertura >= ORQUIDEA.ramasDesdeApertura && manoAbierta && enLaPunta ? 1 : 0;
    const velocidadRamas =
      objetivoRamas > estado.ramas
        ? 1 / ORQUIDEA.ramasSegundos
        : 1 / ORQUIDEA.cierreRamasSegundos;
    estado.ramas = moverHacia(estado.ramas, objetivoRamas, velocidadRamas * dt);

    // `sketch.js` y el panel leen `florecimiento`: para la orquídea es su
    // apertura real, no la mano abierta sola.
    planta.florecimiento = estado.apertura;
  }

  /** Avanza un valor hacia un objetivo como máximo `paso` por frame. */
  function moverHacia(actual, objetivo, paso) {
    if (paso <= 0 || actual === objetivo) return actual;
    if (Math.abs(objetivo - actual) <= paso) return objetivo;
    return actual + Math.sign(objetivo - actual) * paso;
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
    if (!planta.lista) return;

    // La orquídea no es una ilustración única: tiene su propio montaje.
    if (planta.def.personalizado === 'orquidea') {
      dibujarOrquidea(planta, ancho, alto, ahora, contexto);
      return;
    }

    if (planta.crecimiento <= 0.004) return;

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

  /* ---------- Orquídea: dibujo del montaje ---------- */

  /**
   * Dibuja una pieza del montaje anclada en `(cx, cy)`.
   *
   * `ancho` es el ancho dibujado; el alto sale de la proporción real del PNG.
   * `ax`/`ay` eligen qué punto del dibujo queda clavado en el esqueleto, así
   * la pieza gira desde su base (hojas) o desde su unión (pétalos, ramas).
   */
  function dibujarParte(c, imagen, cx, cy, ancho, giro, ax, ay, alfa) {
    if (!imagen || ancho <= 0) return;
    if (alfa !== undefined && alfa <= 0.001) return;

    const alto = ancho * (imagen.naturalHeight / imagen.naturalWidth);
    c.save();
    if (alfa !== undefined) c.globalAlpha *= alfa;
    c.translate(cx, cy);
    if (giro) c.rotate(giro);
    c.drawImage(imagen, -ax * ancho, -ay * alto, ancho, alto);
    c.restore();
  }

  /**
   * Una rama del montaje: se escala de forma UNIFORME para que el trazo no se
   * deforme, se ancla en su extremo inferior y se gira para que el extremo
   * superior caiga exactamente en `punta`.
   */
  function dibujarRama(c, imagen, datos, union, punta, alfa) {
    if (!imagen || alfa <= 0.001) return;

    const vx = (datos.tx - datos.ax) * datos.anchoNativo;
    const vy = (datos.ty - datos.ay) * datos.altoNativo;
    const largoNativo = Math.hypot(vx, vy);
    if (largoNativo <= 0) return;

    const dx = punta.x - union.x;
    const dy = punta.y - union.y;
    const escala = Math.hypot(dx, dy) / largoNativo;

    const ancho = datos.anchoNativo * escala;
    const alto = datos.altoNativo * escala;

    c.save();
    c.globalAlpha *= alfa;
    c.translate(union.x, union.y);
    c.rotate(Math.atan2(dy, dx) - Math.atan2(vy, vx));
    c.drawImage(imagen, -datos.ax * ancho, -datos.ay * alto, ancho, alto);
    c.restore();
  }

  /**
   * Vaivén propio de una rama: la punta se mueve un poco respecto de su unión.
   * La flor que se dibuja después usa ESA misma punta, así nunca se separan.
   */
  function puntaConVaiven(punta, ahora, fase, ramas, full) {
    const fuerza = limitar(ramas, 0, 1) * full;
    return {
      x: punta.x + Math.sin(ahora * 0.0011 + fase) * 0.008 * fuerza,
      y: punta.y + Math.cos(ahora * 0.0014 + fase * 1.7) * 0.004 * fuerza,
    };
  }

  /**
   * La orquídea completa. Comparte con las demás plantas el crecimiento, la
   * inclinación, la sacudida, el viento y las partículas; lo propio es el
   * montaje: el tallo se estira con el crecimiento y la flor se arma con
   * piezas que se abren y se mecen por separado.
   */
  function dibujarOrquidea(planta, ancho, alto, ahora, contexto = ctx) {
    const piezas = planta.partes;
    if (!piezas || !piezas.tallo) return;

    const c = contexto || ctx;
    const base = baseDeLaPlanta(planta.def, ancho, alto);
    const full = alto * planta.def.altura;
    const estado = planta.orquidea;
    const apertura = estado.apertura;

    // ---- hojas de la base: fijas, no acompañan el balanceo del tallo ----
    const hojaIzq = ORQUIDEA.piezas.hojaBaseIzquierda;
    const hojaDer = ORQUIDEA.piezas.hojaBaseDerecha;
    dibujarParte(c, piezas.hojaBaseIzquierda, base.x - 0.006 * full, base.y + 0.002 * full, hojaIzq.ancho * full, 0.03, hojaIzq.ax, hojaIzq.ay);
    dibujarParte(c, piezas.hojaBaseDerecha, base.x + 0.006 * full, base.y + 0.002 * full, hojaDer.ancho * full, -0.03, hojaDer.ax, hojaDer.ay);

    c.save();

    // Todo lo que nace del tallo pivota en la base: el suelo queda quieto.
    const anguloPlanta =
      inclinacion + temblorDeSacudida(ahora) + balanceoDelAire(ahora, planta);
    c.translate(base.x, base.y);
    c.rotate(anguloPlanta);

    // ---- tallo: se estira con el crecimiento ----
    const largo = (ORQUIDEA.talloMinimo + (ORQUIDEA.talloMaximo - ORQUIDEA.talloMinimo) * planta.crecimiento) * full;
    const anchoTallo = largo * (piezas.tallo.naturalWidth / piezas.tallo.naturalHeight) * ORQUIDEA.talloAngosto;
    c.drawImage(piezas.tallo, -ORQUIDEA.talloBase * anchoTallo, -largo, anchoTallo, largo);

    const puntaTallo = (ORQUIDEA.talloPunta - ORQUIDEA.talloBase) * anchoTallo;
    const centroFlor = {
      x: puntaTallo,
      y: -largo - ORQUIDEA.florSobrePunta * full,
    };

    // ---- hoja alta: se despliega con la apertura de la flor ----
    const hojaAlta = ORQUIDEA.piezas.hojaAlta;
    if (apertura > 0.001) {
      const t = suavizar(limitar((apertura - 0.15) / 0.7, 0, 1));
      dibujarParte(
        c,
        piezas.hojaAlta,
        0.03 * full,
        0.005 * full,
        hojaAlta.ancho * full * (0.35 + 0.65 * t),
        -0.2 - (1 - t) * 0.35,
        hojaAlta.ax,
        hojaAlta.ay,
        Math.min(1, apertura * 3)
      );
    }

    // ---- hoja pequeña: al lado IZQUIERDO de la base y chica ----
    const hojaPequena = ORQUIDEA.piezas.hojaPequena;
    if (estado.ramas > 0.001) {
      const t = suavizar(limitar((estado.ramas - 0.15) / 0.7, 0, 1));
      dibujarParte(
        c,
        piezas.hojaPequena,
        -0.045 * full,
        0.005 * full,
        hojaPequena.ancho * full * (0.35 + 0.65 * t),
        -1.03 - (1 - t) * 0.3,
        hojaPequena.ax,
        hojaPequena.ay,
        Math.min(1, estado.ramas * 3)
      );
    }

    // ---- flor principal: capullo mientras no abrió, pétalos después ----
    // El capullo se ancla en la PUNTA del tallo, no en el centro de la flor:
    // así queda pegado al borde del tallo y no flotando.
    if (apertura < 0.6) {
      const capullo = ORQUIDEA.piezas.capulloPrincipal;
      const resto = 1 - limitar(apertura / 0.6, 0, 1);
      dibujarParte(
        c,
        piezas.capulloPrincipal,
        puntaTallo,
        -largo + 0.006 * full,
        capullo.ancho * full * resto,
        0.03,
        capullo.ax,
        capullo.ay,
        Math.min(1, resto * 2)
      );
    }

    if (apertura > 0.001) {
      ORQUIDEA.petalos.forEach((petalo, petalosIndice) => {
        const pieza = ORQUIDEA.piezas[petalo.clave];
        const t = suavizar(limitar((apertura - petalo.retardo) / (1 - petalo.retardo), 0, 1));
        const escala = petalo.escalaCerrada + (1 - petalo.escalaCerrada) * t;
        // Cada pétalo tiene su propio vaivén: la flor respira, no se abre en bloque.
        const vaiven = Math.sin(ahora * (0.0009 + petalosIndice * 0.00012) + petalo.fase) * 0.025 * t;
        dibujarParte(
          c,
          piezas[petalo.clave],
          centroFlor.x + petalo.x * full,
          centroFlor.y + petalo.y * full,
          pieza.ancho * full * escala,
          (1 - t) * petalo.giroCerrado + vaiven,
          pieza.ax,
          pieza.ay,
          Math.min(1, t * 2.5)
        );
      });

      const corazonT = suavizar(limitar((apertura - 0.45) / 0.55, 0, 1));
      if (corazonT > 0) {
        const corazon = ORQUIDEA.piezas.corazon;
        const pistilo = ORQUIDEA.piezas.pistilo;
        const escala = 0.35 + 0.65 * corazonT;
        dibujarParte(c, piezas.corazon, centroFlor.x, centroFlor.y - 0.005 * full, corazon.ancho * full * escala, 0, corazon.ax, corazon.ay, corazonT);
        dibujarParte(c, piezas.pistilo, centroFlor.x + 0.004 * full, centroFlor.y + 0.008 * full, pistilo.ancho * full * escala, 0, pistilo.ax, pistilo.ay, corazonT);
      }
    }

    // ---- ramas, capullo lateral y flor azul ----
    if (estado.ramas > 0.001) {
      const ramas = estado.ramas;
      const unionDerecha = { x: ORQUIDEA.unionDerecha.x * full, y: -ORQUIDEA.unionDerecha.y * full };
      const unionIzquierda = { x: ORQUIDEA.unionIzquierda.x * full, y: -ORQUIDEA.unionIzquierda.y * full };
      const centroAzul = {
        x: ORQUIDEA.centroAzul.x * full,
        y: -ORQUIDEA.centroAzul.y * full,
      };
      const centroCapullo = {
        x: ORQUIDEA.centroCapulloLateral.x * full,
        y: -ORQUIDEA.centroCapulloLateral.y * full,
      };

      const puntaDerecha = puntaConVaiven(centroAzul, ahora, 0.6, ramas, full);
      const puntaIzquierda = puntaConVaiven(centroCapullo, ahora, 2.9, ramas, full);

      const avanceDerecha = limitar(ramas / 0.75, 0, 1);
      const avanceIzquierda = limitar((ramas - 0.05) / 0.75, 0, 1);

      dibujarRama(c, piezas.ramaDerecha, ORQUIDEA.ramaDerecha, unionDerecha, puntaDerecha, Math.min(1, avanceDerecha * 2));
      dibujarRama(c, piezas.ramaIzquierda, ORQUIDEA.ramaIzquierda, unionIzquierda, puntaIzquierda, Math.min(1, avanceIzquierda * 2));

      const capullo = ORQUIDEA.piezas.capulloLateral;
      const avanceCapullo = Math.min(1, avanceIzquierda * 2);
      dibujarParte(
        c,
        piezas.capulloLateral,
        puntaIzquierda.x,
        puntaIzquierda.y - 0.035 * full,
        capullo.ancho * full * avanceCapullo,
        0.06,
        capullo.ax,
        capullo.ay,
        avanceCapullo
      );

      if (ramas > 0.25) {
        const t = suavizar(limitar((ramas - 0.25) / 0.55, 0, 1));
        const escala = 0.4 + 0.6 * t;

        // Pétalos de atrás: los tres recortes del mismo PNG giran por separado.
        const atras = ORQUIDEA.piezas.azulAtras;
        const imgAtras = piezas.azulAtras;
        if (imgAtras) {
          const anchoAtras = atras.ancho * full * escala;
          const altoAtras = anchoAtras * (imgAtras.naturalHeight / imgAtras.naturalWidth);
          for (const recorte of ORQUIDEA.azulAtrasRecortes) {
            const giro = Math.sin(ahora * 0.0012 + recorte.fase) * 0.02 * t;
            c.save();
            c.globalAlpha *= t;
            c.translate(puntaDerecha.x, puntaDerecha.y);
            c.rotate(0.03 + giro);
            c.drawImage(
              imgAtras,
              recorte.x,
              recorte.y,
              recorte.w,
              recorte.h,
              -anchoAtras * 0.5 + (recorte.x / imgAtras.naturalWidth) * anchoAtras,
              -altoAtras * 0.5 + (recorte.y / imgAtras.naturalHeight) * altoAtras,
              (recorte.w / imgAtras.naturalWidth) * anchoAtras,
              (recorte.h / imgAtras.naturalHeight) * altoAtras
            );
            c.restore();
          }
        }

        // Pétalos frontales: vienen unidos por el centro, van como una unidad.
        const petalos = ORQUIDEA.piezas.azulPetalos;
        const corazon = ORQUIDEA.piezas.azulCorazon;
        const pistilo = ORQUIDEA.piezas.azulPistilo;
        dibujarParte(c, piezas.azulPetalos, puntaDerecha.x + 0.004 * full, puntaDerecha.y + 0.012 * full, petalos.ancho * full * escala, 0.03, petalos.ax, petalos.ay, t);
        dibujarParte(c, piezas.azulCorazon, puntaDerecha.x + 0.008 * full, puntaDerecha.y - 0.001 * full, corazon.ancho * full * escala, 0, corazon.ax, corazon.ay, t);
        dibujarParte(c, piezas.azulPistilo, puntaDerecha.x + 0.014 * full, puntaDerecha.y + 0.014 * full, pistilo.ancho * full * escala, 0.12, pistilo.ax, pistilo.ay, t);
      }
    }

    c.restore();
  }

  /** Curva de suavizado corta, reutilizada por el montaje. */
  function suavizar(t) {
    return t * t * (3 - 2 * t);
  }

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

  /**
   * Vuelve al estado de una carga limpia: altura, floración, inclinación,
   * sacudida, partículas y secuencia de la orquídea. No recarga imágenes.
   */
  function reiniciar() {
    objetivo = 0;
    indiceNivel = 0;
    objetivoFloracion = 0;
    intensidadSacudida = 0;
    congelarAltura = false;
    inclinacion = 0;
    velocidadInclinacion = 0;
    objetivoInclinacion = 0;

    for (const clave of Object.keys(estadosSacudida)) delete estadosSacudida[clave];

    for (const planta of plantas) {
      planta.crecimiento = 0;
      planta.florecimiento = 0;
      planta.particulas = [];
      planta.acumuladorEmision = 0;
      planta.orquidea.llegoArriba = false;
      planta.orquidea.apertura = 0;
      planta.orquidea.ramas = 0;
    }
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
        // Solo la orquídea los usa; en el resto quedan en 0.
        apertura: planta.orquidea.apertura,
        ramas: planta.orquidea.ramas,
      })),
    crecimientoDe: (id) => {
      const planta = plantas.find((candidata) => candidata.def.id === id);
      return planta ? planta.crecimiento : null;
    },
    /**
     * Estado de la secuencia de la orquídea, para comprobarla sin cámara:
     *   llegoArriba → el puño completó la altura máxima
     *   apertura    → 0..1, flor principal abriéndose pétalo por pétalo
     *   ramas       → 0..1, ramas, flor azul, capullo lateral y hoja pequeña
     */
    orquidea: () => {
      const planta = plantas.find((candidata) => candidata.def.id === 'orquidea');
      if (!planta) return null;
      return {
        cargada: planta.lista,
        piezas: planta.partes ? Object.keys(planta.partes).length : 0,
        crecimiento: planta.crecimiento,
        llegoArriba: planta.orquidea.llegoArriba,
        apertura: planta.orquidea.apertura,
        ramas: planta.orquidea.ramas,
      };
    },
    /**
     * Vuelve todo el jardín al estado inicial: es el "reiniciar" de la
     * experiencia, el mismo estado con el que arranca una carga limpia.
     * Sirve para repetir la secuencia de la orquídea sin recargar la página.
     */
    reiniciar: () => reiniciar(),
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
