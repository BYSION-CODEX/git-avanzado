const fs=require('fs');
let t=fs.readFileSync('planta.js','utf8');
const rep=(a,b)=>{ if(!t.includes(a)) throw new Error('missing '+a.slice(0,60)); t=t.replace(a,b); };
rep("        hojaAlta.ancho * full * (0.35 + 0.65 * t),\r\n        -0.2 - (1 - t) * 0.35,\r\n        hojaAlta.ax,\r\n        hojaAlta.ay\r\n      );", "        hojaAlta.ancho * full * (0.35 + 0.65 * t),\r\n        -0.2 - (1 - t) * 0.35,\r\n        hojaAlta.ax,\r\n        hojaAlta.ay,\r\n        Math.min(1, apertura * 3)\r\n      );");
rep("        hojaPequena.ancho * full * (0.35 + 0.65 * t),\r\n        -1.03 - (1 - t) * 0.3,\r\n        hojaPequena.ax,\r\n        hojaPequena.ay\r\n      );", "        hojaPequena.ancho * full * (0.35 + 0.65 * t),\r\n        -1.03 - (1 - t) * 0.3,\r\n        hojaPequena.ax,\r\n        hojaPequena.ay,\r\n        Math.min(1, estado.ramas * 3)\r\n      );");
fs.writeFileSync('planta.js',t);
console.log('alpha ok');
