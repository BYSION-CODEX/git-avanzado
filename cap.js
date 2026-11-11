const fs=require('fs');
let t=fs.readFileSync('planta.js','utf8');
const nl = t.includes('\r\n') ? '\r\n' : '\n';
const start=t.indexOf('  const PLANTAS = [');
const endMarker=nl+'  /* ---------- Sacudida ---------- */';
const end=t.indexOf(endMarker);
const orchidStart=t.indexOf('    {'+nl+"      id: 'orquidea',");
const orchidEnd=t.indexOf(nl+'  ];', orchidStart);
if(start<0||end<0||orchidStart<0||orchidEnd<0){throw new Error('bounds '+[start,end,orchidStart,orchidEnd])}
const entry=t.slice(orchidStart, orchidEnd);
const out=t.slice(0,start)+'  const PLANTAS = ['+nl+entry+nl+'  ];'+t.slice(end);
fs.writeFileSync('planta.js',out);
console.log('ok, entry chars',entry.length);
