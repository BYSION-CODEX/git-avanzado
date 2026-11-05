# AGENTS.md

Experiencia web interactiva de conciencia ambiental. p5.js + ml5.js por CDN,
sin build, sin package manager, sin tests.

## Estado

Estructura base + captura de video. La cámara se pide con `createCapture(VIDEO)`
y el stream se muestra en `#camara-contenedor`. **No hay ml5.js cargado, no hay
reconocimiento corporal, ni gestos, ni animación.**

Estados de la cámara en `sketch.js`, reflejados en `data-estado` del contenedor:
`iniciando` → `lista` → o `error`. Ojo: `createCapture` **solo llama al callback
si el stream carga**; si se niega el permiso no avisa, por eso hay un temporizador
de respaldo y un chequeo de `navigator.permissions`.

## Ejecutar

No hay paso de build. Servir la carpeta por HTTP desde la raíz del repo:

```powershell
npx serve . -l 8000
```

Abrir `http://localhost:8000`. `file://` NO sirve: la cámara necesita
`localhost` o HTTPS, y además los scripts por CDN fallan distinto ahí.
El permiso de cámara es por origen (host + puerto): usar siempre el mismo puerto.

Ojo: en esta máquina `python` es el alias de Microsoft Store y **no** está
instalado, así que `python -m http.server` falla. Usar `npx serve` o cualquier
otro servidor estático (Live Server de VS Code también sirve).

## Archivos

| Archivo | Rol |
|---|---|
| `index.html` | documento único: contenedor principal, espacio de cámara, espacio de lienzo y carga de librerías |
| `style.css` | todos los estilos de la interfaz |
| `sketch.js` | `setup()` / `draw()` de p5.js en modo global |

Tres archivos, nada más. Si aparece un módulo nuevo, registrarlo en
`index.html` en el orden correcto y documentarlo acá.

## Reglas

- **Nada de bundler, npm, frameworks ni ES modules.** `sketch.js` es un script
  clásico: `import`/`export` rompen la página. p5 está en modo global
  (`setup`, `draw`, `createCanvas`, … son globales).
- **Orden de carga en `index.html`**: p5.js → ml5.js (cuando se active) →
  `sketch.js`. `sketch.js` va último porque define `setup`/`draw`.
- **Versiones pinneadas**: p5 `2.3.3` (jsDelivr) y ml5 `1.4.0` (unpkg).
  Actualizar es una decisión deliberada, nunca un efecto de copiar un `<script>`.
- **ml5 está preparado pero comentado** en `index.html`. Se descomenta al
  integrar la detección de manos; no cargarlo antes evita ~1 MB inútil.
- El canvas se crea en `setup()` y se ancla con `canvas.parent(#lienzo-contenedor)`.
  No escribir `<canvas>` a mano en el HTML.
- `pixelDensity(1)`: sin esto, un monitor de alta densidad cuadruplica el costo.
- `noLoop()` está activo porque el placeholder es estático. Al empezar la
  animación hay que quitarlo (y el `redraw()` de `windowResized` deja de hacer falta).
- Todos los números y colores visibles viven en `:root` de `style.css`.

## Gotchas a respetar cuando se integre la cámara

- El `<video>` debe quedar **en el DOM** y no con `display: none`: sin superficie
  de render algunos navegadores dejan de entregar frames.
- La imagen de la cámara **no se dibuja** en el lienzo; solo se usan los landmarks.
- `ml5.handPose()` es una **fábrica síncrona**: devuelve la instancia y la promesa
  de carga es `instance.ready`. `await ml5.handPose()` no espera nada y el
  detector arranca contra un modelo nulo (cero manos, sin error).
- Coordenadas de mano siempre normalizadas `0..1`, nunca píxeles. El espejo
  (`x = 1 - x`) se aplica una sola vez, en la capa de detección.

## Git

Ramas `main` y `develop`. El proyecto anterior en Three.js + Vite está
preservado en la rama `feature/three-vite`; no es la versión activa.
