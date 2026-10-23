import fs from 'node:fs';
import vm from 'node:vm';
const root=new URL('../',import.meta.url),scope={window:{}};
vm.runInNewContext(fs.readFileSync(new URL('table-layout.js',root),'utf8'),scope);
for(const [floor,points] of Object.entries(scope.window.PLES_TABLE_LAYOUT)){
  const balcony=floor==='balcony',width=balcony?1903:1920,height=balcony?1280:1310;
  const title=balcony?'Ochoz · balkón':'Velký sál · přízemí',file=balcony?'ochoz':'prizemi';
  const body=balcony
    ?'<path d="M16 110H1190L1095 260H334V1020H920L1070 1250H16Z" fill="#edf5fb" stroke="#bfd3e1" stroke-width="3"/><path d="M350 280H1390V1225H1105L940 1000H350Z" fill="#fafbfd" stroke="#dde5eb" stroke-width="3"/><text x="880" y="660" text-anchor="middle" fill="#728698" font-size="28">Pohled do sálu</text><text x="610" y="1115" text-anchor="middle" fill="#728698" font-size="22">Nečíslovaná místa nejsou součástí výběru</text>'
    :'<path d="M16 128H1420V260L1550 305V1095L1420 1145V1275H16Z" fill="#f2f7fb" stroke="#bfd3e1" stroke-width="3"/><rect x="835" y="360" width="540" height="705" rx="55" fill="#ffffff" stroke="#dce7ef" stroke-width="2" stroke-dasharray="9 10"/><text x="1105" y="690" text-anchor="middle" fill="#728698" font-size="30">Prostor sálu</text>';
  const tables=Object.entries(points).map(([n,p])=>{
    const vertical=balcony?Number(n)<=5:Number(n)<=14||(Number(n)>=45&&Number(n)<=58)||Number(n)>=69;
    const x=p.x/100*width,y=p.y/100*height,w=vertical?52:66,h=vertical?64:44;
    const chairs=vertical?[[-42,-23],[-42,10],[28,-23],[28,10]]:[[-26,-40],[10,-40],[-26,26],[10,26]];
    return `<g id="stul-${n}" transform="translate(${x.toFixed(2)} ${y.toFixed(2)})">${chairs.map(([a,b])=>`<rect x="${a}" y="${b}" width="16" height="14" rx="5" fill="#c6d9e7"/>`).join('')}<rect x="${-w/2}" y="${-h/2}" width="${w}" height="${h}" rx="10" fill="white" stroke="#8eafc5" stroke-width="2"/><text text-anchor="middle" dominant-baseline="central" fill="#234a65" font-size="28" font-weight="700">${n}</text></g>`;
  }).join('');
  const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-labelledby="title desc"><title id="title">${title}</title><desc id="desc">Čísla a polohy ${balcony?20:70} čtyřmístných stolů podle původního plánku Eurocentra. Schéma nezobrazuje aktuální dostupnost ani konkrétní přidělené židle.</desc><rect width="100%" height="100%" rx="32" fill="#fff"/><g font-family="Arial, sans-serif"><text x="32" y="40" fill="#728698" font-size="20" letter-spacing="3">EUROCENTRUM · JABLONEC NAD NISOU</text><text x="32" y="94" fill="#173a52" font-size="42" font-weight="700">${title}</text><text x="${width-40}" y="90" text-anchor="end" fill="#096bab" font-size="25">${balcony?'20 stolů · 80 míst':'70 stolů · 280 míst'}</text>${body}<rect x="1540" y="250" width="285" height="925" rx="28" fill="#dbeaf5" stroke="#abc7dc" stroke-width="3"/><text x="1682" y="715" text-anchor="middle" fill="#285875" font-size="28" font-weight="700" transform="rotate(-90 1682 715)" letter-spacing="5">PÓDIUM</text>${tables}</g></svg>`;
  fs.writeFileSync(new URL(`assets/plan-${file}.svg`,root),svg);
}
console.log('Built two vector seating plans from the original numbered layouts.');

const markers=Object.entries(scope.window.PLES_COMBINED_LAYOUT).map(([name,p])=>{
  const x=p.x*16,y=p.y*21,color=p.floor==='floor'?'#096bab':'#00834b';
  return `<g data-table="${name}" transform="translate(${x.toFixed(2)} ${y.toFixed(2)})"><rect x="-40" y="-33" width="80" height="66" rx="15" fill="${color}"/><text text-anchor="middle" dominant-baseline="central" fill="white" font-size="25" font-weight="700">${p.label}</text></g>`;
}).join('');
// Architectural cues are schematic; table coordinates are unchanged.
const doors=[335,575,1480].map(y=>`<g data-feature="door" transform="translate(240 ${y})"><title>Dveře do přízemí</title><path d="M0 0V75" stroke="white" stroke-width="12"/><path d="M0 0H-70M-70 0A70 70 0 0 0 0 70" fill="none" stroke="#7893a5" stroke-width="3"/></g>`).join('')+`<g data-feature="door" transform="translate(610 1730)"><title>Dveře v zadní části sálu</title><path d="M0 0H80" stroke="white" stroke-width="12"/><path d="M0 0V65M0 65A65 65 0 0 0 65 0" fill="none" stroke="#7893a5" stroke-width="3"/></g>`;
const combined=`<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="2100" viewBox="0 0 1600 2100" role="img" aria-labelledby="title desc">
<title id="title">Eurocentrum · přízemí a ochoz</title><desc id="desc">Schematický plánek dvou podlaží s jevištěm nahoře, navazujícím parketem, zkosením a dveřmi podle původního půdorysu. Modré P označuje 70 stolů v přízemí, zelené O dvacet stolů na ochozu. Pravá část ochozu je nepřístupná zvukařská kabina. Každý stůl má čtyři místa. Čísla stolů jsou zachována; proporce a dveře jsou schematické, nejde o evakuační plán.</desc>
<defs><pattern id="technical-hatch" width="22" height="22" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><path d="M0 0V22" stroke="#d4dce3" stroke-width="5"/></pattern></defs>
<rect width="1600" height="2100" rx="36" fill="#f9fbfd"/>
<g font-family="Arial,sans-serif"><text x="50" y="45" fill="#607a8e" font-size="22" letter-spacing="3">EUROCENTRUM · JABLONEC NAD NISOU</text>
<path d="M40 370H205V1730H1560V2050H40Z" fill="#e6f4ed" stroke="#b3d6c2" stroke-width="3"/>
<text x="125" y="325" fill="#006e40" font-size="25" font-weight="700" text-anchor="middle">O · OCHOZ</text>
<g data-feature="sound-booth"><rect x="1395" y="370" width="165" height="1360" rx="12" fill="#edf0f3" stroke="#becbd5" stroke-width="3"/><rect x="1395" y="370" width="165" height="1360" rx="12" fill="url(#technical-hatch)"/><rect x="1445" y="680" width="65" height="740" rx="12" fill="#edf0f3"/><text x="1477" y="1050" fill="#506779" font-size="25" font-weight="700" text-anchor="middle" transform="rotate(90 1477 1050)">ZVUKAŘSKÁ KABINA · NEPŘÍSTUPNÉ</text></g>
<path data-feature="hall-outline" d="M240 1730V300H365L420 235H1180L1235 300H1370V1730Z" fill="white" stroke="#a9c4d7" stroke-width="4"/>
<rect data-feature="stage" x="420" y="85" width="760" height="150" rx="12" fill="#173e59"/><text x="800" y="171" text-anchor="middle" fill="white" font-size="44" font-weight="700" letter-spacing="8">JEVIŠTĚ</text>
<text x="800" y="330" text-anchor="middle" fill="#096bab" font-size="27" font-weight="700">P · PŘÍZEMÍ</text>
<text x="800" y="580" fill="#6c8596" text-anchor="middle" font-size="30">Taneční parket</text>
${doors}${markers}
<text x="800" y="2080" text-anchor="middle" fill="#607a8e" font-size="17">Orientační plánek dvou podlaží · P přízemí · O ochoz</text></g></svg>`;
fs.writeFileSync(new URL('assets/plan-spolecny.svg',root),combined);
fs.writeFileSync(new URL('assets/plan-spolecny-podklad.svg',root),combined.replace(markers,''));
console.log('Built one combined, stage-up plan with all 90 numbered tables.');
