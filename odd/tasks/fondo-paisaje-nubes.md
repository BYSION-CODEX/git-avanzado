# Paisaje de fondo en dos PNG + nubes y destellos

Objetivo: reemplazar el fondo generado del lienzo por dos PNG alineados (gris con neblina y atardecer a color), encadenar la opacidad del atardecer al crecimiento de las plantas y sumar nubes y destellos en una capa intermedia entre el paisaje y las plantas.

Branch: `main` · Delivery: single-pr · Runner: Chrome headless por CDP (sin cámara) + `node --check`.

## Specs

- **S1. Dos fondos con el mismo encuadre.** `fondo_gris_neblina.png` va abajo y `fondo_atardecer_color.png` encima, ambos detrás de las plantas. Comparten tamaño, encuadre `cover` y punto de alineación (centro), así las colinas no se mueven al cruzar de gris a color.
- **S2. Precarga.** Los dos PNG se cargan en `setup()` con `new Image()` y la escena espera ambos `onload`; la transición funciona desde la primera interacción.
- **S3. Escena inicial.** Con crecimiento 0, la opacidad del atardecer es 0 y solo se ve el paisaje gris con neblina.
- **S4. Crecimiento.** La opacidad del atardecer sube suave, con amortiguación exponencial, siguiendo el mayor `crecimiento` entre las plantas del catálogo.
- **S5. Altura máxima.** Con el crecimiento en 1 la opacidad llega a 1 y se mantiene durante la floración. Si la mano baja o sale de cámara, el color se conserva.
- **S6. Reinicio.** `plantaDebug.reiniciar()` devuelve la opacidad a 0 para que el ciclo siguiente empiece en gris.
- **S7. Solo el paisaje transiciona.** Árboles, pasto, polvo, nubes, destellos y plantas no cambian de opacidad con el crecimiento.
- **S8. Nubes.** Dos o tres nubes difusas se desplazan en horizontal a velocidades distintas. Arrancan grises con opacidad entre 0.06 y 0.12; al aparecer el atardecer viran suave a rosa pálido o lila.
- **S9. Destellos del horizonte.** Unos pocos destellos cálidos cerca del horizonte aparecen y se desvanecen en momentos distintos, con opacidad máxima 0.18, a medida que sube el progreso.
- **S10. Oleada de floración.** Al florecer se activa una única oleada de destellos dorados y rosados detrás de las flores; se rearma cuando esa flor se cierra. Después, nubes lentas y destellos apagándose.
- **S11. Reinicio de efectos.** Al reiniciar, las nubes vuelven al gris y se limpian los destellos pendientes.
- **S12. Capa intermedia y estabilidad.** Nubes y destellos se dibujan delante del paisaje y detrás de las plantas, con transiciones suaves, sin tapar las flores ni producir parpadeos. El paisaje permanece fijo.
- **S13. Fondo a lienzo completo.** El fondo llena el canvas y el canvas llena su panel, también cuando el panel cambia de alto después de `setup()` (por ejemplo, al pasar la cámara a `error`).

## Tasks

| ID | Specs | Route | Estado |
| --- | --- | --- | --- |
| T1 | S1, S2, S3, S7, S13 | inline | hecho — verificación headless |
| T2 | S4, S5, S6 | inline | hecho — verificación headless |
| T3 | S8, S9, S12 | inline | hecho — verificación headless |
| T4 | S10, S11 | inline | hecho — verificación headless |
| T5 | S1-S13 | inline | hecho — documentación en `AGENTS.md` |

## Verificación

- `node --check sketch.js` y `node --check planta.js`: sin errores de sintaxis.
- Chrome/Edge headless por CDP, viewport 1600×900, `getUserMedia` rechazado a
  propósito (sin cámara). Manos sintéticas sobre `window.obtenerManos`.
- Secuencia medida:
  - inicial: gris cargado, atardecer cargado, `progreso 0`, `opacidadAtardecer 0`;
  - puño arriba: crecimiento 1, `opacidadAtardecer` llega a 1;
  - mano abierta: floración y oleada de 54 destellos por flor (108 con las dos
    plantas), y 0 destellos después de ~2.5 s;
  - sin manos: `opacidadAtardecer` conservada;
  - reinicio: `progreso 0`, `opacidadAtardecer 0`, plantas en 0, oleada vacía y
    segundo ciclo con una oleada nueva;
  - `nubes: 3`, `destellosHorizonte: 12`.
- Capturas revisadas: inicial gris, crecimiento con atardecer, floración, 50 % de
  mezcla (colinas alineadas, sin doble borde) y reinicio en gris.
- Sin excepciones de JavaScript en consola (solo el error esperado de cámara).

## Log

### L1 — pedido original (verbatim)

> Reemplaza el fondo actual del lienzo por los dos PNG de la carpeta cuya ruta es C:\Users\USER\Desktop\fondo_proyecto: `fondo_gris_neblina.png` y `fondo_atardecer_color.png`.
>
> Coloca el fondo gris debajo y el atardecer a color encima, ambos detrás de las plantas. Usa el mismo tamaño, encuadre y punto de alineación para los dos fondos. Precarga ambos para que la transición se vea desde la primera interacción.
>
> Vincula la opacidad del atardecer al progreso de crecimiento que ya usa la animación de las plantas:
>
> 1. **Escena vacía o brote inicial.** El atardecer tiene opacidad `0` y se ve el paisaje gris con neblina.
> 2. **Mientras crece la planta.** Aumenta suavemente la opacidad del atardecer conforme sube el progreso del crecimiento. Si hay varias plantas, usa el mayor progreso alcanzado entre ellas.
> 3. **Altura máxima.** El atardecer llega a opacidad `1` y se mantiene a color mientras se abren las flores. Conserva el color si la mano baja o sale momentáneamente de cámara.
> 4. **Reinicio.** Devuelve la opacidad a `0` para que la siguiente interacción vuelva a empezar en gris.
>
> Aplica la transición únicamente a la capa del paisaje. Comprueba que el fondo llene el lienzo, que las colinas no den un salto visible al pasar de gris a color y que la secuencia funcione al crecer, florecer y reiniciar.
>
> Agrega nubes suaves y destellos sutiles en capas animadas **delante del paisaje y detrás de las plantas**. Vincula los efectos al progreso de crecimiento que ya controla la transición del fondo.
>
> - **Escena inicial.** Haz que dos o tres nubes difusas se desplacen lentamente en horizontal, a distintas velocidades. Empieza con tonos grises y una opacidad baja, entre `0.06` y `0.12`, para mantener el ambiente de neblina.
> - **Mientras crecen las plantas.** A medida que aparece el atardecer, cambia suavemente el tono de las nubes hacia rosa pálido o lila. Añade unos pocos destellos cálidos cerca del horizonte. Haz que aparezcan y se desvanezcan en momentos distintos, con una opacidad máxima de `0.18`.
> - **Al florecer.** Activa una breve oleada de destellos dorados y rosados detrás de las flores, una sola vez por floración. Después, deja que las nubes sigan moviéndose lentamente y que los destellos se apaguen.
> - **Al reiniciar.** Vuelve al fondo gris con las nubes en tonos grises y limpia los destellos pendientes para que cada ciclo empiece igual.
>
> Usa transiciones suaves de opacidad y movimiento. Mantén el paisaje fijo y comprueba que los efectos se vean durante la transición sin tapar las flores ni producir parpadeos.

### L2 — decisión de alcance (2026-11-11)

- Se preguntó qué hacer con la capa viva. El usuario eligió **conservar árboles, pasto y polvo**; se retiran humo y chimeneas porque los PNG no las tienen.

### L3 — implementación (2026-11-11)

- Dos PNG copiados a la raíz del proyecto.
- `FONDO_PAISAJE`, `NUBES`, `DESTELLOS_PAISAJE` y `OLEADA_FLORES` en `sketch.js`.
- `cargarFondosPaisaje()` con `new Image()` y `actualizarEncuadreFondo()` con encuadre `cover` compartido.
- `actualizarPaisajeInteractivo()`, `progresoDePlantas()`, `reiniciarEfectosPaisaje()` y la detección de reinicio por caída brusca del crecimiento.
- Nubes horneadas en dos variantes (gris y color) y cruzadas con `globalAlpha`, sin `tint()` por frame.
- `actualizarOleadaPorFlor()`: una oleada por planta y por floración, rearmada al cerrarse.
- Se retiraron del fondo generado cielo, suelo, piedras, ramas, fábricas y humo; se mantuvieron `CAPAS_SUELO` y `bordeDeSuelo()` para anclar árboles, pasto y plantas.
- `ResizeObserver` sobre `#lienzo-contenedor` para que el canvas llene el panel cuando la cámara cambia de estado.
- Verificación headless y capturas; documentación actualizada en `AGENTS.md`.

### L4 — plantas al frente (2026-11-11)

- Pedido del usuario: las plantas se mezclaban con el fondo y los árboles; bajar los árboles a ~50 % de opacidad.
- `ARBOLES.alfa = 0.5` aplicado con `tint()` al sprite y `globalAlpha` al follaje.
- Plantas agrandadas para leer como primer plano: orquídea `altura` 0.44 → 0.50 y tres flores 0.40 → 0.46. La base no se movió; el montaje escala completo porque `full = alto * def.altura`.
- Verificación headless repetida: crecimiento 1, `opacidadAtardecer` 1, floración y oleadas siguen funcionando, reinicio en 0.
