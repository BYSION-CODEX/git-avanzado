/* ============================================================
   sonido.js — la música de la experiencia

   Dos estados, dos pistas, un solo cruce:

   - `musica-gris.mp3`     suena mientras todo está gris y se queda sonando
                           hasta que la interacción con las manos enciende el
                           paisaje. Es la espera.
   - `musica-florecer.mp3` entra cuando las flores se abren y se va cuando las
                           manos salen de cuadro. Es la recompensa.

   Los dos archivos van en la raíz del repo, al lado de `index.html`. Si falta
   alguno, el resto de la experiencia sigue andando y solo se pierde esa pista:
   se avisa por consola con el prefijo `[sonido]` y queda anotado en
   `window.sonidoDebug.faltantes()`.

   Por qué dos `<audio>` y no Web Audio: una pista de tres minutos decodificada
   ocupa decenas de MB en memoria y acá solo hace falta un volumen que sube y
   baja. Los elementos no se agregan al DOM; viven sueltos, que es válido y no
   cuesta nada de layout.

   El módulo no lee globals de `sketch.js`: el estado llega resuelto en
   `actualizarMusica(dt, { gris, floracion })`. Así se puede probar desde la
   consola sin cámara ni plantas, con `sonidoDebug.probar(...)`.
   ============================================================ */

/**
 * Todo lo que se puede tocar del sonido vive acá.
 *
 * Los tiempos de subida y bajada son de amortiguación exponencial
 * (`1 - exp(-k·dt)`), igual que el resto de la escena: el volumen no depende del
 * framerate. La bajada es más rápida que la subida en las dos pistas, para que
 * al sacar las manos el piano se vaya enseguida en vez de quedar colgado.
 */
const MUSICA = {
  rutaGris: 'musica-gris.mp3',
  rutaFlorecer: 'musica-florecer.mp3',

  // Techos de volumen. Bajos a propósito: esto suena solo, sin control a mano,
  // y tiene que poder convivir con alguien hablando al lado de la pantalla.
  volumenGris: 0.45,
  volumenFlorecer: 0.6,

  // Cuánto se precarga cada pista. La de la espera entra apenas se toca la
  // página, así que conviene tenerla lista. El piano dura ~62 minutos y pesa
  // ~85 MB: se pide solo la cabecera y se transmite cuando las flores se abren.
  // Con las dos en 'auto' cada carga de página se llevaba los 85 MB enteros.
  precargaGris: 'auto',
  precargaFlorecer: 'metadata',

  ataqueGris: 1.0, // cómo entra la ciudad triste
  salidaGris: 1.4, // cómo se aparta cuando el paisaje se enciende
  ataqueFlorecer: 0.9, // cómo entra el piano
  salidaFlorecer: 2.2, // cómo se va al sacar las manos

  // Piso de silencio: la amortiguación exponencial se acerca a cero pero nunca
  // llega, y por debajo de esto (−50 dB) no se oye nada. Se corta acá para poder
  // pausar el elemento en vez de dejar las dos pistas decodificando por un
  // volumen fantasma.
  silencio: 0.003,

  // Floración: el piano arranca apenas la flor empieza a abrirse (`desde`) y ya
  // está a volumen pleno cuando la flor terminó de abrirse (`hasta`).
  desde: 0.18,
  hasta: 0.8,

  // Al encenderse de nuevo, la pista vuelve a su primera nota en vez de entrar
  // a mitad de una frase: es lo que hace que el momento se sienta mágico.
  reiniciarAlEmpezar: true,

  // El navegador bloquea el audio hasta el primer gesto del usuario. Mientras
  // tanto se reintenta, pero cada 400 ms y no en cada frame: 60 rechazos por
  // segundo llenarían la consola y no cambiarían nada.
  reintentoMs: 400,
};

/** Estado vivo de los dos canales. */
const musica = {
  iniciada: false,
  canales: { gris: null, florecer: null },
  faltantes: [],
  // El navegador no deja sonar hasta que la persona toca la página. Mientras el
  // audio siga bloqueado se ofrece el botón; al primer gesto se esconde y no
  // vuelve nunca más en la sesión.
  gestoDelUsuario: false,
  avisoVisible: false,
};

/* ---------- Puesta en marcha ---------- */

/**
 * Crea los dos elementos `<audio>`. Se llama una sola vez, desde `setup()`.
 * No hace falta esperar a que carguen: hasta que no llega el primer gesto del
 * usuario el navegador las deja en pausa y el volumen espera en cero.
 */
function iniciarMusica() {
  if (musica.iniciada) return;
  musica.iniciada = true;

  musica.canales.gris = crearCanal(
    'gris',
    MUSICA.rutaGris,
    MUSICA.volumenGris,
    MUSICA.ataqueGris,
    MUSICA.salidaGris,
    MUSICA.precargaGris
  );

  musica.canales.florecer = crearCanal(
    'florecer',
    MUSICA.rutaFlorecer,
    MUSICA.volumenFlorecer,
    MUSICA.ataqueFlorecer,
    MUSICA.salidaFlorecer,
    MUSICA.precargaFlorecer
  );

  escucharPrimerGesto();
}

/**
 * El primer toque o tecla de la persona es lo que habilita el audio para toda la
 * sesión. Se escucha en captura y en el documento entero: sirve cualquier clic,
 * no solo el del botón, porque el botón es un aviso, no un requisito.
 */
function escucharPrimerGesto() {
  if (typeof document === 'undefined' || !document.addEventListener) return;

  const alGesto = () => {
    document.removeEventListener('pointerdown', alGesto, true);
    document.removeEventListener('keydown', alGesto, true);

    musica.gestoDelUsuario = true;
    ocultarAvisoDeAudio();

    // El gesto acaba de habilitar el audio: no tiene sentido esperar el
    // reintento programado, que puede tardar hasta `reintentoMs`.
    for (const id of ['gris', 'florecer']) {
      const canal = musica.canales[id];
      if (canal) canal.ultimoIntento = -Infinity;
    }
  };

  document.addEventListener('pointerdown', alGesto, true);
  document.addEventListener('keydown', alGesto, true);
}

/** Muestra la invitación a tocar. Solo tiene sentido si hay un botón en el HTML. */
function pedirAvisoDeAudio() {
  if (musica.gestoDelUsuario || musica.avisoVisible) return;
  if (typeof document === 'undefined' || !document.getElementById) return;

  const boton = document.getElementById('sonido-activar');
  if (!boton) return;

  boton.hidden = false;
  musica.avisoVisible = true;
}

function ocultarAvisoDeAudio() {
  if (!musica.avisoVisible) return;
  musica.avisoVisible = false;

  if (typeof document === 'undefined' || !document.getElementById) return;
  const boton = document.getElementById('sonido-activar');
  if (boton) boton.hidden = true;
}

/**
 * Un canal es un `<audio>` en bucle más su envolvente de volumen.
 *
 * `objetivo` guarda de 0 a 1 cuánto pide el estado; `volumen` es ese valor ya
 * filtrado y escalado por el techo. Separarlos deja leer desde la consola qué
 * quiere el paisaje sin confundirlo con lo que el filtro ya alcanzó.
 */
function crearCanal(id, ruta, volumenMaximo, ataque, salida, precarga) {
  const elemento = new Audio(ruta);
  elemento.loop = true;
  elemento.preload = precarga || 'auto';
  elemento.volume = 0;

  const canal = {
    id,
    ruta,
    elemento,
    volumenMaximo,
    ataque,
    salida,
    volumen: 0, // 0..1 real, ya filtrado y escalado
    objetivo: 0, // 0..1 pedido por el estado, ya filtrado
    encendido: false, // sirve para detectar el flanco de encendido
    // -Infinity y no 0: el primer `play()` tiene que salir ya. Con 0, una página
    // que carga en menos de `reintentoMs` se comía el arranque de la música.
    ultimoIntento: -Infinity,
    disponible: false,
    error: null,
  };

  // Con `preload: 'metadata'` en la pista larga, `canplaythrough` no llega hasta
  // que la pista se reproduce. Los metadatos alcanzan para saber que el archivo
  // está y que el códec se entiende, que es lo único que importa acá.
  elemento.addEventListener('loadedmetadata', () => {
    canal.disponible = true;
    canal.error = null;
  });

  elemento.addEventListener('canplaythrough', () => {
    canal.disponible = true;
    canal.error = null;
  });

  // Un 404 o un archivo con un códec que el navegador no puede abrir termina
  // acá. No se adivina la causa: se nombra el archivo y se deja el detalle.
  elemento.addEventListener('error', () => {
    canal.disponible = false;
    canal.error = describirErrorDeMedio(elemento);
    if (musica.faltantes.indexOf(ruta) === -1) {
      musica.faltantes.push(ruta);
      console.warn(
        '[sonido] No se pudo cargar "' + ruta + '" (' + canal.error + '). ' +
          'Dejá el archivo en la raíz del repo, al lado de index.html.'
      );
    }
  });

  return canal;
}

/**
 * Traduce el `MediaError` del elemento a algo legible. Sin esto el aviso dice
 * "no se pudo cargar" y no distingue un archivo que falta de uno corrupto.
 */
function describirErrorDeMedio(elemento) {
  const error = elemento && elemento.error;
  if (!error) return 'error desconocido';

  switch (error.code) {
    case 1:
      return 'carga abortada';
    case 2:
      return 'error de red';
    case 3:
      return 'el navegador no pudo decodificar el audio';
    case 4:
      return 'formato no soportado o archivo no encontrado';
    default:
      return 'error ' + error.code;
  }
}

/* ---------- Un frame de música ---------- */

/**
 * Un paso del cruce entre las dos pistas.
 *
 * `estado.gris`      0..1, cuánto está todo gris (1 = sin color).
 * `estado.floracion` 0..1, cuánto se abrieron las flores. El que lo arma es
 *                    `sketch.js`, que ya sabe si hay manos en cuadro: sin
 *                    manos la floración llega en cero y el piano se va.
 *
 * El piano manda: mientras las flores están abiertas, la ciudad triste se
 * aparta. Cuando las manos salen, el paisaje vuelve a gris y la ciudad triste
 * vuelve sola, con la pista desde el principio.
 */
function actualizarMusica(dt, estado) {
  if (!musica.iniciada) return;

  const paso = Number.isFinite(dt) && dt > 0 ? Math.min(dt, 0.05) : 0;

  const gris = acotar(estado && estado.gris);
  const floracion = acotar(estado && estado.floracion);

  // Curva del piano: suave en los dos extremos, así entra sin golpe y se
  // asienta sin quedar a media voz.
  const piano = curvaSuave((floracion - MUSICA.desde) / (MUSICA.hasta - MUSICA.desde));

  // El cruce: mientras el piano suena, el gris se corre a un lado de forma
  // proporcional. No hay dos pistas peleando por el mismo oído.
  const pedidoGris = gris * (1 - piano);

  avanzarCanal(musica.canales.gris, pedidoGris, paso);
  avanzarCanal(musica.canales.florecer, piano, paso);
}

/**
 * Mueve un canal hacia su objetivo y decide si suena o no.
 *
 * Se pausa el elemento cuando el volumen llega a cero: un `<audio>` en pausa no
 * gasta decodificador ni batería, y al volver sigue sonando en bucle como si
 * nada. Reproducir o pausar no es el estado, es solo la consecuencia.
 */
function avanzarCanal(canal, pedido, dt) {
  if (!canal || !canal.elemento) return;

  const acotado = acotar(pedido);

  // Flanco de encendido: la pista arranca de nuevo desde su primera nota.
  const encendido = acotado > 0.001;
  if (MUSICA.reiniciarAlEmpezar && encendido && !canal.encendido) reiniciarPista(canal);
  canal.encendido = encendido;

  const rapidez = acotado > canal.objetivo ? canal.ataque : canal.salida;
  canal.objetivo += (acotado - canal.objetivo) * (1 - Math.exp(-rapidez * dt));
  if (Math.abs(acotado - canal.objetivo) < 0.002) canal.objetivo = acotado;

  canal.volumen = canal.objetivo * canal.volumenMaximo;

  // Piso de silencio: cuando el estado pide (casi) nada y ya no queda señal
  // audible, se cierra del todo. Se compara contra `silencio` y no contra cero
  // exacto: un paisaje al 99,9 % deja un pedido de 0,001 que no se oye, y sin
  // esto el `pause()` de abajo no llegaría nunca.
  if (acotado <= MUSICA.silencio && canal.volumen <= MUSICA.silencio) {
    canal.objetivo = 0;
    canal.volumen = 0;
  }

  // Sin archivo no hay nada que mover, pero el objetivo se sigue calculando:
  // así `sonidoDebug` muestra qué habría sonado.
  if (canal.error) return;

  canal.elemento.volume = Math.min(1, Math.max(0, canal.volumen));

  if (canal.volumen > 0.001) {
    if (canal.elemento.paused) intentarReproducir(canal);
  } else if (!canal.elemento.paused) {
    canal.elemento.pause();
  }
}

/** Vuelve la pista al principio. Si todavía no cargó, no hay nada que saltar. */
function reiniciarPista(canal) {
  const elemento = canal.elemento;
  if (!elemento || elemento.readyState < 1) return;

  try {
    elemento.currentTime = 0;
  } catch (error) {
    // El navegador puede rechazar el salto si el archivo aún no tiene rangos
    // buscables. No es un error de la experiencia: la pista entra donde pueda.
  }
}

/**
 * Intenta reproducir sin ruido en la consola.
 *
 * El rechazo por política de autoplay es esperable y no es una falla: alcanza
 * con que el usuario toque cualquier cosa de la página. Cuando es eso lo que
 * pasó se ofrece el botón; cualquier otro error no lo disfraza de invitación.
 */
function intentarReproducir(canal) {
  const ahora = typeof performance !== 'undefined' ? performance.now() : Date.now();
  if (ahora - canal.ultimoIntento < MUSICA.reintentoMs) return;
  canal.ultimoIntento = ahora;

  const promesa = canal.elemento.play();
  if (!promesa || typeof promesa.then !== 'function') return;

  promesa.then(
    () => ocultarAvisoDeAudio(),
    (error) => {
      // Solo el bloqueo de autoplay merece la invitación a tocar. Un archivo que
      // falta o que el navegador no puede decodificar se reporta por su cuenta,
      // en el listener de `error`, y no se disfraza de "tocá para activar".
      if (error && error.name === 'NotAllowedError') pedirAvisoDeAudio();
    }
  );
}

/* ---------- Ayudas ---------- */

/** Deja cualquier entrada en 0..1; un `NaN` o un `undefined` valen 0. */
function acotar(valor) {
  const numero = Number(valor);
  if (!Number.isFinite(numero)) return 0;
  return Math.min(1, Math.max(0, numero));
}

/** Smoothstep: misma curva que `suavizar()` de sketch.js, acá autocontenida. */
function curvaSuave(t) {
  const acotado = Math.min(1, Math.max(0, t));
  return acotado * acotado * (3 - 2 * acotado);
}

/* ---------- Acceso de solo lectura para comprobar desde la consola ---------- */

window.sonidoDebug = {
  /**
   * Qué está sonando y qué quiere sonar. `volumen` es lo que ya se está oyendo;
   * `objetivo` es lo que el paisaje pide, todavía sin llegar.
   */
  estado: () => ({
    iniciada: musica.iniciada,
    faltantes: musica.faltantes.slice(),
    gestoDelUsuario: musica.gestoDelUsuario,
    avisoVisible: musica.avisoVisible,
    canales: ['gris', 'florecer']
      .map((id) => musica.canales[id])
      .filter(Boolean)
      .map((canal) => ({
        id: canal.id,
        ruta: canal.ruta,
        disponible: canal.disponible,
        error: canal.error,
        volumen: redondear(canal.volumen),
        objetivo: redondear(canal.objetivo),
        reproduciendo: !canal.elemento.paused,
        tiempo: redondear(canal.elemento.currentTime),
        // En el arranque puede ser NaN hasta que llegan los metadatos: sirve
        // justamente para distinguir "no cargó" de "cargó y dura 61 minutos".
        duracion: redondear(canal.elemento.duration),
      })),
  }),

  /** Los archivos que no cargaron, para el aviso de la interfaz o el README. */
  faltantes: () => musica.faltantes.slice(),

  /**
   * Simula la música sin cámara ni plantas: avanza `segundos` a 60 pasos por
   * segundo con el estado que se le pase.
   *
   *   sonidoDebug.probar({ gris: 1, floracion: 0 }, 2)   // ciudad triste
   *   sonidoDebug.probar({ gris: 0.2, floracion: 1 }, 2) // piano mágico
   */
  probar: (estado, segundos) => {
    const total = Number.isFinite(segundos) && segundos > 0 ? segundos : 1;
    const pasos = Math.max(1, Math.round(total * 60));
    for (let i = 0; i < pasos; i += 1) actualizarMusica(1 / 60, estado);
    return window.sonidoDebug.estado();
  },
};

function redondear(valor) {
  const numero = Number(valor);
  if (!Number.isFinite(numero)) return 0;
  return Math.round(numero * 1000) / 1000;
}
