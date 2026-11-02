import { cpSync, mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
// Preserve both existing public entry points: /docs/ and the root redirect.
mkdirSync('dist/docs',{recursive:true});
cpSync('docs','dist/docs',{recursive:true,filter:(src)=>!src.includes('realistik_sounds_source')});
cpSync('index.html','dist/index.html');
writeFileSync('dist/.nojekyll','');
const version = process.env.GITHUB_SHA?.slice(0,12) || Date.now().toString(36);
const file='dist/docs/index.html';
writeFileSync(file,readFileSync(file,'utf8').replace(/\?v=[\w.-]+/g,'?v='+version));
writeFileSync('dist/docs/version.json',JSON.stringify({version}));
console.log(`Built static release ${version}; no server files or secrets included.`);
