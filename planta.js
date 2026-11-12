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

  /**
   * Base uniforme de las plantas: mismo margen desde el borde inferior del
   * lienzo, sin tocar el borde. Ya no siguen la curva del suelo porque lo que
   * importa es que el tulipán y la orquídea queden parejos y lejos del bosque.
   */
  const BASE_PLANTAS = {
    margenInferior: 0.06,
  };

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
    // La x sale del centro del tallo curvado a esa altura: si se ancla sobre el
    // eje vertical del montaje, la rama queda flotando a la derecha del tallo.
    unionDerecha: { x: -0.0175, y: 0.4 },
    unionIzquierda: { x: -0.02, y: 0.345 },
    centroAzul: { x: 0.185, y: 0.565 },
    centroCapulloLateral: { x: -0.195, y: 0.505 },
    /**
     * La flor principal florece en orden: el pétalo superior primero, después
     * los frontales y al final los inferiores y el corazón. La apertura es un
     * estado propio, no el `florecimiento` genérico: acá abrir la mano dispara
     * las ramas, no la corola.
     */
  };

  /* ---------- Tres flores: piezas y montaje ---------- */

  /**
   * La segunda planta del catálogo: una planta de tres flores montada con 14
   * piezas. La geometría está en fracciones de `full` (alto máximo de la
   * planta = `alto del lienzo * def.altura`) y salió de la lámina de los tres
   * estados.
   *
   * La secuencia es: puño (brote y capullo) → subir el puño (tallo y flor
   * principal) → mano abierta (ramas y flores laterales). El tallo se estira
   * con el crecimiento; las ramas solo se despliegan cuando el tallo llegó a la
   * punta y la mano está abierta.
   */
  const TRES_FLORES = {
    /** El tallo crece entre estos dos largos (fracciones de `full`). */
    talloMinimo: 0.2,
    talloMaximo: 0.72,
    /** El tallo nativo se angosta: se dibuja más fino que su proporción. */
    talloAngosto: 0.45,
    /** El tallo nativo ocupa 0.51 de su ancho en la punta y 0.69 en la base. */
    talloPunta: 0.51,
    talloBase: 0.69,
    /** La flor principal se abre al llegar arriba, con puño o sin él. */
    aperturaSegundos: 1.7,
    cierreSegundos: 1.1,
    /** La mano abierta despliega las ramas; cada flor se abre al final. */
    ramasSegundos: 1,
    cierreRamasSegundos: 0.7,
    florRamaSegundos: 0.85,
    ramasDesdeApertura: 0.55,
    piezas: {
      tallo: { archivo: 'tres-flores-tallo.png' },
      hojaBaseIzquierda: { archivo: 'tres-flores-hoja-base-izquierda.png' },
      hojaBaseDerechaAlta: { archivo: 'tres-flores-hoja-base-derecha-alta.png' },
      hojaBaseDerechaBaja: { archivo: 'tres-flores-hoja-base-derecha-baja.png' },
      hojaSuperiorIzquierda: { archivo: 'tres-flores-hoja-superior-izquierda.png' },
      hojaPequenaDerecha: { archivo: 'tres-flores-hoja-pequena-derecha.png' },
      ramaIzquierda: { archivo: 'tres-flores-rama-izquierda.png' },
      ramaDerecha: { archivo: 'tres-flores-rama-derecha.png' },
      florPrincipalAtras: { archivo: 'tres-flores-flor-principal-atras.png' },
      florPrincipalFrente: { archivo: 'tres-flores-flor-principal-frente.png' },
      florIzquierdaAtras: { archivo: 'tres-flores-flor-izquierda-atras.png' },
      florIzquierdaFrente: { archivo: 'tres-flores-flor-izquierda-frente.png' },
      florDerechaAtras: { archivo: 'tres-flores-flor-derecha-atras.png' },
      florDerechaFrente: { archivo: 'tres-flores-flor-derecha-frente.png' },
    },
    /**
     * Hojas de la base: van fuera del grupo que gira, clavadas en el suelo.
     * `x`/`y` están en fracciones de `full`; `giro` corrige la orientación
     * natural de cada PNG.
     */
    hojasBase: [
      { clave: 'hojaBaseIzquierda', ancho: 0.36, x: -0.005, y: 0.0, giro: -0.28, ax: 0.96, ay: 0.97 },
      { clave: 'hojaBaseDerechaAlta', ancho: 0.3, x: 0.012, y: 0.0, giro: 0.1, ax: 0.07, ay: 0.97 },
      { clave: 'hojaBaseDerechaBaja', ancho: 0.34, x: 0.012, y: 0.004, giro: 0, ax: 0.06, ay: 0.93 },
    ],
    /**
     * Hoja superior izquierda: se clava en el tallo a `t` de su largo actual,
     * así acompaña el crecimiento en vez de flotar sobre un tallo corto.
     */
    hojaSuperior: { clave: 'hojaSuperiorIzquierda', ancho: 0.17, t: 0.62, giro: 0, ax: 0.94, ay: 0.93 },
    /** Hoja pequeña derecha: se clava sobre la rama derecha, a `t` de su avance. */
    hojaPequena: { clave: 'hojaPequenaDerecha', ancho: 0.14, t: 0.55, x: 0.02, giro: 0.35, ax: 0.06, ay: 0.94 },
    /**
     * Ramas: `ax`/`ay` es el extremo que se clava en el tallo y `tx`/`ty` la
     * punta que cae en la flor. `anchoNativo`/`altoNativo` son los del PNG.
     */
    ramaIzquierda: { anchoNativo: 100, altoNativo: 102, ax: 0.94, ay: 0.95, tx: 0.03, ty: 0.03 },
    ramaDerecha: { anchoNativo: 125, altoNativo: 129, ax: 0.08, ay: 0.93, tx: 0.92, ty: 0.06 },
    /** Uniones en el tallo y puntas finales de cada rama (y positiva arriba). */
    unionIzquierda: { x: -0.005, y: 0.42 },
    puntaIzquierda: { x: -0.16, y: 0.52 },
    unionDerecha: { x: 0.005, y: 0.38 },
    puntaDerecha: { x: 0.145, y: 0.475 },
    /**
     * Cada flor son dos grupos: el trasero se dibuja primero y el frontal
     * encima. `ax`/`ay` es su punto de unión (se clava en la punta); `x`/`y`
     * es el desplazamiento respecto de esa punta ya abierta. Al cerrarse, ese
     * desplazamiento se reduce y el grupo se encoge: así nace el capullo.
     */
    florPrincipal: {
      atras: { clave: 'florPrincipalAtras', ancho: 0.28, ax: 0.5, ay: 0.98, x: 0.005, y: -0.005, escalaCerrada: 0.55, estiradoCerrado: 1.65 },
      frente: { clave: 'florPrincipalFrente', ancho: 0.32, ax: 0.63, ay: 0.98, x: 0.0, y: 0.02, escalaCerrada: 0.5, estiradoCerrado: 1.65 },
    },
    florIzquierda: {
      atras: { clave: 'florIzquierdaAtras', ancho: 0.145, ax: 0.74, ay: 0.98, x: -0.004, y: -0.004, escalaCerrada: 0.55, estiradoCerrado: 1.65 },
      frente: { clave: 'florIzquierdaFrente', ancho: 0.17, ax: 0.4, ay: 0.98, x: 0.004, y: 0.012, escalaCerrada: 0.5, estiradoCerrado: 1.65 },
    },
    florDerecha: {
      atras: { clave: 'florDerechaAtras', ancho: 0.195, ax: 0.5, ay: 0.98, x: 0.004, y: -0.004, escalaCerrada: 0.55, estiradoCerrado: 1.65 },
      frente: { clave: 'florDerechaFrente', ancho: 0.225, ax: 0.63, ay: 0.98, x: 0.0, y: 0.012, escalaCerrada: 0.5, estiradoCerrado: 1.65 },
    },
    /** El grupo trasero abre primero; el frontal entra cuando aquel ya abrió. */
    tiemposFlor: { atrasDesde: 0, atrasHasta: 0.55, frenteDesde: 0.5, frenteHasta: 1 },
    /** La rama derecha arranca un poco después que la izquierda. */
    retardoRamaDerecha: 0.18,
  };

  /* ---------- Planta derecha: piezas y montaje ---------- */

  /**
   * La tercera planta del catálogo, a la derecha de la escena: la lámina de
   * flores colgantes. Está montada con las 20 piezas de `derecha-*.png`.
   *
   * La geometría está en fracciones de `full` (alto máximo de la planta =
   * `alto del lienzo * def.altura`) con origen en la base y la y hacia arriba.
   * Los números salen de medir la lámina `planta_referencia.jpeg`: las cuatro
   * hojas de la base, el tallo en S y la posición de cada flor.
   *
   * La secuencia es: puño (hojas y brote con la bolita de capullo) → subir el
   * puño (tallo y flor de la punta) → mano abierta (ramas y sus flores).
   */
  const PLANTA_DERECHA = {
    /** El tallo crece entre estos dos largos (fracciones de `full`). */
    talloMinimo: 0.22,
    talloMaximo: 0.98,
    /** El tallo nativo ocupa 0.9965 de su ancho en la punta y 0.6404 en la base. */
    talloPunta: 0.9965,
    talloBase: 0.6404,
    /** La punta del tallo cae a esta fracción de su largo dibujado. */
    talloPuntaY: 0.9523,
    /** Las hojas de la base terminan de desplegarse con este crecimiento. */
    despliegueHojas: 0.16,
    /** La flor de la punta se abre en este tramo de la apertura. */
    florPuntaDesde: 0.5,
    /** Tramo de la apertura en el que el arco de la punta se despliega. */
    arcoTramo: 0.55,
    aperturaSegundos: 1.8,
    cierreSegundos: 1.1,
    /** La mano abierta despliega las ramas; cada flor abre al final. */
    ramasSegundos: 2.2,
    cierreRamasSegundos: 0.8,
    /** Tramo de `ramas` que tarda una flor de rama en abrirse. */
    florRamaTramo: 0.18,
    ramasDesdeApertura: 0.55,
    piezas: {
      tallo: { archivo: 'derecha-tallo.png' },
      baya: { archivo: 'derecha-baya.png' },
      arcoSuperior: { archivo: 'derecha-arco-superior.png' },
      florSuperior: { archivo: 'derecha-flor-superior.png' },
      rama2: { archivo: 'derecha-rama-2.png' },
      rama3: { archivo: 'derecha-rama-3.png' },
      rama4: { archivo: 'derecha-rama-4.png' },
      rama5: { archivo: 'derecha-rama-5.png' },
      ramaIzquierdaArriba: { archivo: 'derecha-rama-izquierda-arriba.png' },
      ramaIzquierdaAbajo: { archivo: 'derecha-rama-izquierda-abajo.png' },
      flor2: { archivo: 'derecha-flor-2.png' },
      flor3: { archivo: 'derecha-flor-3.png' },
      flor4: { archivo: 'derecha-flor-4.png' },
      flor5: { archivo: 'derecha-flor-5.png' },
      florIzquierdaArriba: { archivo: 'derecha-flor-izquierda-arriba.png' },
      florIzquierdaAbajo: { archivo: 'derecha-flor-izquierda-abajo.png' },
      hojaIzquierdaAtras: { archivo: 'derecha-hoja-izquierda-atras.png' },
      hojaDerechaAtras: { archivo: 'derecha-hoja-derecha-atras.png' },
      hojaIzquierdaAdelante: { archivo: 'derecha-hoja-izquierda-adelante.png' },
      hojaDerechaAdelante: { archivo: 'derecha-hoja-derecha-adelante.png' },
    },
    /**
     * Hojas de la base: van fuera del grupo que gira, clavadas en el suelo.
     * `ax`/`ay` es la base de la hoja dentro del PNG; `giro` corrige su
     * orientación natural. Las `detras` se dibujan antes del tallo y las otras
     * dos delante, como en la lámina.
     */
    hojas: [
      { clave: 'hojaIzquierdaAtras', ancho: 0.328, x: -0.012, y: 0, giro: 0.108, ax: 0.995, ay: 0.94, detras: true },
      { clave: 'hojaDerechaAtras', ancho: 0.197, x: 0.01, y: 0, giro: -0.171, ax: 0.033, ay: 0.997, detras: true },
      { clave: 'hojaIzquierdaAdelante', ancho: 0.329, x: 0.03, y: 0.02, giro: 3.247, ax: 0, ay: 0.919 },
      { clave: 'hojaDerechaAdelante', ancho: 0.397, x: 0.014, y: 0, giro: -0.108, ax: 0.004, ay: 0.935 },
    ],
    /**
     * La bolita del extremo es el capullo: vive en la punta del arco superior,
     * que al empezar es la misma punta del tallo.
     */
    baya: { ancho: 0.062, ax: 0.5, ay: 0.5, x: 0.004, y: 0.002 },
    /**
     * El arco de la punta: nace en la punta del tallo y termina en `punta`.
     * La flor 1 cuelga debajo del arco, a `florT` de su recorrido.
     */
    arcoSuperior: {
      anchoNativo: 306,
      altoNativo: 119,
      ax: 0,
      ay: 0.874,
      tx: 0.997,
      ty: 0.731,
      punta: { x: 0.295, y: 0.947 },
      florT: 0.4,
    },
    florSuperior: { ancho: 0.128, ax: 0.41, ay: 0, giro: 0.1, fase: 0.4 },
    /**
     * Ramas: `union` es el punto del tallo donde nacen y `punta` el extremo
     * donde cuelga su flor. `inicio`/`fin` reparten su crecimiento dentro de
     * `ramas`, de arriba hacia abajo. Cada flor abre cuando su rama llegó.
     */
    ramas: [
      {
        clave: 'rama2', flor: 'flor2',
        anchoNativo: 316, altoNativo: 149, ax: 0, ay: 0.886, tx: 0.997, ty: 0.597,
        union: { x: -0.045, y: 0.86 }, punta: { x: 0.096, y: 0.847 },
        florAncho: 0.132, florAx: 0.41, florGiro: 0.06, fase: 1.1,
        inicio: 0, fin: 0.24,
      },
      {
        clave: 'rama3', flor: 'flor3',
        anchoNativo: 222, altoNativo: 98, ax: 0, ay: 0.816, tx: 0.995, ty: 0.837,
        union: { x: -0.09, y: 0.79 }, punta: { x: 0.047, y: 0.708 },
        florAncho: 0.142, florAx: 0.4, florGiro: 0.02, fase: 2.3,
        inicio: 0.08, fin: 0.34,
      },
      {
        clave: 'rama4', flor: 'flor4',
        anchoNativo: 222, altoNativo: 98, ax: 0, ay: 0.816, tx: 0.995, ty: 0.837,
        union: { x: -0.13, y: 0.68 }, punta: { x: 0.063, y: 0.572 },
        florAncho: 0.128, florAx: 0.4, florGiro: 0.05, fase: 3.5,
        inicio: 0.18, fin: 0.46,
      },
      {
        clave: 'rama5', flor: 'flor5',
        anchoNativo: 245, altoNativo: 111, ax: 0, ay: 0.865, tx: 0.99, ty: 0.44,
        union: { x: -0.148, y: 0.56 }, punta: { x: 0.093, y: 0.429 },
        florAncho: 0.118, florAx: 0.41, florGiro: 0.02, fase: 4.7,
        inicio: 0.28, fin: 0.58,
      },
      {
        clave: 'ramaIzquierdaArriba', flor: 'florIzquierdaArriba',
        anchoNativo: 261, altoNativo: 199, ax: 0.992, ay: 0.87, tx: 0, ty: 0.12,
        union: { x: -0.14, y: 0.6 }, punta: { x: -0.309, y: 0.645 },
        florAncho: 0.122, florAx: 0.47, florGiro: -0.06, fase: 5.9,
        inicio: 0.38, fin: 0.7,
      },
      {
        clave: 'ramaIzquierdaAbajo', flor: 'florIzquierdaAbajo',
        anchoNativo: 188, altoNativo: 97, ax: 0.989, ay: 0.825, tx: 0, ty: 0.825,
        union: { x: -0.132, y: 0.44 }, punta: { x: -0.259, y: 0.479 },
        florAncho: 0.115, florAx: 0.47, florGiro: -0.06, fase: 0.7,
        inicio: 0.48, fin: 0.8,
      },
    ],
    /** Escala del capullo cuando la flor todavía no abrió. */
    escalaCerrada: 0.5,
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
      id: 'tres_flores',
      /**
       * Planta de montaje: `personalizado` desvía el dibujo a
       * `dibujarTresFlores()`. Comparte con la orquídea la detección de mano,
       * la calibración de altura, la inclinación, la sacudida, el viento y las
       * partículas; lo propio es su secuencia de tres flores.
       *
       * Va primera en la lista (se dibuja debajo) y a la izquierda de la
       * escena. `altura` es menor que la de la orquídea para que las tres
       * flores tengan aire alrededor y la protagonista siga siendo la central.
       */
      archivo: 'tres-flores-tallo.png',
      personalizado: 'tres-flores',
      x: 0.22,
      altura: 0.46,
      talloX: 0.5,
      faseViento: 1.4,
      // Todas las piezas vienen con alfa: no hay fondo que recortar.
      toleranciaFondo: 0,
    },
    {
      id: 'planta_derecha',
      /**
       * Planta de montaje del lado derecho: `personalizado` desvía el dibujo a
       * `dibujarPlantaDerecha()`. Comparte con las demás la detección de mano,
       * la calibración de altura, la inclinación, la sacudida, el viento y las
       * partículas; lo propio es su secuencia de arcos y flores colgantes.
       */
      archivo: 'derecha-tallo.png',
      personalizado: 'planta-derecha',
      // A la derecha de la escena, lejos de la orquídea y de las tres flores.
      x: 0.79,
      altura: 0.44,
      talloX: 0.5,
      faseViento: 5.1,
      // Todas las piezas vienen con alfa: no hay fondo que recortar.
      toleranciaFondo: 0,
    },
    {
      id: 'orquidea',
      /**
       * Es la entrada de montaje principal: `personalizado` desvía el dibujo a
       * `dibujarOrquidea()`. La interacción sigue siendo la misma (crecimiento
       * con el puño, inclinación, sacudida y viento); lo que cambia es que sus
       * piezas se animan por separado con un estado propio.
       */
      archivo: 'orquidea-tallo.png',
      personalizado: 'orquidea',
      principal: true,
      // Centrada y a escala de protagonista.
      x: 0.5,
      altura: 0.5,
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

  const MAX_PARTICULAS = 160;
  const EMISION_MAXIMA = 70; // partículas por segundo a intensidad 1
  const COLOR_POLEN = '#e8d9a8';

  /* ---------- Destellos por movimiento de dedos ---------- */

  /**
   * Los dedos se miden RELATIVOS a la muñeca: así una mano que se traslada
   * entera no dispara destellos, pero unos dedos que se agitan sí. La
   * velocidad se promedia sobre las cinco puntas.
   */
  const DEDOS_PUNTA = [4, 8, 12, 16, 20];
  const VELOCIDAD_MINIMA_DEDOS = 0.55; // unidades normalizadas por segundo
  const ATAQUE_DEDOS = 12;
  const RELAJO_DEDOS = 4;
  const MAX_DESTELLOS = 90;
  const EMISION_DESTELLOS = 55; // destellos por segundo a intensidad 1
  const COLOR_DESTELLO = '#fff1bf';

  /* ---------- Inclinación ---------- */

  /** Zona muerta: por debajo de este ángulo la planta no se mueve (~6°). */
  const ANGULO_MUERTO = 0.1;

  /** Ángulo de mano que corresponde a la inclinación máxima (~34°). */
  const ANGULO_MAXIMO = 0.6;

  /** Inclinación máxima de la planta en radianes (~17°). */
  const INCLINACION_MAXIMA = 0.3;

  /**
   * La inclinación es un resorte amortiguado, no un lerp: la flor tiene inercia,
   * acompaña la mano y se asienta sola con un vaivén corto. Para una orquídea
   * alta conviene un resorte más blando que el original: sigue la mano sin
   * tirones y vuelve al centro sin rebotar.
   */
  const RESORTE_INCLINACION = {
    rigidezSeguir: 24,
    amortiguacionSeguir: 8.5,
    rigidezVolver: 12,
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
  let intensidadDedos = 0; // 0..1, agitación de las puntas respecto de la muñeca
  let congelarAltura = false; // true cuando la mano va rápido o está sacudiendo
  let inclinacion = 0; // radianes, ya suavizada
  let velocidadInclinacion = 0; // rad/s, para el resorte
  let objetivoInclinacion = 0;
  let relojDebug = 0;
  const estadosSacudida = {}; // un estado por mano (clave: handedness)
  const estadosDedos = {}; // un estado por mano (clave: handedness)

  /** Una instancia por entrada del catálogo: imagen y animación propias. */
  const plantas = PLANTAS.map(crearPlanta);

  /**
   * La planta que publica el porcentaje y la que lee sketch.js. Se marca con
   * `principal: true` en el catálogo; si ninguna lo declara, se usa la última.
   * La orquídea es la protagonista: su crecimiento alimenta el follaje y al
   * personaje.
   */
  const principal =
    plantas.find((planta) => planta.def.principal) || plantas[plantas.length - 1];

  function crearPlanta(def) {
    return {
      def,
      imagen: null,
      partes: null, // solo los montajes: piezas por clave
      partesListas: 0,
      lista: false,
      proporcion: 1, // ancho / alto, se lee al cargar la ilustración
      crecimiento: 0, // valor mostrado (suavizado) 0..1
      florecimiento: 0, // revelado de la corola 0..1
      // Secuencia propia de la orquídea. En las demás plantas queda en 0.
      orquidea: { llegoArriba: false, apertura: 0, ramas: 0, visibilidad: 0 },
      // Secuencia propia de la planta de tres flores. En las demás queda en 0.
      tresFlores: {
        llegoArriba: false,
        apertura: 0,
        ramas: 0,
        ramaIzquierda: 0,
        ramaDerecha: 0,
        florIzquierda: 0,
        florDerecha: 0,
        visibilidad: 0,
      },
      // Secuencia propia de la planta derecha. En las demás queda en 0.
      derecha: {
        llegoArriba: false,
        apertura: 0,
        ramas: 0,
        visibilidad: 0,
      },
      particulas: [],
      acumuladorEmision: 0,
      acumuladorDestellos: 0,
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

    if (planta.def.personalizado === 'tres-flores') {
      cargarTresFlores(planta);
      return;
    }

    if (planta.def.personalizado === 'planta-derecha') {
      cargarMontaje(planta, PLANTA_DERECHA, 'la planta derecha');
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
   * Carga las piezas de un montaje. Cada archivo entra a `planta.partes` con su
   * clave; recién cuando terminaron todos (bien o mal) la planta queda `lista`,
   * y las piezas que falten simplemente no se dibujan.
   */
  function cargarOrquidea(planta) {
    cargarMontaje(planta, ORQUIDEA, 'la orquídea');
  }

  function cargarTresFlores(planta) {
    cargarMontaje(planta, TRES_FLORES, 'la planta de tres flores');
  }

  function cargarMontaje(planta, montaje, etiqueta) {
    const piezas = Object.entries(montaje.piezas);
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
          '[planta] No se pudo cargar ' + pieza.archivo + '; falta esa pieza de ' + etiqueta + '.'
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
      dibujarParticulas(planta, ahora);
    }

    pintarPorcentaje(ahora);
  }

  /** Un paso de simulación: cada interacción es un estado independiente. */
  function actualizar(dt, ahora) {
    // La sacudida va primero: el crecimiento consulta su intensidad del frame
    // actual para no reaccionar al movimiento vertical de la propia sacudida.
    actualizarSacudida(ahora, dt);
    actualizarDedos(ahora, dt);
    actualizarCrecimiento(dt);
    actualizarFlorecimiento(dt);
    actualizarOrquidea(dt);
    actualizarTresFlores(dt, ahora);
    actualizarPlantaDerecha(dt);
    actualizarInclinacion(dt);
    actualizarParticulas(dt, ahora);
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
   * La secuencia de la orquídea es:
   *
   *   1. el tallo crece con el puño cerrado;
   *   2. al llegar a la punta (crecimiento >= 0.985) se abre la FLOR PRINCIPAL,
   *      con puño o sin él: el final del crecimiento, no de la floración;
   *   3. con la mano abierta en la punta se despliegan las RAMAS, la flor azul,
   *      el capullo lateral y la hoja pequeña. Solo las ramas dependen de la
   *      mano abierta.
   *
   * La apertura NO es acumulativa: es reversible. Si el puño baja, la flor se
   * cierra y vuelve a ser capullo, porque si no el capullo/flor quedaría
   * estirado sobre un tallo más corto. Cerrar la mano repliega solo las ramas.
   */
  function actualizarOrquidea(dt) {
    const planta = plantas.find((candidata) => candidata.def.personalizado === 'orquidea');
    if (!planta) return;

    const estado = planta.orquidea;
    const manos = typeof obtenerManos === 'function' ? obtenerManos() : [];
    const hayMano = manos.length > 0;
    const manoAbierta = manos.some((mano) => mano.gesto && mano.gesto.estado === 'abierta');
    const hayPuno = manos.some((mano) => mano.gesto && mano.gesto.estado === 'cerrado');
    const enLaPunta = planta.crecimiento >= 0.985;

    estado.llegoArriba = enLaPunta;

    // Sin mano en cuadro el paisaje queda vacío. El capullo aparece con el
    // puño (o cuando la planta ya creció); una mano abierta sin puño previo no
    // inventa una planta.
    const debeVerse = hayMano && (hayPuno || planta.crecimiento > 0.001 || estado.apertura > 0.001);
    const objetivoVisibilidad = debeVerse ? 1 : 0;
    const factorVisibilidad = 1 - Math.exp(-(objetivoVisibilidad ? 9 : 7) * dt);
    estado.visibilidad += (objetivoVisibilidad - estado.visibilidad) * factorVisibilidad;
    if (Math.abs(objetivoVisibilidad - estado.visibilidad) < 0.002) {
      estado.visibilidad = objetivoVisibilidad;
    }

    // La flor principal se abre al llegar a la punta, con puño o sin él: es el
    // final del crecimiento, no de la floración. Solo las ramas esperan a que
    // la mano se abra. Abrir es más lento que cerrar: la flor se despliega
    // pétalo por pétalo, pero si el tallo baja se recoge enseguida.
    const objetivoApertura = enLaPunta ? 1 : 0;
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

  /* ---------- Tres flores: secuencia ---------- */

  /**
   * Secuencia de la planta de tres flores:
   *
   *   1. con el puño aparece el brote (visibilidad) y el capullo principal en
   *      la punta del tallo corto;
   *   2. al llegar la punta se abre la flor principal, sin importar el gesto:
   *      primero el grupo trasero y después el frontal;
   *   3. con la mano abierta y la flor principal abierta crecen las ramas; cada
   *      una abre su flor al llegar a su largo final.
   *
   * La apertura no adelanta el crecimiento: si la mano se abre antes de
   * llegar, `objetivo` no cambia (no hay puño) y la altura se conserva.
   */
  function actualizarTresFlores(dt, ahora) {
    const planta = plantas.find(
      (candidata) => candidata.def.personalizado === 'tres-flores'
    );
    if (!planta) return;

    const estado = planta.tresFlores;
    const manos = typeof obtenerManos === 'function' ? obtenerManos() : [];
    const hayMano = manos.length > 0;
    const manoAbierta = manos.some((mano) => mano.gesto && mano.gesto.estado === 'abierta');
    const hayPuno = manos.some((mano) => mano.gesto && mano.gesto.estado === 'cerrado');
    const enLaPunta = planta.crecimiento >= 0.985;

    estado.llegoArriba = enLaPunta;

    const debeVerse =
      hayMano &&
      (hayPuno ||
        planta.crecimiento > 0.001 ||
        estado.apertura > 0.001 ||
        estado.ramas > 0.001);
    const objetivoVisibilidad = debeVerse ? 1 : 0;
    const factorVisibilidad = 1 - Math.exp(-(objetivoVisibilidad ? 9 : 7) * dt);
    estado.visibilidad += (objetivoVisibilidad - estado.visibilidad) * factorVisibilidad;
    if (Math.abs(objetivoVisibilidad - estado.visibilidad) < 0.002) {
      estado.visibilidad = objetivoVisibilidad;
    }

    // La flor principal se abre sola al llegar a la punta: no espera la mano
    // abierta, porque el puño fue el que llevó el tallo hasta allí.
    const objetivoApertura = enLaPunta ? 1 : 0;
    const velocidadApertura =
      objetivoApertura > estado.apertura
        ? 1 / TRES_FLORES.aperturaSegundos
        : 1 / TRES_FLORES.cierreSegundos;
    estado.apertura = moverHacia(estado.apertura, objetivoApertura, velocidadApertura * dt);

    // Las ramas necesitan la mano abierta, la punta y la flor principal ya
    // abierta. Abrir la mano antes no regala ramas: se conserva la altura y se
    // espera a que el puño complete la subida.
    const ramasActivas =
      enLaPunta && manoAbierta && estado.apertura >= TRES_FLORES.ramasDesdeApertura;
    const objetivoRamas = ramasActivas ? 1 : 0;
    const velocidadRamas =
      objetivoRamas > estado.ramas
        ? 1 / TRES_FLORES.ramasSegundos
        : 1 / TRES_FLORES.cierreRamasSegundos;
    estado.ramas = moverHacia(estado.ramas, objetivoRamas, velocidadRamas * dt);

    // Cada rama crece con su propio retardo y abre su flor al llegar al final.
    estado.ramaIzquierda = suavizar(limitar(estado.ramas / 0.82, 0, 1));
    estado.ramaDerecha = suavizar(
      limitar((estado.ramas - TRES_FLORES.retardoRamaDerecha) / 0.82, 0, 1)
    );

    const objetivoIzquierda = estado.ramaIzquierda >= 0.985 && ramasActivas ? 1 : 0;
    const objetivoDerecha = estado.ramaDerecha >= 0.985 && ramasActivas ? 1 : 0;
    const pasoFlor = dt / TRES_FLORES.florRamaSegundos;
    estado.florIzquierda = moverHacia(
      estado.florIzquierda,
      objetivoIzquierda,
      estado.florIzquierda < objetivoIzquierda ? pasoFlor : pasoFlor * 1.4
    );
    estado.florDerecha = moverHacia(
      estado.florDerecha,
      objetivoDerecha,
      estado.florDerecha < objetivoDerecha ? pasoFlor : pasoFlor * 1.4
    );
  }

  /* ---------- Planta derecha: secuencia ---------- */

  /**
   * Secuencia de la planta derecha:
   *
   *   1. con el puño aparece el brote: hojas de la base y tallo corto con la
   *      bolita como capullo en la punta;
   *   2. al subir el puño el tallo se estira y, al llegar a la punta, se
   *      despliega el arco superior y se abre la flor de la punta;
   *   3. con la mano abierta crecen las ramas desde su unión, de arriba hacia
   *      abajo, y cada flor abre cuando su rama llegó a su largo final.
   *
   * Abrir la mano antes de la altura máxima no adelanta nada: `ramas` necesita
   * la punta y la apertura. Bajar el puño recoge todo, así ninguna flor queda
   * colgada de un tallo más corto.
   */
  function actualizarPlantaDerecha(dt) {
    const planta = plantas.find(
      (candidata) => candidata.def.personalizado === 'planta-derecha'
    );
    if (!planta) return;

    const estado = planta.derecha;
    const manos = typeof obtenerManos === 'function' ? obtenerManos() : [];
    const hayMano = manos.length > 0;
    const manoAbierta = manos.some((mano) => mano.gesto && mano.gesto.estado === 'abierta');
    const hayPuno = manos.some((mano) => mano.gesto && mano.gesto.estado === 'cerrado');
    const enLaPunta = planta.crecimiento >= 0.985;

    estado.llegoArriba = enLaPunta;

    const debeVerse =
      hayMano &&
      (hayPuno ||
        planta.crecimiento > 0.001 ||
        estado.apertura > 0.001 ||
        estado.ramas > 0.001);
    const objetivoVisibilidad = debeVerse ? 1 : 0;
    const factorVisibilidad = 1 - Math.exp(-(objetivoVisibilidad ? 9 : 7) * dt);
    estado.visibilidad += (objetivoVisibilidad - estado.visibilidad) * factorVisibilidad;
    if (Math.abs(objetivoVisibilidad - estado.visibilidad) < 0.002) {
      estado.visibilidad = objetivoVisibilidad;
    }

    // La flor de la punta se abre sola al llegar arriba: la llevó el puño, y
    // abrir la mano la conserva.
    const objetivoApertura = enLaPunta ? 1 : 0;
    const velocidadApertura =
      objetivoApertura > estado.apertura
        ? 1 / PLANTA_DERECHA.aperturaSegundos
        : 1 / PLANTA_DERECHA.cierreSegundos;
    estado.apertura = moverHacia(estado.apertura, objetivoApertura, velocidadApertura * dt);

    // Las ramas necesitan la mano abierta, la punta y la flor de la punta ya
    // abierta. Abrir antes no regala ramas: se conserva la altura y se espera.
    const ramasActivas =
      enLaPunta && manoAbierta && estado.apertura >= PLANTA_DERECHA.ramasDesdeApertura;
    const objetivoRamas = ramasActivas ? 1 : 0;
    const velocidadRamas =
      objetivoRamas > estado.ramas
        ? 1 / PLANTA_DERECHA.ramasSegundos
        : 1 / PLANTA_DERECHA.cierreRamasSegundos;
    estado.ramas = moverHacia(estado.ramas, objetivoRamas, velocidadRamas * dt);

    // El panel y la oleada del paisaje leen `florecimiento`: acá es la flor de
    // la punta o, si ya abrieron, las ramas.
    planta.florecimiento = Math.max(estado.apertura, estado.ramas);
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

  /* ---------- Dedos: agitación para los destellos ---------- */

  /**
   * Velocidad de las puntas RELATIVA a la muñeca. Restar la muñeca es la clave:
   * trasladar la mano entera no agita los dedos, pero moverlos sí. Se promedian
   * las cinco puntas y se suaviza con ataque rápido y relajo lento, igual que
   * la sacudida, para que los destellos no parpadeen.
   */
  function actualizarDedos(ahora, dt) {
    let maxima = 0;
    const vistas = new Set();

    if (typeof obtenerManos === 'function') {
      for (const mano of obtenerManos()) {
        const puntos = mano.keypoints;
        if (!puntos || !puntos[0]) continue;

        const clave = mano.handedness || 'Mano';
        vistas.add(clave);

        if (!estadosDedos[clave]) {
          estadosDedos[clave] = { puntos: null, t: ahora, intensidad: 0 };
        }

        const estado = estadosDedos[clave];
        const muneca = puntos[0];
        const relativos = DEDOS_PUNTA.map((indice) => {
          const punta = puntos[indice];
          return punta ? { x: punta.x - muneca.x, y: punta.y - muneca.y } : null;
        });

        let velocidad = 0;
        if (estado.puntos) {
          const segundos = Math.max((ahora - estado.t) / 1000, 0.001);
          let suma = 0;
          let cuenta = 0;

          for (let i = 0; i < relativos.length; i += 1) {
            const actual = relativos[i];
            const previo = estado.puntos[i];
            if (!actual || !previo) continue;
            suma += Math.hypot(actual.x - previo.x, actual.y - previo.y);
            cuenta += 1;
          }

          if (cuenta > 0) velocidad = suma / cuenta / segundos;
        }

        estado.puntos = relativos;
        estado.t = ahora;

        const agitado = velocidad >= VELOCIDAD_MINIMA_DEDOS;
        const factor = 1 - Math.exp(-(agitado ? ATAQUE_DEDOS : RELAJO_DEDOS) * dt);
        estado.intensidad += ((agitado ? 1 : 0) - estado.intensidad) * factor;
        maxima = Math.max(maxima, estado.intensidad);
      }
    }

    // Manos que salieron: la intensidad se apaga sola.
    for (const clave of Object.keys(estadosDedos)) {
      if (vistas.has(clave)) continue;

      const estado = estadosDedos[clave];
      estado.intensidad += (0 - estado.intensidad) * (1 - Math.exp(-RELAJO_DEDOS * dt));

      if (estado.intensidad < 0.01) {
        delete estadosDedos[clave];
      } else {
        maxima = Math.max(maxima, estado.intensidad);
      }
    }

    intensidadDedos = maxima;
  }

  /* ---------- Partículas ---------- */

  function actualizarParticulas(dt, ahora) {
    for (const planta of plantas) actualizarParticulasDe(planta, dt, ahora);
  }

  function actualizarParticulasDe(planta, dt, ahora) {
    const visibilidad = visibilidadDe(planta);

    // Sin mano no hay planta: tampoco partículas dando vueltas.
    if (visibilidad <= 0.01) {
      planta.particulas = [];
      planta.acumuladorEmision = 0;
      planta.acumuladorDestellos = 0;
      return;
    }

    if (intensidadSacudida > 0.12 && planta.crecimiento > 0.05) {
      planta.acumuladorEmision += EMISION_MAXIMA * intensidadSacudida * dt;

      while (planta.acumuladorEmision >= 1 && planta.particulas.length < MAX_PARTICULAS) {
        emitirParticula(planta);
        planta.acumuladorEmision -= 1;
      }
    } else {
      planta.acumuladorEmision = 0;
    }

    // Destellos: los dispara la agitación de los dedos, no la muñeca.
    if (intensidadDedos > 0.12 && planta.crecimiento > 0.05) {
      planta.acumuladorDestellos += EMISION_DESTELLOS * intensidadDedos * dt;
      let destellos = 0;
      for (const particula of planta.particulas) {
        if (particula.destello) destellos += 1;
      }

      while (
        planta.acumuladorDestellos >= 1 &&
        destellos < MAX_DESTELLOS &&
        planta.particulas.length < MAX_PARTICULAS
      ) {
        emitirDestello(planta, ahora);
        planta.acumuladorDestellos -= 1;
        destellos += 1;
      }
    } else {
      planta.acumuladorDestellos = 0;
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

  /** 0..1: los montajes se ocultan cuando no hay ninguna mano en cuadro. */
  function visibilidadDe(planta) {
    if (planta.def.personalizado === 'orquidea') return planta.orquidea.visibilidad;
    if (planta.def.personalizado === 'tres-flores') return planta.tresFlores.visibilidad;
    if (planta.def.personalizado === 'planta-derecha') return planta.derecha.visibilidad;
    return 1;
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

  /**
   * Posición en pantalla del centro de la flor principal, aplicando el mismo
   * balanceo que el dibujo. Se usa para que los destellos nazcan en la flor y
   * no en el tallo.
   */
  function centroDeLaFlor(planta, ahora) {
    if (!anchoCSS || !altoCSS) return null;

    if (planta.def.personalizado === 'tres-flores') {
      const puntos = montajeTresFlores(planta, altoCSS, ahora);
      const base = baseDeLaPlanta(planta.def, anchoCSS, altoCSS);
      const angulo =
        inclinacion + temblorDeSacudida(ahora) + balanceoDelAire(ahora, planta);
      const cos = Math.cos(angulo);
      const sin = Math.sin(angulo);
      const localX = puntos.puntaTallo.x;
      const localY = puntos.puntaTallo.y - puntos.full * 0.12;

      return {
        x: base.x + localX * cos - localY * sin,
        y: base.y + localX * sin + localY * cos,
        full: puntos.full,
      };
    }

    if (planta.def.personalizado === 'planta-derecha') {
      const puntos = montajePlantaDerecha(planta, altoCSS, ahora);
      const base = baseDeLaPlanta(planta.def, anchoCSS, altoCSS);
      const angulo =
        inclinacion + temblorDeSacudida(ahora) + balanceoDelAire(ahora, planta);
      const cos = Math.cos(angulo);
      const sin = Math.sin(angulo);
      const localX = puntos.puntoFlorPunta.x;
      const localY = puntos.puntoFlorPunta.y;

      return {
        x: base.x + localX * cos - localY * sin,
        y: base.y + localX * sin + localY * cos,
        full: puntos.full,
      };
    }

    const full = altoCSS * planta.def.altura;
    const base = baseDeLaPlanta(planta.def, anchoCSS, altoCSS);
    const largo =
      (ORQUIDEA.talloMinimo + (ORQUIDEA.talloMaximo - ORQUIDEA.talloMinimo) * planta.crecimiento) *
      full;
    const tallo =
      planta.partes && planta.partes.tallo
        ? planta.partes.tallo.naturalWidth / planta.partes.tallo.naturalHeight
        : 0.168;
    const anchoTallo = largo * tallo * ORQUIDEA.talloAngosto;
    const localX = (ORQUIDEA.talloPunta - ORQUIDEA.talloBase) * anchoTallo;
    const localY = -largo - ORQUIDEA.florSobrePunta * full;

    const angulo = inclinacion + temblorDeSacudida(ahora) + balanceoDelAire(ahora, planta);
    const cos = Math.cos(angulo);
    const sin = Math.sin(angulo);

    return {
      x: base.x + localX * cos - localY * sin,
      y: base.y + localX * sin + localY * cos,
      full,
    };
  }

  /** Un brillito de polen que nace alrededor de la flor y flota hacia arriba. */
  function emitirDestello(planta, ahora) {
    const centro = centroDeLaFlor(planta, ahora);
    if (!centro) return;

    const radio = centro.full * 0.075;
    const angulo = Math.random() * Math.PI * 2;
    const distancia = Math.sqrt(Math.random()) * radio;
    const vida = 0.7 + Math.random() * 0.9;
    const escala = altoCSS * 0.1;

    planta.particulas.push({
      x: centro.x + Math.cos(angulo) * distancia,
      y: centro.y + Math.sin(angulo) * distancia,
      vx: (Math.random() - 0.5) * escala * 0.35,
      vy: -escala * (0.08 + Math.random() * 0.18),
      vida,
      vidaMax: vida,
      tamano: altoCSS * (0.0013 + Math.random() * 0.0018),
      destello: true,
      color: COLOR_DESTELLO,
      fase: Math.random() * Math.PI * 2,
    });
  }

  function dibujarParticulas(planta, ahora, contexto = ctx) {
    if (planta.particulas.length === 0) return;

    const visibilidad = visibilidadDe(planta);
    if (visibilidad <= 0.01) return;

    const c = contexto || ctx;

    for (const particula of planta.particulas) {
      const alfa = Math.max(0, particula.vida / particula.vidaMax) * visibilidad;
      if (alfa <= 0.01) continue;

      if (particula.destello) {
        // Destello: halo suave + núcleo que titila. Sin shadowBlur para que
        // siga siendo barato con decenas de partículas por frame.
        const titileo = 0.55 + 0.45 * Math.sin(particula.vida * 26 + particula.fase);
        c.fillStyle = particula.color;

        c.globalAlpha = alfa * 0.3 * titileo;
        c.beginPath();
        c.arc(particula.x, particula.y, particula.tamano * 3.4, 0, Math.PI * 2);
        c.fill();

        c.globalAlpha = alfa * titileo;
        c.beginPath();
        c.arc(particula.x, particula.y, particula.tamano, 0, Math.PI * 2);
        c.fill();
        continue;
      }

      c.globalAlpha = alfa;
      c.fillStyle = COLOR_POLEN;
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

    if (planta.def.personalizado === 'tres-flores') {
      dibujarTresFlores(planta, ancho, alto, ahora, contexto);
      return;
    }

    if (planta.def.personalizado === 'planta-derecha') {
      dibujarPlantaDerecha(planta, ancho, alto, ahora, contexto);
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
   * `escalaY` estira o comprime solo la vertical: el capullo lo usa para
   * cerrarse en una yema alta sin cambiar el ancho de los pétalos.
   * `ax`/`ay` eligen qué punto del dibujo queda clavado en el esqueleto, así
   * la pieza gira desde su base (hojas) o desde su unión (pétalos, ramas).
   */
  function dibujarParte(c, imagen, cx, cy, ancho, giro, ax, ay, alfa, escalaY = 1) {
    if (!imagen || ancho <= 0) return;
    if (alfa !== undefined && alfa <= 0.001) return;

    const alto = ancho * (imagen.naturalHeight / imagen.naturalWidth) * escalaY;
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

    // Sin mano no hay planta: se desvanece entera (hojas, tallo y flor).
    if (estado.visibilidad <= 0.002) return;

    const apertura = estado.apertura;

    c.save();
    c.globalAlpha *= estado.visibilidad;

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

    c.restore(); // grupo del tallo
    c.restore(); // visibilidad de la orquídea
  }

  /* ---------- Tres flores: geometría y dibujo ---------- */

  /**
   * Puntos del montaje en coordenadas LOCALES del grupo del tallo (origen en
   * la base, y negativa hacia arriba). La usan el dibujo y `plantaDebug`, así
   * la flor y su rama comparten exactamente la misma punta: no hay dos
   * geometrías que se puedan desincronizar.
   */
  function montajeTresFlores(planta, alto, ahora) {
    const full = alto * planta.def.altura;
    const estado = planta.tresFlores;

    const largo =
      (TRES_FLORES.talloMinimo +
        (TRES_FLORES.talloMaximo - TRES_FLORES.talloMinimo) * planta.crecimiento) *
      full;
    const tallo =
      planta.partes && planta.partes.tallo
        ? planta.partes.tallo.naturalWidth / planta.partes.tallo.naturalHeight
        : 0.111;
    const anchoTallo = largo * tallo * TRES_FLORES.talloAngosto;

    const puntaTallo = {
      x: (TRES_FLORES.talloPunta - TRES_FLORES.talloBase) * anchoTallo,
      y: -largo,
    };

    const unionIzquierda = {
      x: TRES_FLORES.unionIzquierda.x * full,
      y: -TRES_FLORES.unionIzquierda.y * full,
    };
    const unionDerecha = {
      x: TRES_FLORES.unionDerecha.x * full,
      y: -TRES_FLORES.unionDerecha.y * full,
    };
    const finalIzquierda = {
      x: TRES_FLORES.puntaIzquierda.x * full,
      y: -TRES_FLORES.puntaIzquierda.y * full,
    };
    const finalDerecha = {
      x: TRES_FLORES.puntaDerecha.x * full,
      y: -TRES_FLORES.puntaDerecha.y * full,
    };

    // La rama crece desde su unión; la flor se dibuja en ESA misma punta.
    const actualIzquierda = {
      x: unionIzquierda.x + (finalIzquierda.x - unionIzquierda.x) * estado.ramaIzquierda,
      y: unionIzquierda.y + (finalIzquierda.y - unionIzquierda.y) * estado.ramaIzquierda,
    };
    const actualDerecha = {
      x: unionDerecha.x + (finalDerecha.x - unionDerecha.x) * estado.ramaDerecha,
      y: unionDerecha.y + (finalDerecha.y - unionDerecha.y) * estado.ramaDerecha,
    };

    const puntaIzquierda = puntaConVaiven(
      actualIzquierda,
      ahora,
      2.2,
      estado.ramaIzquierda,
      full
    );
    const puntaDerecha = puntaConVaiven(actualDerecha, ahora, 4.1, estado.ramaDerecha, full);

    return {
      full,
      largo,
      anchoTallo,
      puntaTallo,
      unionIzquierda,
      unionDerecha,
      puntaIzquierda,
      puntaDerecha,
    };
  }

  /**
   * La planta de tres flores completa. Comparte con la orquídea el crecimiento,
   * la inclinación, la sacudida, el viento y las partículas; lo propio es el
   * montaje: tallo que se estira, capullo principal y dos ramas que abren su
   * flor en la punta.
   */
  function dibujarTresFlores(planta, ancho, alto, ahora, contexto = ctx) {
    const piezas = planta.partes;
    if (!piezas || !piezas.tallo) return;

    const estado = planta.tresFlores;
    if (estado.visibilidad <= 0.002) return;

    const c = contexto || ctx;
    const base = baseDeLaPlanta(planta.def, ancho, alto);
    const puntos = montajeTresFlores(planta, alto, ahora);
    const full = puntos.full;

    c.save();
    c.globalAlpha *= estado.visibilidad;

    // ---- hojas de la base: fijas, no acompañan el balanceo del tallo ----
    for (const hoja of TRES_FLORES.hojasBase) {
      dibujarParte(
        c,
        piezas[hoja.clave],
        base.x + hoja.x * full,
        base.y + hoja.y * full,
        hoja.ancho * full,
        hoja.giro,
        hoja.ax,
        hoja.ay
      );
    }

    c.save();

    // Todo lo que nace del tallo pivota en la base: el suelo queda quieto.
    const anguloPlanta =
      inclinacion + temblorDeSacudida(ahora) + balanceoDelAire(ahora, planta);
    c.translate(base.x, base.y);
    c.rotate(anguloPlanta);

    // ---- ramas: van detrás del tallo, así la unión queda limpia ----
    if (estado.ramaIzquierda > 0.01) {
      dibujarRama(
        c,
        piezas.ramaIzquierda,
        TRES_FLORES.ramaIzquierda,
        puntos.unionIzquierda,
        puntos.puntaIzquierda,
        Math.min(1, estado.ramaIzquierda * 3)
      );
    }
    if (estado.ramaDerecha > 0.01) {
      dibujarRama(
        c,
        piezas.ramaDerecha,
        TRES_FLORES.ramaDerecha,
        puntos.unionDerecha,
        puntos.puntaDerecha,
        Math.min(1, estado.ramaDerecha * 3)
      );
    }

    // ---- tallo: se estira con el crecimiento ----
    c.drawImage(
      piezas.tallo,
      -TRES_FLORES.talloBase * puntos.anchoTallo,
      -puntos.largo,
      puntos.anchoTallo,
      puntos.largo
    );

    // ---- hoja superior izquierda: clavada en el tallo actual ----
    const hojaSuperior = TRES_FLORES.hojaSuperior;
    const despliegueHoja = suavizar(limitar(planta.crecimiento / 0.15, 0, 1));
    if (despliegueHoja > 0.001) {
      dibujarParte(
        c,
        piezas[hojaSuperior.clave],
        puntos.puntaTallo.x * hojaSuperior.t,
        puntos.puntaTallo.y * hojaSuperior.t,
        hojaSuperior.ancho * full * (0.6 + 0.4 * despliegueHoja),
        hojaSuperior.giro,
        hojaSuperior.ax,
        hojaSuperior.ay,
        despliegueHoja
      );
    }

    // ---- flor principal: brote con el puño, flor abierta en la punta ----
    dibujarFlorMontada(
      c,
      piezas,
      TRES_FLORES.florPrincipal,
      puntos.puntaTallo,
      estado.apertura,
      full,
      ahora,
      0.4
    );

    // ---- hoja pequeña derecha: sobre la rama, debajo de su flor ----
    if (estado.ramaDerecha > 0.45) {
      const hojaPequena = TRES_FLORES.hojaPequena;
      const t = suavizar(limitar((estado.ramaDerecha - 0.45) / 0.3, 0, 1));
      const puntoHoja = {
        x:
          puntos.unionDerecha.x +
          (puntos.puntaDerecha.x - puntos.unionDerecha.x) * hojaPequena.t +
          hojaPequena.x * full,
        y:
          puntos.unionDerecha.y +
          (puntos.puntaDerecha.y - puntos.unionDerecha.y) * hojaPequena.t,
      };
      dibujarParte(
        c,
        piezas[hojaPequena.clave],
        puntoHoja.x,
        puntoHoja.y,
        hojaPequena.ancho * full * (0.5 + 0.5 * t),
        hojaPequena.giro,
        hojaPequena.ax,
        hojaPequena.ay,
        t
      );
    }

    // ---- flores laterales: en la punta exacta de cada rama ----
    if (estado.ramaIzquierda > 0.01) {
      dibujarFlorMontada(
        c,
        piezas,
        TRES_FLORES.florIzquierda,
        puntos.puntaIzquierda,
        estado.florIzquierda,
        full,
        ahora,
        1.9,
        Math.min(1, estado.ramaIzquierda * 3)
      );
    }
    if (estado.ramaDerecha > 0.01) {
      dibujarFlorMontada(
        c,
        piezas,
        TRES_FLORES.florDerecha,
        puntos.puntaDerecha,
        estado.florDerecha,
        full,
        ahora,
        3.3,
        Math.min(1, estado.ramaDerecha * 3)
      );
    }

    c.restore(); // grupo del tallo
    c.restore(); // visibilidad
  }

  /**
   * Una flor de dos grupos. El trasero se dibuja primero y el frontal encima,
   * siempre anclados en la misma punta: la del tallo o la de la rama.
   */
  function dibujarFlorMontada(c, piezas, flor, punto, apertura, full, ahora, fase, alfa = 1) {
    const tiempos = TRES_FLORES.tiemposFlor;
    dibujarGrupoFlor(
      c,
      piezas,
      flor.atras,
      punto,
      apertura,
      tiempos.atrasDesde,
      tiempos.atrasHasta,
      full,
      ahora,
      fase,
      alfa
    );
    dibujarGrupoFlor(
      c,
      piezas,
      flor.frente,
      punto,
      apertura,
      tiempos.frenteDesde,
      tiempos.frenteHasta,
      full,
      ahora,
      fase + 1.7,
      alfa
    );
  }

  /**
   * Un grupo de pétalos. Al cerrarse no solo se encoge: su desplazamiento
   * respecto de la punta también se reduce, así los dos grupos se acercan y el
   * capullo queda armado con las mismas piezas de la flor abierta.
   */
  function dibujarGrupoFlor(c, piezas, grupo, punto, apertura, desde, hasta, full, ahora, fase, alfa) {
    const imagen = piezas[grupo.clave];
    if (!imagen) return;

    const t = suavizar(limitar((apertura - desde) / (hasta - desde), 0, 1));
    const escala = grupo.escalaCerrada + (1 - grupo.escalaCerrada) * t;
    const estirado = 1 + ((grupo.estiradoCerrado || 1) - 1) * (1 - t);
    const cercania = 0.25 + 0.75 * t;
    const vaiven = Math.sin(ahora * 0.0011 + fase) * 0.02 * t;

    dibujarParte(
      c,
      imagen,
      punto.x + grupo.x * full * cercania,
      punto.y + grupo.y * full * cercania,
      grupo.ancho * full * escala,
      vaiven,
      grupo.ax,
      grupo.ay,
      alfa,
      estirado
    );
  }

  /* ---------- Planta derecha: geometría y dibujo ---------- */

  /**
   * Puntos del montaje en coordenadas LOCALES del grupo del tallo (origen en la
   * base, y negativa hacia arriba). La usan el dibujo, `centroDeLaFlor()` y
   * `plantaDebug`, así la flor y su arco comparten exactamente la misma punta.
   *
   * El arco de la punta nace en la punta del tallo: mientras la flor no se
   * abrió, su punta es la misma del tallo, y por eso la bolita-capullo acompaña
   * al brote desde el primer frame.
   */
  function montajePlantaDerecha(planta, alto, ahora) {
    const full = alto * planta.def.altura;
    const estado = planta.derecha;

    const largo =
      (PLANTA_DERECHA.talloMinimo +
        (PLANTA_DERECHA.talloMaximo - PLANTA_DERECHA.talloMinimo) * planta.crecimiento) *
      full;
    const tallo =
      planta.partes && planta.partes.tallo
        ? planta.partes.tallo.naturalWidth / planta.partes.tallo.naturalHeight
        : 0.2565;
    const anchoTallo = largo * tallo;

    const puntaTallo = {
      x: (PLANTA_DERECHA.talloPunta - PLANTA_DERECHA.talloBase) * anchoTallo,
      y: -largo * PLANTA_DERECHA.talloPuntaY,
    };

    const avanceArco = suavizar(
      limitar(estado.apertura / PLANTA_DERECHA.arcoTramo, 0, 1)
    );
    const finalArco = {
      x: PLANTA_DERECHA.arcoSuperior.punta.x * full,
      y: -PLANTA_DERECHA.arcoSuperior.punta.y * full,
    };
    const puntaArco = {
      x: puntaTallo.x + (finalArco.x - puntaTallo.x) * avanceArco,
      y: puntaTallo.y + (finalArco.y - puntaTallo.y) * avanceArco,
    };
    const florT = PLANTA_DERECHA.arcoSuperior.florT;
    const puntoFlorPunta = {
      x: puntaTallo.x + (puntaArco.x - puntaTallo.x) * florT,
      y: puntaTallo.y + (puntaArco.y - puntaTallo.y) * florT,
    };

    // Cada rama crece desde su unión y su flor abre cuando llegó al final.
    const ramas = PLANTA_DERECHA.ramas.map((rama) => {
      const tramo = rama.fin - rama.inicio;
      const avance = suavizar(limitar((estado.ramas - rama.inicio) / tramo, 0, 1));
      const union = { x: rama.union.x * full, y: -rama.union.y * full };
      const final = { x: rama.punta.x * full, y: -rama.punta.y * full };
      const actual = {
        x: union.x + (final.x - union.x) * avance,
        y: union.y + (final.y - union.y) * avance,
      };
      const punta = puntaConVaiven(actual, ahora, rama.fase, avance, full);
      const flor = suavizar(
        limitar(
          (estado.ramas - rama.fin) / PLANTA_DERECHA.florRamaTramo,
          0,
          1
        )
      );

      return { rama, avance, union, punta, flor };
    });

    const florPunta = suavizar(
      limitar(
        (estado.apertura - PLANTA_DERECHA.florPuntaDesde) /
          (1 - PLANTA_DERECHA.florPuntaDesde),
        0,
        1
      )
    );

    return {
      full,
      largo,
      anchoTallo,
      puntaTallo,
      avanceArco,
      puntaArco,
      puntoFlorPunta,
      florPunta,
      ramas,
    };
  }

  /**
   * La planta derecha completa. Comparte con las demás el crecimiento, la
   * inclinación, la sacudida, el viento y las partículas; lo propio es el
   * montaje: tallo que se estira, un arco en la punta con su flor y seis ramas
   * que abren su flor al llegar.
   *
   * El orden de dibujo es el de la lámina: hojas de atrás, ramas, tallo, arco y
   * flores de la punta, y las dos hojas de adelante.
   */
  function dibujarPlantaDerecha(planta, ancho, alto, ahora, contexto = ctx) {
    const piezas = planta.partes;
    if (!piezas || !piezas.tallo) return;

    const estado = planta.derecha;
    if (estado.visibilidad <= 0.002) return;

    const c = contexto || ctx;
    const base = baseDeLaPlanta(planta.def, ancho, alto);
    const puntos = montajePlantaDerecha(planta, alto, ahora);
    const full = puntos.full;

    // Las hojas de la base se despliegan con el primer tramo del crecimiento.
    const despliegue = suavizar(
      limitar(planta.crecimiento / PLANTA_DERECHA.despliegueHojas, 0, 1)
    );

    c.save();
    c.globalAlpha *= estado.visibilidad;

    for (const hoja of PLANTA_DERECHA.hojas) {
      if (!hoja.detras) continue;
      dibujarHojaBase(c, piezas, hoja, base, full, despliegue);
    }

    c.save();

    // Todo lo que nace del tallo pivota en la base: el suelo queda quieto.
    const anguloPlanta =
      inclinacion + temblorDeSacudida(ahora) + balanceoDelAire(ahora, planta);
    c.translate(base.x, base.y);
    c.rotate(anguloPlanta);

    // ---- ramas: van detrás del tallo, así la unión queda limpia ----
    for (const item of puntos.ramas) {
      if (item.avance <= 0.001) continue;
      dibujarRama(
        c,
        piezas[item.rama.clave],
        item.rama,
        item.union,
        item.punta,
        Math.min(1, item.avance * 3)
      );
    }

    // ---- tallo: se estira con el crecimiento, la base no se mueve ----
    c.drawImage(
      piezas.tallo,
      -PLANTA_DERECHA.talloBase * puntos.anchoTallo,
      -puntos.largo,
      puntos.anchoTallo,
      puntos.largo
    );

    // ---- flores de las ramas: cuelgan de la punta exacta de cada arco ----
    for (const item of puntos.ramas) {
      if (item.avance <= 0.001) continue;
      const escala =
        PLANTA_DERECHA.escalaCerrada +
        (1 - PLANTA_DERECHA.escalaCerrada) * item.flor;
      // El capullo se encoge y se arrima al arco; abierto, la flor se suelta.
      const vaiven = Math.sin(ahora * 0.0012 + item.rama.fase) * 0.02 * item.flor;
      dibujarParte(
        c,
        piezas[item.rama.flor],
        item.punta.x,
        item.punta.y - (1 - item.flor) * 0.012 * full,
        item.rama.florAncho * full * escala,
        item.rama.florGiro + vaiven,
        item.rama.florAx,
        0,
        Math.min(1, item.avance * 3)
      );
    }

    // ---- arco de la punta: crece desde la punta del tallo ----
    if (puntos.avanceArco > 0.001) {
      dibujarRama(
        c,
        piezas.arcoSuperior,
        PLANTA_DERECHA.arcoSuperior,
        puntos.puntaTallo,
        puntos.puntaArco,
        Math.min(1, puntos.avanceArco * 3)
      );
    }

    // ---- flor de la punta: el final del crecimiento, con puño o sin él ----
    if (estado.apertura > 0.001) {
      const florPunta = puntos.florPunta;
      const escala =
        PLANTA_DERECHA.escalaCerrada +
        (1 - PLANTA_DERECHA.escalaCerrada) * florPunta;
      const vaiven =
        Math.sin(ahora * 0.0011 + PLANTA_DERECHA.florSuperior.fase) * 0.02 * florPunta;
      dibujarParte(
        c,
        piezas.florSuperior,
        puntos.puntoFlorPunta.x,
        puntos.puntoFlorPunta.y - (1 - florPunta) * 0.012 * full,
        PLANTA_DERECHA.florSuperior.ancho * full * escala,
        PLANTA_DERECHA.florSuperior.giro + vaiven,
        PLANTA_DERECHA.florSuperior.ax,
        0,
        Math.min(1, estado.apertura * 4)
      );
    }

    // ---- la bolita: capullo del brote y remate del arco de la punta ----
    const baya = PLANTA_DERECHA.baya;
    dibujarParte(
      c,
      piezas.baya,
      puntos.puntaArco.x + baya.x * full,
      puntos.puntaArco.y - baya.y * full,
      baya.ancho * full,
      0,
      baya.ax,
      baya.ay
    );

    c.restore(); // grupo del tallo

    // ---- hojas de adelante: fijas, delante del tallo ----
    for (const hoja of PLANTA_DERECHA.hojas) {
      if (hoja.detras) continue;
      dibujarHojaBase(c, piezas, hoja, base, full, despliegue);
    }

    c.restore(); // visibilidad
  }

  /** Una hoja de la base: anclada en el suelo y sin seguir el balanceo. */
  function dibujarHojaBase(c, piezas, hoja, base, full, despliegue) {
    if (despliegue <= 0.002) return;

    dibujarParte(
      c,
      piezas[hoja.clave],
      base.x + hoja.x * full,
      base.y + hoja.y * full,
      hoja.ancho * full * (0.55 + 0.45 * despliegue),
      hoja.giro,
      hoja.ax,
      hoja.ay,
      despliegue
    );
  }

  /** Curva de suavizado corta, reutilizada por el montaje. */
  function suavizar(t) {
    return t * t * (3 - 2 * t);
  }

  function puntoDelTallo(base, altura, t, desplazamientoX) {
    return { x: base.x + desplazamientoX, y: base.y - altura * t };
  }

  /**
   * Dónde nace la planta: a una separación uniforme del borde inferior del
   * lienzo (`BASE_PLANTAS.margenInferior`). Las dos comparten la misma base,
   * así el tulipán y la orquídea quedan parejos y alejados del bosque. La x y
   * la altura salen de la entrada del catálogo, no de un valor global.
   */
  function baseDeLaPlanta(def, ancho, alto) {
    return {
      x: ancho * def.x,
      y: alto - alto * BASE_PLANTAS.margenInferior,
    };
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
    for (const clave of Object.keys(estadosDedos)) delete estadosDedos[clave];
    intensidadDedos = 0;

    for (const planta of plantas) {
      planta.crecimiento = 0;
      planta.florecimiento = 0;
      planta.particulas = [];
      planta.acumuladorEmision = 0;
      planta.acumuladorDestellos = 0;
      planta.orquidea.llegoArriba = false;
      planta.orquidea.apertura = 0;
      planta.orquidea.ramas = 0;
      planta.orquidea.visibilidad = 0;
      planta.tresFlores.llegoArriba = false;
      planta.tresFlores.apertura = 0;
      planta.tresFlores.ramas = 0;
      planta.tresFlores.ramaIzquierda = 0;
      planta.tresFlores.ramaDerecha = 0;
      planta.tresFlores.florIzquierda = 0;
      planta.tresFlores.florDerecha = 0;
      planta.tresFlores.visibilidad = 0;
      planta.derecha.llegoArriba = false;
      planta.derecha.apertura = 0;
      planta.derecha.ramas = 0;
      planta.derecha.visibilidad = 0;
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
    destellos: () => intensidadDedos,
    inclinacion: () => inclinacion,
    particulas: () => principal.particulas.length,
    plantas: () =>
      plantas.map((planta) => ({
        id: planta.def.id,
        archivo: planta.def.archivo,
        x: planta.def.x,
        altura: planta.def.altura,
        // Misma base uniforme que usa el dibujo; sirve para centrar la oleada.
        base: anchoCSS && altoCSS ? baseDeLaPlanta(planta.def, anchoCSS, altoCSS) : null,
        cargada: planta.lista,
        crecimiento: planta.crecimiento,
        florecimiento: planta.florecimiento,
        particulas: planta.particulas.length,
        proporcion: planta.proporcion,
        // Cada montaje publica su propia apertura y sus ramas.
        apertura:
          planta.def.personalizado === 'tres-flores'
            ? planta.tresFlores.apertura
            : planta.def.personalizado === 'planta-derecha'
              ? planta.derecha.apertura
              : planta.orquidea.apertura,
        ramas:
          planta.def.personalizado === 'tres-flores'
            ? planta.tresFlores.ramas
            : planta.def.personalizado === 'planta-derecha'
              ? planta.derecha.ramas
              : planta.orquidea.ramas,
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
        visibilidad: planta.orquidea.visibilidad,
      };
    },
    /**
     * Estado de la planta de tres flores. Además de la secuencia, devuelve la
     * base y las puntas en coordenadas de pantalla: son las mismas que usa el
     * dibujo, así se puede comprobar que la flor y su rama no se separan.
     */
    tresFlores: (ahoraMs) => {
      const planta = plantas.find((candidata) => candidata.def.id === 'tres_flores');
      if (!planta) return null;

      const estado = planta.tresFlores;
      const tiempos = TRES_FLORES.tiemposFlor;
      const salida = {
        cargada: planta.lista,
        piezas: planta.partes ? Object.keys(planta.partes).length : 0,
        crecimiento: planta.crecimiento,
        llegoArriba: estado.llegoArriba,
        apertura: estado.apertura,
        aperturaAtras: suavizar(
          limitar(
            (estado.apertura - tiempos.atrasDesde) / (tiempos.atrasHasta - tiempos.atrasDesde),
            0,
            1
          )
        ),
        aperturaFrente: suavizar(
          limitar(
            (estado.apertura - tiempos.frenteDesde) / (tiempos.frenteHasta - tiempos.frenteDesde),
            0,
            1
          )
        ),
        ramas: estado.ramas,
        ramaIzquierda: estado.ramaIzquierda,
        ramaDerecha: estado.ramaDerecha,
        florIzquierda: estado.florIzquierda,
        florDerecha: estado.florDerecha,
        visibilidad: estado.visibilidad,
      };

      if (!anchoCSS || !altoCSS) return salida;

      const ahora = typeof ahoraMs === 'number' ? ahoraMs : ultimoFrame;
      const base = baseDeLaPlanta(planta.def, anchoCSS, altoCSS);
      const puntos = montajeTresFlores(planta, altoCSS, ahora);
      const angulo =
        inclinacion + temblorDeSacudida(ahora) + balanceoDelAire(ahora, planta);
      const cos = Math.cos(angulo);
      const sin = Math.sin(angulo);
      const aPantalla = (punto) => ({
        x: base.x + punto.x * cos - punto.y * sin,
        y: base.y + punto.x * sin + punto.y * cos,
      });

      salida.base = { x: base.x, y: base.y };
      salida.puntaTallo = aPantalla(puntos.puntaTallo);
      salida.puntaIzquierda = aPantalla(puntos.puntaIzquierda);
      salida.puntaDerecha = aPantalla(puntos.puntaDerecha);

      return salida;
    },
    /**
     * Estado de la planta derecha. Además de la secuencia, devuelve la base, la
     * punta del tallo, la del arco y la de cada rama en coordenadas de
     * pantalla: son las mismas que usa el dibujo, así se puede comprobar que
     * ninguna flor se separa de su arco.
     */
    plantaDerecha: (ahoraMs) => {
      const planta = plantas.find(
        (candidata) => candidata.def.id === 'planta_derecha'
      );
      if (!planta) return null;

      const estado = planta.derecha;
      const salida = {
        cargada: planta.lista,
        piezas: planta.partes ? Object.keys(planta.partes).length : 0,
        crecimiento: planta.crecimiento,
        llegoArriba: estado.llegoArriba,
        apertura: estado.apertura,
        ramas: estado.ramas,
        visibilidad: estado.visibilidad,
        floresDeRama: montajePlantaDerecha(planta, altoCSS || 1, ahoraMs || 0).ramas.map(
          (item) => ({ clave: item.rama.clave, avance: item.avance, flor: item.flor })
        ),
      };

      if (!anchoCSS || !altoCSS) return salida;

      const ahora = typeof ahoraMs === 'number' ? ahoraMs : ultimoFrame;
      const base = baseDeLaPlanta(planta.def, anchoCSS, altoCSS);
      const puntos = montajePlantaDerecha(planta, altoCSS, ahora);
      const angulo =
        inclinacion + temblorDeSacudida(ahora) + balanceoDelAire(ahora, planta);
      const cos = Math.cos(angulo);
      const sin = Math.sin(angulo);
      const aPantalla = (punto) => ({
        x: base.x + punto.x * cos - punto.y * sin,
        y: base.y + punto.x * sin + punto.y * cos,
      });

      salida.base = { x: base.x, y: base.y };
      salida.puntaTallo = aPantalla(puntos.puntaTallo);
      salida.puntaArco = aPantalla(puntos.puntaArco);
      salida.florPunta = aPantalla(puntos.puntoFlorPunta);
      salida.puntasDeRama = puntos.ramas.map((item) => aPantalla(item.punta));

      return salida;
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
        dibujarParticulas(planta, ahora, contexto);
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
