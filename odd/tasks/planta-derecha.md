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
