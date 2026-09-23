import express from 'express';
import path from 'node:path';
import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import skia from 'skia-canvas';
import * as cheerio from 'cheerio';
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
  'Equip Card':'equip','Field Spell':'field','Quick-Play Spell':'quick-play',
  'Ritual Spell':'ritual','Continuous Spell':'continuous',
  'Continuous Trap':'continuous','Counter Trap':'counter'
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
function germanMonsterType(en){
  const race=RACE_DE[en.race]||String(en.race||'MONSTER').toUpperCase();
  const t=en.type||'';
  let kind='EFFEKT';
  if(t.includes('Normal Monster')) kind='NORMAL';
  else if(t.includes('Ritual')) kind='RITUAL / EFFEKT';
  else if(t.includes('Fusion')) kind='FUSION / EFFEKT';
  else if(t.includes('Synchro')) kind='SYNCHRO / EFFEKT';
  else if(t.includes('Xyz')) kind='XYZ / EFFEKT';
  else if(t.includes('Link')) kind='LINK / EFFEKT';
  return `${race} / ${kind}`;
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
  const type=mainType(en);
  return {
    language:'en',font:'',name:de.name||card.de||en.name,color:'',align:'left',gradient:false,
    type,attribute:(en.attribute||'').toLowerCase(),icon:iconMap[en.race]||'',image:artwork,
    cardType:cardType(en),pendulumType:'normal-pendulum',level:en.level||0,rank:en.level||0,
    pendulumScale:0,pendulumDescription:'',monsterType:type==='monster'?germanMonsterType(en):'',
    atkBar:true,atk:Number.isFinite(en.atk)?en.atk:0,def:Number.isFinite(en.def)?en.def:0,
    arrowList:[],description:de.desc||en.desc||'',firstLineCompress:false,descriptionAlign:false,
    descriptionZoom:1,descriptionWeight:0,package:card.set||'',password:String(en.id||''),
    copyright:'en',laser:'',rare:'',twentieth:false,radius:true,scale:RENDER_SCALE
  };
}
function pngFromExport(data){
  if(Buffer.isBuffer(data)) return data;
  const m=String(data||'').match(/^data:image\/(?:png|jpeg);base64,(.+)$/);
  if(!m) throw new Error('Renderer lieferte kein PNG.');
  return Buffer.from(m[1],'base64');
}
async function renderCard(card){
  const k=cardKey(card);
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
async function persistLibraryToGithub(){
  if(!GITHUB_TOKEN) return null;
  return withGithubWrite(async()=>{
    const existing=await gh(`/contents/decks.json?ref=${encodeURIComponent(GITHUB_BRANCH)}`);
    const content=Buffer.from(JSON.stringify(library,null,2)+'\n','utf8').toString('base64');
    const result=await gh('/contents/decks.json',{
      method:'PUT',
      body:JSON.stringify({
        message:'[skip render] Resolve deck list in library',
        content,
        sha:existing.sha,
        branch:GITHUB_BRANCH
      })
    });
    return result.commit?.sha||null;
  });
}

// ---------- Fandom one-time set-list import ----------
function headerIndex(headers,patterns){
  return headers.findIndex(h=>patterns.some(p=>h.includes(p)));
}
function classifyCategory(s){
  const t=String(s||'').toLowerCase();
  if(t.includes('spell')||t.includes('zauber')) return 'Zauber';
  if(t.includes('trap')||t.includes('falle')) return 'Falle';
  return 'Monster';
}
async function importFandomSetList(deck){
  const url=deck.import?.url;
  if(!url || !/^https:\/\/yugioh\.fandom\.com\//i.test(url)) throw new Error('Ungültige Importquelle.');

  const r=await fetch(url,{
    headers:{'User-Agent':'Mozilla/5.0 YGO-BattleBox/0.9'},
    signal:AbortSignal.timeout(35000)
  });
  if(!r.ok) throw new Error(`Deckliste konnte nicht geladen werden (HTTP ${r.status}).`);
  const html=await r.text();
  const $=cheerio.load(html);

  let best=null;
  $('table').each((_,table)=>{
    const rows=$(table).find('tr');
    if(!rows.length) return;
    const headers=rows.first().find('th,td').map((__,el)=>cleanText($(el).text()).toLowerCase()).get();

    const setI=headerIndex(headers,['card number','set number','kartennummer','card no']);
    const enI=headerIndex(headers,['english name','englischer name','english']);
    const deI=headerIndex(headers,['german name','deutscher name','german']);
    const catI=headerIndex(headers,['category','kategorie']);
    const qtyI=headerIndex(headers,['qty','quantity','anzahl']);

    if(enI<0 || setI<0) return;
    const score=(deI>=0?3:0)+(catI>=0?2:0)+(qtyI>=0?2:0)+rows.length/100;
    if(!best || score>best.score) best={table,headers,setI,enI,deI,catI,qtyI,score};
  });

  if(!best) throw new Error('Auf der Quellseite wurde keine passende Kartenliste gefunden.');

  const cards=[];
  $(best.table).find('tr').slice(1).each((_,tr)=>{
    const cells=$(tr).find('th,td');
    if(!cells.length) return;
    const get=i=>i>=0?cleanText($(cells.get(i)).text()):'';
    const set=get(best.setI);
    const en=get(best.enI);
    const de=get(best.deI);
    const cat=get(best.catI);
    const qtyRaw=get(best.qtyI);
    if(!en || !set || /card number|set number/i.test(set)) return;

    const qMatch=qtyRaw.match(/\d+/);
    const qty=qMatch?Math.max(1,Number(qMatch[0])):1;
    cards.push({set,en,de:de||'',type:classifyCategory(cat),qty});
  });

  // Aggregate exact duplicate rows if a page lists copies separately.
  const map=new Map();
  for(const c of cards){
    const k=c.set||`${c.en}|${c.type}`;
    if(map.has(k)) map.get(k).qty+=c.qty;
    else map.set(k,{...c});
  }
  const result=[...map.values()];
  if(result.length<20) throw new Error(`Import unplausibel: nur ${result.length} verschiedene Karten gefunden.`);
  return result;
}

// ---------- Jobs ----------
function publicJob(job){
  return {
    id:job.id,state:job.state,progress:job.progress,label:job.label,error:job.error,
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
        const png=await renderCard(c);
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

// ---------- API ----------
app.get('/',(req,res)=>{
  res.type('html').send(`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1">
  <body style="font-family:-apple-system;background:#0e1116;color:#fff;padding:24px">
  <h1>YGO Card Renderer</h1>
  <p>Battle-Box Render-Service · 450 dpi</p>
  <p>Server: <b style="color:#63d69a">läuft</b></p>
  <p>GitHub-Token: <b style="color:${GITHUB_TOKEN?'#63d69a':'#eabf67'}">${GITHUB_TOKEN?'aktiv':'fehlt'}</b></p>
  <p>Deckbibliothek: <b>${library.decks?.length||0} Decks</b></p>
  </body>`);
});

app.get('/health',(req,res)=>{
  res.setHeader('Cache-Control','no-store');
  res.json({
    ok:true,version:'0.9-multideck-library',dpi:450,scale:RENDER_SCALE,
    githubPersistence:Boolean(GITHUB_TOKEN),repo:GITHUB_REPO,branch:GITHUB_BRANCH,
    libraryDecks:library.decks?.length||0
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

app.post('/api/import-deck',async(req,res)=>{
  try{
    const id=String(req.body?.id||'');
    const deck=library.decks.find(d=>d.id===id);
    if(!deck) return res.status(404).json({error:'Deck nicht gefunden.'});
    if(Array.isArray(deck.cards)&&deck.cards.length) return res.json({deck,persisted:true,alreadyResolved:true});
    if(deck.import?.provider!=='fandom-set-list') return res.status(400).json({error:'Für dieses Deck gibt es keinen Import.'});

    const cards=await importFandomSetList(deck);
    deck.cards=cards;
    deck.resolvedAt=new Date().toISOString();

    let persisted=false,commitSha=null;
    if(GITHUB_TOKEN){
      commitSha=await persistLibraryToGithub();
      persisted=true;
    }
    res.json({deck,persisted,commitSha});
  }catch(e){
    console.error(e);
    res.status(500).json({error:String(e.message||e)});
  }
});

app.post('/api/render',(req,res)=>{
  const cards=Array.isArray(req.body?.cards)?req.body.cards:[];
  if(!cards.length) return res.status(400).json({error:'Keine Karten übergeben.'});
  if(cards.length>100) return res.status(400).json({error:'Maximal 100 Karten pro Auftrag.'});

  const clean=cards.map(c=>({
    key:c.key?String(c.key):undefined,set:c.set?String(c.set):'',en:String(c.en||''),
    de:String(c.de||''),type:String(c.type||'')
  })).filter(c=>c.en);
  if(!clean.length) return res.status(400).json({error:'Keine gültigen Karten.'});

  const id=crypto.randomUUID();
  const job={id,state:'queued',progress:0,label:'Wartet …',error:null,persisted:false,commitSha:null,
    outputs:new Map(),cardStates:new Map()};
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

app.listen(PORT,'0.0.0.0',()=>console.log(`YGO renderer v0.9 listening on ${PORT}`));
