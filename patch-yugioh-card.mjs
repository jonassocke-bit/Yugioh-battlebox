import fs from 'node:fs';
import path from 'node:path';
import { Canvas, FontLibrary, loadImage } from 'skia-canvas';

const moduleRoot = path.resolve('node_modules', 'yugioh-card');
const assetImageRoot = path.resolve('renderer-assets', 'yugioh-card', 'yugioh', 'image');
const assetFontRoot = path.resolve('renderer-assets', 'yugioh-card', 'yugioh', 'font');

let typeLinePatched = 0;
let textFitPatched = 0;
let scanned = 0;

function walk(dir){
  if(!fs.existsSync(dir)) return;
  for(const entry of fs.readdirSync(dir,{withFileTypes:true})){
    const p=path.join(dir,entry.name);
    if(entry.isDirectory()) walk(p);
    else if(entry.isFile() && p.endsWith('.js')) patchJsFile(p);
  }
}

function patchJsFile(file){
  scanned++;
  let src=fs.readFileSync(file,'utf8');
  let next=src;

  // Nur die Monster-Typzeile: 56 px im EN-Stil -> effektiv 45,36 px.
  // Das sind 81 % der ursprünglichen Größe.
  if(next.includes('text: leftBracket + this.data.monsterType + rightBracket')){
    next=next.replace(
      /(text:\s*leftBracket \+ this\.data\.monsterType \+ rightBracket,[\s\S]*?fontSize:\s*)effect\.fontSize(?:\s*\*\s*[0-9.]+)?(,)/m,
      '$1effect.fontSize * 0.81$2'
    );
    if(next!==src) typeLinePatched++;
  }

  // Der Upstream-Renderer wechselt standardmäßig erst unter 70 % horizontaler
  // Kompression in den kleineren Font. Für längere deutsche Texte ist das zu spät.
  if(next.includes('autoSmallSizeScaleThreshold')){
    const before=next;
    next=next.replace(
      /const autoSmallSizeScaleThreshold = 0\.7;/,
      'const autoSmallSizeScaleThreshold = 0.90;'
    );
    if(next!==before) textFitPatched++;
  }

  if(next!==src) fs.writeFileSync(file,next,'utf8');
}

const labels={
  dark:'FINSTERNIS',
  light:'LICHT',
  earth:'ERDE',
  water:'WASSER',
  fire:'FEUER',
  wind:'WIND',
  divine:'GÖTTLICH',
  spell:'ZAUBER',
  trap:'FALLE'
};

async function generateGermanAttributes(){
  let family='serif';
  const raceFont=path.join(assetFontRoot,'ygo-en-race.woff2');
  try{
    if(fs.existsSync(raceFont)){
      FontLibrary.use('YgoGermanAttribute',[raceFont]);
      family='"YgoGermanAttribute"';
    }
  }catch(e){
    console.warn('[patch] attribute font fallback:',e.message);
  }

  for(const [key,label] of Object.entries(labels)){
    const src=path.join(assetImageRoot,`attribute-${key}.png`);
    const dest=path.join(assetImageRoot,`attribute-${key}-de.png`);
    if(!fs.existsSync(src)) {
      console.warn('[patch] missing base attribute:',src);
      continue;
    }

    const img=await loadImage(src);
    const canvas=new Canvas(img.width,img.height);
    const ctx=canvas.getContext('2d');
    ctx.drawImage(img,0,0,img.width,img.height);

    let size=Math.round(img.height*0.17);
    const maxWidth=img.width*0.91;
    ctx.textAlign='center';
    ctx.textBaseline='top';
    ctx.lineJoin='round';

    while(size>10){
      ctx.font=`${size}px ${family}`;
      if(ctx.measureText(label).width<=maxWidth) break;
      size--;
    }

    const y=Math.max(-2,Math.round(img.height*0.005));
    ctx.font=`${size}px ${family}`;
    ctx.strokeStyle='rgba(0,0,0,0.72)';
    ctx.lineWidth=Math.max(1.2,img.width*0.012);
    ctx.strokeText(label,img.width/2,y);
    ctx.fillStyle='#ffffff';
    ctx.fillText(label,img.width/2,y);

    // skia-canvas v2 heißt die Dateimethode noch saveAs(), v3 nennt sie toFile().
    // Der Fallback über .png hält den Patch mit beiden Major-Versionen kompatibel.
    if(typeof canvas.toFile==='function'){
      await canvas.toFile(dest);
    }else if(typeof canvas.saveAs==='function'){
      await canvas.saveAs(dest);
    }else{
      fs.writeFileSync(dest, await canvas.png);
    }
    console.log('[patch] generated',path.basename(dest),label);
  }
}

walk(moduleRoot);
await generateGermanAttributes();

console.log('[patch] scanned JS:',scanned);
console.log('[patch] monster-type patches:',typeLinePatched);
console.log('[patch] text-fit patches:',textFitPatched);

if(!typeLinePatched) {
  throw new Error('Monster-Typzeilen-Patch wurde nicht gefunden; Build abgebrochen statt still falsch zu rendern.');
}
if(!textFitPatched) {
  throw new Error('Text-Fit-Patch wurde nicht gefunden; Build abgebrochen statt still falsch zu rendern.');
}
