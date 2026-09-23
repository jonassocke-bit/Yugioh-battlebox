import express from 'express';
import path from 'node:path';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import crypto from 'node:crypto';
import skia from 'skia-canvas';
import { YugiohCard } from 'yugioh-card';

const app = express();
const PORT = Number(process.env.PORT || 10000);
const ASSET_ROOT = path.resolve('renderer-assets/yugioh-card');
const DECKS_PATH = path.resolve('decks.json');

// 1394×2031 native. 0.75 ≈ 1046×1523 px ≈ 450 dpi at 59×86 mm.
const RENDER_SCALE = 0.75;

const GITHUB_TOKEN = process.env.GITHUB_TOKEN || '';
const GITHUB_REPO = process.env.GITHUB_REPO || 'jonassocke-bit/Yugioh-battlebox';
const GITHUB_BRANCH = process.env.GITHUB_BRANCH || 'main';

let library = JSON.parse(await fs.readFile(DECKS_PATH, 'utf8'));

const jobs = new Map();
const metaCache = new Map();
const artworkCache = new Map();
const renderCache = new Map();
let githubWriteChain = Promise.resolve();

app.use(express.json({ limit: '2mb' }));
app.use((req,res,next)=>{
  res.setHeader('Access-Control-Allow-Origin','*');
  res.setHeader('Access-Control-Allow-Headers','Content-Type');
  res.setHeader('Access-Control-Allow-Methods','GET,POST,OPTIONS');
  if(req.method==='OPTIONS') return res.sendStatus(204);
  next();
});

const RACE_DE = {
  'Aqua':'AQUA','Beast':'UNGEHEUER','Beast-Warrior':'UNGEHEUER-KRIEGER',
  'Cyberse':'CYBERSE','Dinosaur':'DINOSAURIER','Divine-Beast':'GÖTTLICHES UNGEHEUER',
  'Dragon':'DRACHE','Fairy':'FEE','Fiend':'UNTERWELTLER','Fish':'FISCH',
  'Illusion':'ILLUSION','Insect':'INSEKT','Machine':'MASCHINE','Plant':'PFLANZE',
  'Psychic':'PSI','Pyro':'PYRO','Reptile':'REPTIL','Rock':'FELS',
  'Sea Serpent':'SEESCHLANGE','Spellcaster':'HEXER','Thunder':'DONNER',
  'Warrior':'KRIEGER','Winged Beast':'GEFLÜGELTES UNGEHEUER','Wyrm':'WYRM','Zombie':'ZOMBIE'
};
const iconMap = {
  'Equip': 'equip', 'Equip Card':'equip',
  'Field': 'field', 'Field Spell':'field',
  'Quick-Play': 'quick-play', 'Quick Play': 'quick-play', 'Quick-Play Spell':'quick-play',
  'Ritual': 'ritual', 'Ritual Spell':'ritual',
  'Continuous': 'continuous', 'Continuous Spell':'continuous', 'Continuous Trap':'continuous',
  'Counter': 'counter', 'Counter Trap':'counter',
  'Normal': ''
};

function safeKey(s=''){
  return String(s).normalize('NFD').replace(/[\u0300-\u036f]/g,'')
    .replace(/[^a-zA-Z0-9_-]+/g,'-').replace(/^-+|-+$/g,'').toLowerCase();
}
function cardKey(card){ return safeKey(card.key || card.set || card.en); }
function norm(s=''){ return safeKey(String(s).replace(/&/g,'and')); }
function cleanText(s=''){
  return String(s).replace(/\[[^\]]*\]/g,'').replace(/\s+/g,' ').trim();
}
function spellTrapIcon(en,de){
  const raw = String((en && en.race) || (de && de.race) || '').trim();
  return iconMap[raw] ?? '';
}
function descriptionStyle(desc, type){
  // Wichtig: keine First-Line-Kompression mehr. Sie konnte bei deutschen Texten
  // komplette Effekte horizontal in eine Mini-Zeile quetschen.
  // Das eigentliche Höhen-Fitting übernimmt der gepatchte CompressText-Renderer.
  return {
    descriptionZoom: 1,
    firstLineCompress: false,
    descriptionWeight: 0
  };
}
function mainType(en){
  if((en.type||'').includes('Spell')) return 'spell';
  if((en.type||'').includes('Trap')) return 'trap';
  return 'monster';
}
function uiType(en){
  if(mainType(en)==='spell') return 'Zauber';
  if(mainType(en)==='trap') return 'Falle';
  return 'Monster';
}
function cardType(en){
  const frame=String(en.frameType||'effect').toLowerCase();
  return ['normal','effect','ritual','fusion','synchro','xyz','link','token'].includes(frame)
    ? frame : ((en.type||'').includes('Normal Monster')?'normal':'effect');
}
const TYPELINE_DE = {
  'Normal':'',
  'Effect':'EFFEKT',
  'Ritual':'RITUAL',
  'Fusion':'FUSION',
  'Synchro':'SYNCHRO',
  'Xyz':'XYZ',
  'Link':'LINK',
  'Toon':'TOON',
  'Spirit':'SPIRIT',
  'Union':'UNION',
  'Gemini':'ZWILLING',
  'Tuner':'EMPFÄNGER',
  'Flip':'FLIPP',
  'Pendulum':'PENDEL',
  'Token':'SPIELMARKE'
};

function fallbackTypeline(en){
  const t=String(en.type||'');
  const parts=[en.race||'Monster'];
  if(t.includes('Ritual')) parts.push('Ritual');
  if(t.includes('Fusion')) parts.push('Fusion');
  if(t.includes('Synchro')) parts.push('Synchro');
  if(t.includes('Xyz')) parts.push('Xyz');
  if(t.includes('Link')) parts.push('Link');
  if(t.includes('Toon')) parts.push('Toon');
  if(t.includes('Spirit')) parts.push('Spirit');
  if(t.includes('Union')) parts.push('Union');
  if(t.includes('Gemini')) parts.push('Gemini');
  if(t.includes('Tuner')) parts.push('Tuner');
  if(t.includes('Flip')) parts.push('Flip');
  if(t.includes('Pendulum')) parts.push('Pendulum');
  if(t.includes('Token')) parts.push('Token');
  if(!t.includes('Normal Monster') && !t.includes('Token')) parts.push('Effect');
  else parts.push('Normal');
  return parts;
}

function germanMonsterType(en){
  const raw = Array.isArray(en.typeline) && en.typeline.length ? en.typeline : fallbackTypeline(en);
  const translated=[];
  for(const token of raw){
    const value = RACE_DE[token] ?? TYPELINE_DE[token] ?? String(token||'').toUpperCase();
    if(value && !translated.includes(value)) translated.push(value);
  }
  return translated.join('/');
}
async function fetchJSON(url,options={}){
  const r=await fetch(url,{...options,signal:AbortSignal.timeout(30000)});
  if(!r.ok) throw new Error(`HTTP ${r.status}: ${url}`);
  return await r.json();
}
async function findEnglishCard(card){
  const name=String(card.en||'').trim();
  if(!name) throw new Error('Kartenname fehlt.');

  try{
    const j=await fetchJSON(`https://db.ygoprodeck.com/api/v7/cardinfo.php?name=${encodeURIComponent(name)}`);
    if(j.data?.[0]) return j.data[0];
  }catch{}

  const j=await fetchJSON(`https://db.ygoprodeck.com/api/v7/cardinfo.php?fname=${encodeURIComponent(name)}`);
  const list=j.data||[];
  if(!list.length) throw new Error(`Karte nicht gefunden: ${name}`);

  const exact=list.find(x=>norm(x.name)===norm(name));
  if(exact) return exact;
  return list[0];
}
async function getCard(card){
  const k=norm(card.en);
  if(metaCache.has(k)) return metaCache.get(k);

  const en=await findEnglishCard(card);
  let de=null;
  try{
    const dj=await fetchJSON(`https://db.ygoprodeck.com/api/v7/cardinfo.php?id=${en.id}&language=de`);
    de=dj.data?.[0]||null;
  }catch{}

  const result={en,de:de||en};
  metaCache.set(k,result);
  return result;
}
async function artworkDataUrl(en){
  if(artworkCache.has(en.id)) return artworkCache.get(en.id);
  const url=en.card_images?.[0]?.image_url_cropped||en.card_images?.[0]?.image_url;
  if(!url) throw new Error(`Kein Artwork: ${en.name}`);
  const r=await fetch(url,{signal:AbortSignal.timeout(30000)});
  if(!r.ok) throw new Error(`Artwork HTTP ${r.status}: ${en.name}`);
  const type=r.headers.get('content-type')||'image/jpeg';
  const bytes=Buffer.from(await r.arrayBuffer());
  const data=`data:${type};base64,${bytes.toString('base64')}`;
  artworkCache.set(en.id,data);
  return data;
}
function rendererData(card,en,de,artwork){
  const type = mainType(en);
  const desc = de.desc || en.desc || '';
  const textFit = descriptionStyle(desc, type);
  const stIcon = type === 'monster' ? '' : spellTrapIcon(en,de);
  return {
    language:'en',font:'',name:de.name||card.de||en.name,color:'',align:'left',gradient:false,
    type,attribute:(en.attribute||'').toLowerCase(),icon:stIcon,iconName:stIcon,image:artwork,
    cardType:cardType(en),pendulumType:'normal-pendulum',level:en.level||0,rank:en.level||0,
    pendulumScale:0,pendulumDescription:'',monsterType:type==='monster'?germanMonsterType(en):'',
    atkBar:true,atk:Number.isFinite(en.atk)?en.atk:0,def:Number.isFinite(en.def)?en.def:0,
    arrowList:[],description:desc,descriptionAlign:false,
    package:card.set||'',password:en.id ? String(en.id).padStart(8,'0') : '',copyright:'en',laser:'laser1',rare:'',
    twentieth:false,radius:true,scale:RENDER_SCALE,
    ...textFit
  };
}

function germanAttributeUrl(en){
  const base=`${ASSET_ROOT}/yugioh/image`;
  const type=mainType(en);
  let key='';
  if(type==='spell') key='spell';
  else if(type==='trap') key='trap';
  else key=String(en.attribute||'').toLowerCase();

  if(!key) return '';

  const german=`${base}/attribute-${key}-de.png`;
  if(fsSync.existsSync(german)) return german;

  return `${base}/attribute-${key}-en.png`;
}

function formatGermanDescription(desc,en){
  let text=String(desc||'')
    .replace(/\r\n?/g,'\n')
    .replace(/[ \t]+\n/g,'\n')
    .replace(/\n[ \t]+/g,'\n')
    .trim();

  text=text.replace(/\s*●\s*/g,'\n●').replace(/^\n/,'');

  const isNormal=(en.type||'').includes('Normal Monster');
  if(!isNormal && text.length>=155){
    const paragraphs=text.split('\n').flatMap(part=>{
      if(part.length<135) return [part];
      const sentences=part.split(/(?<=[.!?])\s+(?=[A-ZÄÖÜ0-9„"'])/u).filter(Boolean);
      return sentences.length>1 ? sentences : [part];
    });
    text=paragraphs.join('\n');
  }

  return text;
}

function applyReliableCardPolish(instance,en,de){
  const type=mainType(en);
  const style=instance.style;

  const attrUrl=germanAttributeUrl(en);
  if(attrUrl && instance.attributeLeaf){
    instance.attributeLeaf.set({
      url:attrUrl,
      x:1163,
      y:96,
      visible:true,
      zIndex:40
    });
  }

  instance.data.laser='laser1';
  instance.drawLaser();
  if(instance.laserLeaf){
    instance.laserLeaf.set({
      url:`${ASSET_ROOT}/yugioh/image/laser1.png`,
      x:1276,
      y:1913,
      visible:true,
      zIndex:250
    });
  }

  let effectHeight=0;
  if(type==='monster' && instance.effectLeaf){
    const typeFontSize=style.effect.fontSize*0.80;
    effectHeight=typeFontSize*(style.effect.lineHeight||1);
    instance.effectLeaf.set({
      fontSize:typeFontSize,
      lineHeight:style.effect.lineHeight
    });
  }

  if(instance.descriptionLeaf){
    const desc=formatGermanDescription(de.desc||en.desc||'',en);
    const hasEffectLine=type==='monster' && Boolean(instance.data.monsterType);
    if(type==='monster' && !effectHeight && hasEffectLine){
      effectHeight=style.effect.fontSize*0.80*(style.effect.lineHeight||1);
    }

    let height=385;
    if(!['spell','trap'].includes(type)){
      if(hasEffectLine) height-=effectHeight;
      if(instance.data.atkBar) height-=60;
    }
    const y=style.effect.top+(hasEffectLine?effectHeight:0);

    const base={
      text:desc,
      firstLineCompress:false,
      autoSmallSize:false,
      fontSize:style.description.fontSize,
      lineHeight:style.description.lineHeight,
      width:1175,
      height,
      x:109,
      y
    };

    let chosen=1;
    for(let scale=1;scale>=0.74;scale-=0.03){
      instance.descriptionLeaf.set({...base,fontScale:Number(scale.toFixed(2))});
      const horizontal=Number(instance.descriptionLeaf.textScale||1);
      chosen=scale;
      if(horizontal>=0.97) break;
    }

    if(Number(instance.descriptionLeaf.textScale||1)<0.78){
      instance.descriptionLeaf.set({...base,fontScale:Math.max(0.70,chosen-0.04)});
    }
  }
}

function pngFromExport(data){
  if(Buffer.isBuffer(data)) return data;
  const m=String(data||'').match(/^data:image\/(?:png|jpeg);base64,(.+)$/);
  if(!m) throw new Error('Renderer lieferte kein PNG.');
  return Buffer.from(m[1],'base64');
}
async function renderCard(card,force=false){
  const k=cardKey(card);
  if(force) renderCache.delete(k);
  if(renderCache.has(k)) return renderCache.get(k);

  const {en,de}=await getCard(card);
  const art=await artworkDataUrl(en);
  const instance=new YugiohCard({data:rendererData(card,en,de,art),resourcePath:ASSET_ROOT,skia});

  if(mainType(en)==='spell'||mainType(en)==='trap'){
    Object.defineProperty(instance,'spellTrapName',{
      configurable:true,
      get(){return mainType(en)==='spell'?'Zauberkarte':'Fallenkarte'}
    });
    instance.drawSpellTrap();
  }

  applyReliableCardPolish(instance,en,de);

  try{
    const out=await instance.leafer.export('png',{screenshot:true});
    if(!out||out.error) throw new Error(out?.error?.message||'Renderer-Export fehlgeschlagen.');
    const png=pngFromExport(out.data);
    renderCache.set(k,png);
    return png;
  }finally{
    try{instance.leafer.destroy()}catch{}
  }
}

// ---------- GitHub persistence ----------
async function gh(pathname,init={}){
  if(!GITHUB_TOKEN) throw new Error('GITHUB_TOKEN fehlt auf Render.');
  const r=await fetch(`https://api.github.com/repos/${GITHUB_REPO}${pathname}`,{
    ...init,
    headers:{
      Accept:'application/vnd.github+json',
      Authorization:`Bearer ${GITHUB_TOKEN}`,
      'X-GitHub-Api-Version':'2022-11-28',
      'Content-Type':'application/json',
      ...(init.headers||{})
    },
    signal:AbortSignal.timeout(30000)
  });
  const text=await r.text();
  let data=null;
  try{data=text?JSON.parse(text):null}catch{data=text}
  if(!r.ok) throw new Error(`GitHub ${r.status}: ${typeof data==='string'?data:(data?.message||'Fehler')}`);
  return data;
}
function withGithubWrite(fn){
  const next=githubWriteChain.then(fn,fn);
  githubWriteChain=next.catch(()=>{});
  return next;
}
async function commitCardsToGithub(cardBuffers){
  if(!cardBuffers.length) return null;
  return withGithubWrite(async()=>{
    const ref=await gh(`/git/ref/heads/${encodeURIComponent(GITHUB_BRANCH)}`);
    const parentSha=ref.object.sha;
    const parentCommit=await gh(`/git/commits/${parentSha}`);
    const entries=[];

    for(const {key,png} of cardBuffers){
      const blob=await gh('/git/blobs',{
        method:'POST',
        body:JSON.stringify({content:png.toString('base64'),encoding:'base64'})
      });
      entries.push({path:`cards/${key}.png`,mode:'100644',type:'blob',sha:blob.sha});
    }

    const tree=await gh('/git/trees',{
      method:'POST',
      body:JSON.stringify({base_tree:parentCommit.tree.sha,tree:entries})
    });
    const commit=await gh('/git/commits',{
      method:'POST',
      body:JSON.stringify({
        message:`[skip render] Add ${cardBuffers.length} rendered Yu-Gi-Oh card${cardBuffers.length===1?'':'s'}`,
        tree:tree.sha,parents:[parentSha]
      })
    });
    await gh(`/git/refs/heads/${encodeURIComponent(GITHUB_BRANCH)}`,{
      method:'PATCH',body:JSON.stringify({sha:commit.sha,force:false})
    });
    return commit.sha;
  });
}


async function clearCardArchive(){
  if(!GITHUB_TOKEN) throw new Error('GITHUB_TOKEN fehlt auf Render.');

  return withGithubWrite(async()=>{
    const ref=await gh(`/git/ref/heads/${encodeURIComponent(GITHUB_BRANCH)}`);
    const parentSha=ref.object.sha;
    const parentCommit=await gh(`/git/commits/${parentSha}`);

    const tree=await gh(`/git/trees/${parentCommit.tree.sha}?recursive=1`);
    const cardFiles=(tree.tree||[]).filter(x=>
      x.type==='blob' &&
      typeof x.path==='string' &&
      x.path.startsWith('cards/')
    );

    if(!cardFiles.length){
      return {deleted:0,commitSha:null};
    }

    const deleteEntries=cardFiles.map(x=>({
      path:x.path,
      mode:'100644',
      type:'blob',
      sha:null
    }));

    const newTree=await gh('/git/trees',{
      method:'POST',
      body:JSON.stringify({
        base_tree:parentCommit.tree.sha,
        tree:deleteEntries
      })
    });

    const commit=await gh('/git/commits',{
      method:'POST',
      body:JSON.stringify({
        message:`[skip render] Clear rendered card archive (${cardFiles.length} files)`,
        tree:newTree.sha,
        parents:[parentSha]
      })
    });

    await gh(`/git/refs/heads/${encodeURIComponent(GITHUB_BRANCH)}`,{
      method:'PATCH',
      body:JSON.stringify({sha:commit.sha,force:false})
    });

    renderCache.clear();
    artworkCache.clear();

    return {deleted:cardFiles.length,commitSha:commit.sha};
  });
}

// ---------- Jobs ----------
function publicJob(job){
  return {
    id:job.id,state:job.state,progress:job.progress,label:job.label,error:job.error,force:Boolean(job.force),rendererVersion:'v14',
    persisted:job.persisted,commitSha:job.commitSha,outputs:[...job.outputs.keys()],
    cards:[...job.cardStates.values()]
  };
}
function patch(job,values){Object.assign(job,values)}
async function runRenderJob(job,cards){
  try{
    patch(job,{state:'running',progress:.02,label:'Auftrag wird vorbereitet …'});
    const rendered=[];

    for(let i=0;i<cards.length;i++){
      const c=cards[i],key=cardKey(c);
      job.cardStates.set(key,{key,name:c.de||c.en,state:'rendering'});
      patch(job,{progress:.04+(i/Math.max(1,cards.length))*.78,label:`Render ${i+1}/${cards.length}: ${c.de||c.en}`});
      try{
        const png=await renderCard(c,Boolean(job.force));
        job.outputs.set(key,png);
        rendered.push({key,png});
        job.cardStates.set(key,{key,name:c.de||c.en,state:'done'});
      }catch(e){
        job.cardStates.set(key,{key,name:c.de||c.en,state:'error',error:String(e.message||e)});
        throw e;
      }
    }

    if(GITHUB_TOKEN&&rendered.length){
      patch(job,{progress:.86,label:`${rendered.length} Karten werden dauerhaft in GitHub gespeichert …`});
      const sha=await commitCardsToGithub(rendered);
      patch(job,{persisted:true,commitSha:sha});
    }else{
      patch(job,{persisted:false});
    }

    patch(job,{state:'done',progress:1,label:GITHUB_TOKEN?'Fertig · in GitHub gespeichert':'Fertig · nur temporär'});
  }catch(e){
    console.error(e);
    patch(job,{state:'error',label:'Fehler',error:String(e.stack||e.message||e)});
  }
}


let githubHealthCache={at:0,status:'missing',writable:false,message:'Token fehlt'};
async function githubHealth(){
  const now=Date.now();
  if(now-githubHealthCache.at<60000) return githubHealthCache;
  if(!GITHUB_TOKEN){
    githubHealthCache={at:now,status:'missing',writable:false,message:'Token fehlt'};
    return githubHealthCache;
  }
  try{
    const r=await fetch(`https://api.github.com/repos/${GITHUB_REPO}`,{
      headers:{
        Accept:'application/vnd.github+json',
        Authorization:`Bearer ${GITHUB_TOKEN}`,
        'X-GitHub-Api-Version':'2022-11-28'
      },
      signal:AbortSignal.timeout(12000)
    });
    if(!r.ok) throw new Error(`GitHub HTTP ${r.status}`);
    const j=await r.json();
    const writable=Boolean(j.permissions?.push || j.permissions?.maintain || j.permissions?.admin);
    githubHealthCache={
      at:now,
      status:writable?'ok':'connected',
      writable,
      message:writable?'Schreibzugriff okay':'Token gültig, Schreibrecht nicht bestätigt'
    };
  }catch(e){
    githubHealthCache={at:now,status:'error',writable:false,message:String(e.message||e)};
  }
  return githubHealthCache;
}

// ---------- API ----------
app.get('/',async(req,res)=>{
  const ghState=await githubHealth();
  const ghColor=ghState.status==='ok'?'#63d69a':(ghState.status==='error'?'#ef7373':'#eabf67');
  res.type('html').send(`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1">
  <body style="font-family:-apple-system;background:#0e1116;color:#fff;padding:24px">
  <h1>YGO Card Renderer</h1>
  <p>Battle-Box Render-Service · 450 dpi · Renderer v0.16</p>
  <p>Server: <b style="color:#63d69a">läuft</b></p>
  <p>GitHub: <b style="color:${ghColor}">${ghState.message}</b></p>
  <p>Deckbibliothek: <b>${library.decks?.length||0} Decks</b></p>
  </body>`);
});

app.get('/health',async(req,res)=>{
  res.setHeader('Cache-Control','no-store');
  const ghState=await githubHealth();
  res.json({
    ok:true,version:'0.16-reliable-render',dpi:450,scale:RENDER_SCALE,
    githubPersistence:ghState.status==='ok',
    githubStatus:ghState.status,
    githubWritable:ghState.writable,
    githubMessage:ghState.message,
    repo:GITHUB_REPO,branch:GITHUB_BRANCH,
    libraryDecks:library.decks?.length||0,
    typeLineScale:0.80,
    forcedHologram:true,
    germanAttributesAvailable:fsSync.existsSync(`${ASSET_ROOT}/yugioh/image/attribute-fire-de.png`),
    descriptionFit:'uniform-scale-v2'
  });
});

app.post('/api/metadata',async(req,res)=>{
  try{
    const cards=Array.isArray(req.body?.cards)?req.body.cards.slice(0,100):[];
    const results=[];
    let cursor=0;
    async function worker(){
      while(cursor<cards.length){
        const i=cursor++,c=cards[i];
        try{
          const {en,de}=await getCard(c);
          results[i]={key:cardKey(c),en:en.name,de:de.name||en.name,type:uiType(en),id:en.id};
        }catch(e){
          results[i]={key:cardKey(c),en:c.en,de:c.de||c.en,type:c.type||'Monster',error:String(e.message||e)};
        }
      }
    }
    await Promise.all(Array.from({length:Math.min(4,cards.length||1)},worker));
    res.json({cards:results.filter(Boolean)});
  }catch(e){
    res.status(500).json({error:String(e.message||e)});
  }
});


app.post('/api/archive/clear',async(req,res)=>{
  try{
    const confirmText=String(req.body?.confirm||'');
    if(confirmText!=='DELETE CARDS'){
      return res.status(400).json({error:'Bestätigung fehlt.'});
    }

    const ghState=await githubHealth();
    if(ghState.status!=='ok'){
      return res.status(503).json({error:'GitHub-Schreibzugriff ist nicht aktiv.'});
    }

    const result=await clearCardArchive();
    githubHealthCache.at=0;
    res.json({
      ok:true,
      deleted:result.deleted,
      commitSha:result.commitSha,
      message:result.deleted
        ? `${result.deleted} Kartenbilder aus dem GitHub-Archiv gelöscht.`
        : 'Das Kartenarchiv war bereits leer.'
    });
  }catch(e){
    console.error(e);
    res.status(500).json({error:String(e.message||e)});
  }
});

app.post('/api/render',(req,res)=>{
  const cards=Array.isArray(req.body?.cards)?req.body.cards:[];
  const force=Boolean(req.body?.force);
  if(!cards.length) return res.status(400).json({error:'Keine Karten übergeben.'});
  if(cards.length>100) return res.status(400).json({error:'Maximal 100 Karten pro Auftrag.'});

  const clean=cards.map(c=>({
    key:c.key?String(c.key):undefined,set:c.set?String(c.set):'',en:String(c.en||''),
    de:String(c.de||''),type:String(c.type||'')
  })).filter(c=>c.en);
  if(!clean.length) return res.status(400).json({error:'Keine gültigen Karten.'});

  const id=crypto.randomUUID();
  const job={id,state:'queued',progress:0,label:'Wartet …',error:null,persisted:false,commitSha:null,
    force,outputs:new Map(),cardStates:new Map()};
  jobs.set(id,job);
  runRenderJob(job,clean);
  res.status(202).json({id});
});

app.get('/api/jobs/:id',(req,res)=>{
  const job=jobs.get(req.params.id);
  if(!job) return res.status(404).json({error:'Auftrag nicht gefunden.'});
  res.setHeader('Cache-Control','no-store');
  res.json(publicJob(job));
});
app.get('/api/jobs/:id/cards/:key.png',(req,res)=>{
  const job=jobs.get(req.params.id);
  if(!job) return res.status(404).send('Auftrag nicht gefunden.');
  const png=job.outputs.get(safeKey(req.params.key));
  if(!png) return res.status(404).send('Karte noch nicht vorhanden.');
  res.setHeader('Content-Type','image/png');
  res.setHeader('Cache-Control','public,max-age=3600');
  res.send(png);
});

setInterval(()=>{
  if(jobs.size<=12) return;
  const ids=[...jobs.keys()];
  for(const id of ids.slice(0,Math.max(0,ids.length-12))) jobs.delete(id);
},10*60*1000).unref();

app.listen(PORT,'0.0.0.0',()=>console.log(`YGO renderer v0.16 listening on ${PORT}`));
