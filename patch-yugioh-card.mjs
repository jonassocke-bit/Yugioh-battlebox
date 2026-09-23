import fs from 'node:fs';
import path from 'node:path';
import { Canvas, FontLibrary, loadImage } from 'skia-canvas';

const assetImageRoot=path.resolve('renderer-assets','yugioh-card','yugioh','image');
const assetFontRoot=path.resolve('renderer-assets','yugioh-card','yugioh','font');

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

async function writePng(canvas,dest){
  if(typeof canvas.toFile==='function'){
    await canvas.toFile(dest);
  }else if(typeof canvas.saveAs==='function'){
    await canvas.saveAs(dest);
  }else{
    fs.writeFileSync(dest,await canvas.png);
  }
}

async function generateGermanAttributes(){
  let family='serif';
  const raceFont=path.join(assetFontRoot,'ygo-en-race.woff2');

  try{
    if(fs.existsSync(raceFont)){
      FontLibrary.use('YgoGermanAttribute',[raceFont]);
      family='"YgoGermanAttribute"';
    }
  }catch(e){
    console.warn('[attributes] custom font unavailable, using serif:',e.message);
  }

  let generated=0;
  for(const [key,label] of Object.entries(labels)){
    const src=path.join(assetImageRoot,`attribute-${key}.png`);
    const dest=path.join(assetImageRoot,`attribute-${key}-de.png`);
    if(!fs.existsSync(src)){
      console.warn('[attributes] base image missing:',src);
      continue;
    }

    const img=await loadImage(src);
    const canvas=new Canvas(img.width,img.height);
    const ctx=canvas.getContext('2d');
    ctx.drawImage(img,0,0,img.width,img.height);

    let size=Math.round(img.height*0.165);
    const maxWidth=img.width*0.92;
    ctx.textAlign='center';
    ctx.textBaseline='top';
    ctx.lineJoin='round';

    while(size>9){
      ctx.font=`${size}px ${family}`;
      if(ctx.measureText(label).width<=maxWidth) break;
      size--;
    }

    const y=Math.max(-1,Math.round(img.height*0.004));
    ctx.font=`${size}px ${family}`;
    ctx.strokeStyle='rgba(0,0,0,0.78)';
    ctx.lineWidth=Math.max(1,img.width*0.010);
    ctx.strokeText(label,img.width/2,y);
    ctx.fillStyle='#fff';
    ctx.fillText(label,img.width/2,y);

    await writePng(canvas,dest);
    generated++;
    console.log('[attributes]',label,'->',path.basename(dest));
  }

  console.log('[attributes] generated',generated,'of 9 German attribute images');
}

await generateGermanAttributes();
