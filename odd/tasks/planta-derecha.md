# Planta derecha (flores de colores) — montaje de piezas en el lado derecho

Objetivo: sumar al catálogo una tercera planta, a la derecha de la escena, montada
con las 20 piezas PNG de `C:\Users\USER\Desktop\planta 3`, siguiendo la lámina
`planta_referencia.jpeg`. Rama: `main`. Sin bundler ni tests automáticos: se
verifica con el banco headless en Node (`plantaDebug.paso`).

## Specs

- S1. La planta vive en el lado derecho de la escena (`x: 0.79`) y su base no se
  mueve durante toda la animación.
- S2. Usa el sistema existente: crecimiento por puño cerrado, calibración de
  altura de la mano, inclinación, sacudida, viento, partículas y
  `plantaDebug.reiniciar()`. No cambia el comportamiento de la orquídea ni de
  la planta de tres flores.
- S3. Montaje con las 20 piezas, identificadas por forma: 4 hojas de base, tallo
  principal, 5 arcos derechos (`_1`..`_5`), 2 arcos izquierdos, 5 flores
  derechas, 2 flores izquierdas y la bolita del extremo.
- S4. Puño cerrado: aparecen las hojas de la base y el brote (tallo corto) con la
  bolita como capullo en la punta.
- S5. Subir el puño: el tallo se estira de forma continua y el brote acompaña la
  punta; al llegar al máximo se abre la flor de la punta (arco superior, flor 1 y
  la bolita al final del arco). La altura se conserva al cambiar de gesto.
- S6. Mano abierta con el tallo en la punta: crecen las ramas desde su unión,
  cada una alcanza su largo final antes de abrir su flor, de arriba hacia abajo.
  Abrir la mano antes de la altura máxima no adelanta nada.
- S7. Si se cierra el puño o baja el tallo, la flor y las ramas se recogen; el
  estado es reversible y no queda una flor colgada de un tallo más corto.
- S8. Reiniciar vuelve todo a cero y la secuencia se repite.

## Tasks

- T1 (S3) copiar las 20 piezas como `derecha-*.png` y la lámina de referencia. — inline
- T2 (S4-S7) montaje y secuencia en `planta.js`. — inline
- T3 (S1-S2) entrada del catálogo, visibilidad, centro de la flor, debug y reinicio. — inline
- T4 (S3-S8) verificación headless + documentación en `AGENTS.md`. — inline

Estado: T1-T4 hechas. Commit `a680897` en `feature/planta-derecha`.

## Log

### L1 — pedido original (verbatim, recortado por el usuario)

"Agrega la nueva planta, correspondiente a la imagen de referencia adjunta, en la
carpeta como planta_referencia.jpeg, tomando como referencia la pantalla vista
por el usuario. La planta debe aparecer en ese lado desde el momento en que nace
el brote y permanecer allí durante toda la animación. [...] Puño cerrado:
nacimiento del brote [...] Subir el puño: crecimiento del tallo [...] Abrir la
mano: crecimiento de las ramificaciones y flores [...]"

El último punto del mensaje quedó cortado en «El grupo frontal debe colocarse»;
no se recibió el resto. Se interpretó con la lámina: cada flor es un solo PNG con
su campana frontal y el pétalo trasero ya unidos, así que se anima como una
unidad (no se pueden separar sin redibujar el arte).

### Evidencia

- `node --check planta.js` limpio.
- Banco headless en Node con `document`/`window`/`Image` falsos y un canvas que
  graba las llamadas de dibujo; esas llamadas se repintaron con System.Drawing
  para mirar el resultado real, no una maqueta aparte.
- Secuencia verificada: sin mano → todo 0; puño → brote con bolita y hojas;
  puño arriba → crecimiento 1, apertura 1, ramas 0; mano abierta → ramas 1 y las
  seis flores de rama abiertas; cerrar la mano → ramas 0 y la flor de la punta
  sigue abierta; bajar el puño → apertura 0; `reiniciar()` → todo 0.
- Base fija en `x = 0.79` del ancho en todas las fases; `plantaDebug.plantas()`
  devuelve las tres plantas con la misma línea de base.
- Las 20 piezas declaradas existen en disco.
- `gentle-ai review assess --base-ref 844f18e --committed-only` → riesgo
  `medium`, `review_due: false` (`under_budget`).

### L2 — corrección del usuario

> «algunas remificaciones de la tercera planta estan alejadas demasiado del
> tallo, arregla eso por favor que nazcan del tallo principal»

Las uniones estaban sobre la *línea de centro* teórica del tallo, pero el tallo
dibujado se inclina: a la altura de las ramas de arriba su borde derecho cae
hasta 0.06 de `full` a la izquierda de donde se las había puesto, así que
flotaban. Se recalcularon las seis `union` contra los bordes reales del tallo
(medidos del PNG) y quedan tapadas por él, que se dibuja después. Además la
primera rama bajó de 0.86 a 0.845 para no cruzarse con el gancho de la punta.

### L3 — segundo pedido

> «si la mano desaparece aunque las flores hayan estgad en floración, o en 100%
> de crecimiento, el fondo debe volver a hacerse gris. Tambien quiero que broten
> mas destellos de las dflores, mucho más, algo mas dramtico que estas particulas
> se extiendan mas hacia donde drincan»

- `progresoDePlantas()` (en `sketch.js`) devuelve 0 sin manos en cuadro: el
  atardecer, las nubes y los destellos del horizonte vuelven a gris con
  `velocidadSalida` (4.5/s), aunque las plantas hayan quedado al 100 % y las
  flores abiertas. La oleada de floración tampoco dispara sin manos.
- Destellos: `MAX_DESTELLOS` 90 → 300, `EMISION_DESTELLOS` 55 → 160/s,
  `MAX_PARTICULAS` 160 → 420. Ahora nacen en un radio de 0.14 de `full` y salen
  disparados hacia afuera (rapidez `escala·(0.7..1.5)`, roce 0.35 por partícula,
  gravedad 4): 92 px de promedio y 216 px de máximo desde el centro de la flor,
  contra los ~40 px de antes. El halo bajó a 3× y alfa 0.32 para que se lean
  puntos y no una mancha.
- Verificado con el banco de destellos (`banco_destellos.js`, con la planta a
  pleno y los dedos agitados): 234 destellos vivos en la planta derecha y el
  fotograma repintado muestra la lluvia saliendo de las flores.

### L4 — tercer pedido

> «ahora quiero que dupliques las tres flores, pero estas copias se van a
> ubicar detras de las principales mas en el fondo y con una escala menor, para
> mostrar lejania, y van a funcionar totalmente igual, solo que estas se
> activaran con la mano izquierda y respetaran los movimientos de dicha mano ok.
> duplica algunas veces, para que se vea abundante y lleno el campo ok, pero una
> cantidad considerable para que rrinda bien el funcionamiento si puedes bajarles
> la opacidad a 80 tambien para que no interfieran con las principales»

- Seis copias (dos de cada planta) al principio de `PLANTAS`: más chicas
  (0.24–0.34 de alto), con la base levantada 0.03–0.10 y `opacidad: 0.8`.
- La interacción pasó a tener **dos grupos** (`grupoTodas` y `grupoMano`): cada
  uno con su objetivo, nivel, congelamiento, inclinación y sacudida/dedos. Las
  copias usan `grupoMano` (`MANO_COPIAS`), las principales siguen con cualquier
  mano. Las tres funciones de montaje ahora actualizan **por planta**.
- Las copias llevan `limiteParticulas: 60` para que seis montajes no cuesten
  caro al agitar los dedos.
- Verificado con `banco_copias.js`: con una sola mano etiquetada 'Left' crecen
  las principales (1) y las copias quedan en 0; con la etiquetada 'Right'
  (MANO_COPIAS) crecen las seis copias y también las principales; con las dos,
  todo en 1. El fotograma repintado muestra las nueve plantas, las copias al
  80 % y por detrás.
