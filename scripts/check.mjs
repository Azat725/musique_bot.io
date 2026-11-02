import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
const walk = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? walk(join(dir,e.name)) : [join(dir,e.name)]);
const html = readFileSync('docs/index.html','utf8');
const map = JSON.parse(html.match(/<script type="importmap">([\s\S]*?)<\/script>/)[1]).imports;
for (const file of walk('docs/js').filter((p)=>p.endsWith('.js'))) {
  execFileSync(process.execPath,['--check',file],{stdio:'pipe'});
  for (const [,name] of readFileSync(file,'utf8').matchAll(/(?:from\s*|import\s*)['"](\.[^'"]+)['"]/g)) {
    const target = resolve(dirname(file),name);
    if (!existsSync(target)) throw Error(`Missing import in ${file}: ${name}`);
    const key = './' + target.slice(resolve('docs').length+1).replaceAll('\\','/');
    if (!map[key]) throw Error(`Unversioned module: ${key}`);
  }
}
for (const file of walk('docs/css')) {
  if (/\b(?:linear|radial|conic)-gradient\(/.test(readFileSync(file,'utf8'))) throw Error(`Gradient in ${file}`);
}
for (const [key,url] of Object.entries(map)) if (!existsSync(join('docs',url.split('?')[0]))) throw Error(`Missing import map asset: ${key}`);
console.log('Syntax, module graph, import map and flat-colour checks passed.');
