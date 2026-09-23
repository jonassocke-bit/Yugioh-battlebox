import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve('node_modules', 'yugioh-card');
let patched = 0;
let scanned = 0;

function walk(dir){
  for(const entry of fs.readdirSync(dir, { withFileTypes: true })){
    const p = path.join(dir, entry.name);
    if(entry.isDirectory()) walk(p);
    else if(entry.isFile() && p.endsWith('.js')) processFile(p);
  }
}

function processFile(file){
  scanned++;
  let src = fs.readFileSync(file, 'utf8');
  if(!src.includes('text: leftBracket + this.data.monsterType + rightBracket')) return;
  const next = src.replace(
    /text:\s*leftBracket \+ this\.data\.monsterType \+ rightBracket,([\s\S]*?)fontSize:\s*effect\.fontSize,/m,
    (m, between) => `text: leftBracket + this.data.monsterType + rightBracket,${between}fontSize: effect.fontSize * 0.9,`
  );
  if(next !== src){
    fs.writeFileSync(file, next, 'utf8');
    patched++;
    console.log('[patch-yugioh-card] patched', file);
  }
}

if(fs.existsSync(root)) walk(root);
if(!patched){
  console.warn('[patch-yugioh-card] no monster-type leaf patched. scanned files:', scanned);
} else {
  console.log('[patch-yugioh-card] done. patched files:', patched, 'scanned:', scanned);
}
