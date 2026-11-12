# Planta de tres flores (lado izquierdo)

Objetivo: agregar al escenario una planta de tres flores montada con 14 PNG, con la
secuencia puño → subir → mano abierta, base fija y reinicio reutilizable.

Branch: `feature/planta-tres-flores` · Delivery: ask-on-risk · Runner: Node (banco headless) + Chrome headless.

## Specs

- **S1. Ubicación y base fija.** La planta nueva va al lado izquierdo de la escena tal como la ve el
  usuario (`x` de pantalla < 0.5), desde que aparece el brote, y su base queda en el mismo punto
  durante toda la animación.
- **S2. Recursos.** Copiar los 14 PNG de `C:\Users\USER\OneDrive\Documentos\Plantas_FINAL` a la raíz
  del proyecto con la estructura existente (archivos sueltos, prefijo kebab-case) y usar los nombres
  reales revisados. Identificar por su forma cualquier archivo con nombre ambiguo, como
  `flores_de_colores-09`, antes de asignarlo a una rama.
- **S3. Escala y distribución.** Seguir la distribución de la plataforma (orquídea centrada en
  `x: 0.5`, `altura: 0.44`) para ajustar la escala lateral y dejar espacio para que las tres flores
  se abran.
- **S4. Gesto 1 — puño cerrado.** Nace el brote en el lado izquierdo. Aparecen las hojas bajas de la
  base y un tramo corto del tallo principal. El capullo principal se construye acercando y reduciendo
  los dos grupos de pétalos de la flor principal.
- **S5. Gesto 2 — subir el puño.** El tallo crece de forma continua según la altura de la mano. El
  brote acompaña la punta. Al alcanzar la altura máxima se abre la flor principal desplegando primero
  el grupo trasero y después el frontal. Mantener la altura alcanzada al pasar al gesto siguiente.
- **S6. Gesto 3 — abrir la mano arriba.** Las ramas izquierda y derecha crecen desde sus uniones con
  el tallo. Al llegar cada rama a su longitud final se abre su flor en la punta. Se completan las
  hojas según la referencia. Si la mano se abre antes de la altura máxima, se conserva el avance y se
  espera a que la subida se complete con el puño cerrado.
- **S7. Montaje.** Cada flor se monta con sus dos PNG, con el grupo frontal delante del trasero. Ambos
  grupos se animan desde su unión con la punta del tallo o de la rama. Balanceo suave con la base
  fija; ramas, hojas y flores acompañan sus puntos de unión. Proporciones de la referencia, con la
  flor principal arriba y las dos laterales a distinta altura.
- **S8. Integración y comprobación.** Reutilizar la detección de mano, la calibración de altura y el
  reinicio existentes. Comprobar que la planta aparece a la izquierda, que los tres gestos se activan
  en orden, que las piezas permanecen unidas durante el movimiento y que el reinicio permite repetir
  la secuencia.

## Tasks

| ID | Specs | Route | Estado |
| --- | --- | --- | --- |
| T1 | S2, S3 | inline | hecho — `c78bbcd` |
| T2 | S1, S7 | inline | hecho — `c78bbcd` |
| T3 | S4, S5, S6 | inline | hecho — `c78bbcd` |
| T4 | S7 | inline | hecho — `c78bbcd` |
| T5 | S8 | inline | hecho — `c78bbcd` |
| T6 | S2, S8 | inline | hecho — `c78bbcd` |

## Verificación

- Banco headless en Node (`harness-tres-flores.js`): 35 comprobaciones, todas en
  verde. Cubre catálogo, 14 piezas, ubicación `x: 0.22`, base inmóvil, brote con
  puño, crecimiento por altura, flor principal con el puño, ramas solo con mano
  abierta, orden trasero→frontal, flores laterales a distinta altura, abrir
  antes de subir conservando el avance, reinicio y repetición de la secuencia.
- Chrome headless sobre una página de prueba: estados 1, 2 y 3 compuestos sin
  excepciones; la planta queda a la izquierda, las piezas siguen sus uniones y
  el capullo se lee cerrado antes de abrir.
- Comprobación de uniones: `dibujarRama()` y `dibujarFlorMontada()` reciben el
  mismo objeto `punta` de `montajeTresFlores()`; la flor no tiene geometría
  propia que se pueda desincronizar.

## Log

### L1 — pedido original (verbatim)

> Agrega la nueva planta de tres flores al lado izquierdo de la escena, tomando como referencia la pantalla vista por el usuario. Ubícala en ese lado desde que aparece el brote y mantén su base en el mismo punto durante toda la animación. Sigue la distribución de la plataforma para ajustar su escala y dejar espacio para que las tres flores se abran.
>
> Los 14 PNG están en C:\Users\USER\OneDrive\Documentos\Plantas_FINAL. Revisa los nombres reales de los archivos y usa la imagen de secuencia adjunta como guía de montaje, proporciones y orden de aparición. Si el proyecto carga los recursos desde una carpeta propia, copia allí las piezas siguiendo la estructura que ya utiliza. Identifica por su forma cualquier archivo con nombre ambiguo, como flores_de_colores-09, antes de asignarlo a una rama.
>
> Integra la planta usando la detección de mano, la calibración de altura y el reinicio que ya funcionan en el proyecto. Aplica esta secuencia y ajusta la aparición de las hojas a la imagen adjunta.
>
> 1. Puño cerrado. Nace el brote en el lado izquierdo. Aparecen las hojas bajas de la base y un tramo corto del tallo principal. Si el primer estado muestra un capullo, constrúyelo acercando y reduciendo los dos grupos de pétalos de la flor principal.
> 2. Subir el puño. El tallo crece de forma continua según la altura de la mano. El brote acompaña la punta. Al alcanzar la altura máxima configurada, se abre la flor principal desplegando primero el grupo trasero y después el frontal. Mantén la altura alcanzada al pasar al gesto siguiente.
> 3. Abrir la mano después de llegar arriba. Las ramas izquierda y derecha crecen desde sus uniones con el tallo. Al llegar cada rama a su longitud final, se abre su flor en la punta. Completa el despliegue de las hojas según la referencia. Si la mano se abre antes de alcanzar la altura máxima, conserva el avance y espera a que se complete la subida con el puño cerrado.
>
> Monta cada flor con sus dos PNG, con el grupo frontal delante del trasero. Anima ambos desde su unión con la punta del tallo o de la rama. Aplica un balanceo suave con la base fija y haz que las ramas, hojas y flores acompañen sus puntos de unión. Respeta las proporciones de la referencia, con la flor principal arriba y las dos laterales a distinta altura.
>
> Implementa la integración y comprueba que la planta aparece a la izquierda, que los tres gestos se activan en orden, que las piezas permanecen unidas durante el movimiento y que el reinicio permite repetir la secuencia.

### L2 — montaje y verificación (2026-11-11)

- Mapeo revisado de los 14 archivos reales. `flores_de_colores-09.png` (125×129)
  se identificó por su forma como la **rama derecha**: tallo curvo que nace en
  la esquina inferior izquierda y sube a la derecha, espejo de
  `flores_de_colores_rama izquierda.png.png` (100×102).
- Piezas copiadas a la raíz con prefijo `tres-flores-*` y nombres kebab-case.
- Montaje `TRES_FLORES` en `planta.js`; estado `planta.tresFlores`; dibujo
  `dibujarTresFlores()`; geometría compartida `montajeTresFlores()`.
- Capullo: los dos grupos se acercan y se encogen; `escalaCerrada` 0.55/0.5 y
  `estiradoCerrado` 1.65 para que la yema sea alta y no una flor pequeña.
- Verificación en Node: 35 PASS, 0 FAIL. Verificación visual en Chrome headless
  para los estados 1 (brote), 2 (flor principal) y 3 (tres flores).
- Commit de la implementación: `c78bbcd`.
