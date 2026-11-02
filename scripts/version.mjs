import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
const walk=(dir)=>readdirSync(dir,{withFileTypes:true}).flatMap((e)=>e.isDirectory()?walk(dir+'/'+e.name):[dir+'/'+e.name]);
const version=process.argv[2];if(!/^\d+$/.test(version||''))throw Error('Pass a numeric source version');
const imports=Object.fromEntries(walk('docs/js').filter((p)=>p.endsWith('.js')).sort().map((p)=>['./'+p.slice(5),'./'+p.slice(5)+'?v='+version]));
const file='docs/index.html';let html=readFileSync(file,'utf8');html=html.replace(/<script type="importmap">[\s\S]*?<\/script>/,`<script type="importmap">\n${JSON.stringify({imports},null,2)}\n  </script>`).replace(/\?v=\d+/g,'?v='+version);writeFileSync(file,html);
