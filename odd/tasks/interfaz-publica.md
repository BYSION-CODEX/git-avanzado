# Interfaz pública: "El cambio florece contigo"

Objetivo: rediseñar la interfaz para presentarla al público reutilizando la
detección de manos, la calibración, las animaciones y el reinicio que ya existen.
Solo cambian `index.html`, `style.css`, los textos de estado de `sketch.js`, las
cifras de `planta.js` y el interruptor de `debug-pose.js`.

## Specs

- S1. Escritorio: cuadrícula de dos columnas 1:2. El tercio izquierdo tiene el
  título, los gestos, los porcentajes y la cámara; el lienzo ocupa los dos
  tercios derechos con casi todo el alto.
- S2. Título «El cambio florece contigo» arriba a la izquierda, con Sirivennela
  desde `https://fonts.googleapis.com/css2?family=Sirivennela&display=swap`.
  El resto, sans serif legible. Sin subtítulo que anticipe la mecánica.
- S3. Cuatro iconos de lectura rápida debajo del título, cada uno con las dos
  manos y flechas donde ayuden: «Muestra tus puños», «Eleva los puños», «Abre
  las manos», «Mueve las manos». Los rótulos indican solo qué gesto hacer.
- S4. Cámara abajo a la izquierda, con la proporción del video y las guías
  alineadas. Solo avisos necesarios. La tabla de coordenadas, las confianzas y
  los puntos de seguimiento detallados quedan en el modo de diagnóstico.
- S5. Pantallas estrechas: los bloques se reordenan para mantener visibles el
  lienzo y la cámara durante la interacción. Al redimensionar se conservan las
  posiciones relativas de las plantas y el encuadre del paisaje.
- S6. Crecimiento y Floración legibles de un vistazo: cifras grandes, etiquetas
  chicas y barras discretas, en dos filas compactas con icono de mano derecha y
  de mano izquierda. Cada fila muestra los valores de su grupo.
- S7. Fondo exterior ciruela oscuro con degradado suave a lila apagado o verde
  jade; texto crema y acentos rosa, lavanda y jade. Detalles botánicos discretos
  en los márgenes del panel izquierdo. El lienzo sigue siendo el protagonista.

## Tasks

- T1 (S1, S5, S7) HTML y CSS nuevos: grilla 1:2, columna, lienzo, paleta y
  detalles botánicos. — inline
- T2 (S2, S3) título con Sirivennela, gestos con SVG de dos manos y flechas. — inline
- T3 (S4) cámara abajo, avisos públicos y bloque de diagnóstico. — inline
- T4 (S6) indicadores por grupo, cableados desde `planta.js`. — inline
- T5 (S4) `debug-pose.js` atado al modo diagnóstico. — inline

## Log

### L1 — pedido original (fragmentos verbatim)

> «Rediseña la interfaz de **El cambio florece contigo** para presentarla al
> público. Trabaja sobre la aplicación existente y reutiliza la detección de
> manos, la calibración, las animaciones de las plantas y el reinicio.»
> «En escritorio, usa una cuadrícula de dos columnas con proporción **1:2**.»
> «Quita el subtítulo que anticipa que los movimientos devuelven la vida al
> paisaje.»
> «Deja la tabla de coordenadas, las confianzas y los puntos de seguimiento
> detallados en el modo de diagnóstico.»
> «Mantén el lienzo como protagonista.»

### Evidencia

- Capturas de la página con Chrome headless a 1440×900, 1280×720, 900×1000 y
  480×1000: la grilla 1:2, el reordenado angosto y los bloques se ven como se
  espera. En la captura angosta la sonda midió `scroll = inner = 500` y el lienzo
  en 472 px de ancho: no hay desborde horizontal.
- `node --check` limpio en `sketch.js`, `planta.js` y `debug-pose.js`; todas las
  referencias `getElementById` de los tres scripts existen en `index.html` y no
  hay ids duplicados.
- `?diagnostico=1` muestra el bloque de detalle y ensancha la cámara; sin el
  parámetro no se ve nada de eso.
- Pendiente de probar a ojo con cámara real: la cámara y el esqueleto de
  diagnóstico necesitan un dispositivo de video.
