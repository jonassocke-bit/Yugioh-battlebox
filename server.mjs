import express from 'express';
import path from 'node:path';
import crypto from 'node:crypto';
import skia from 'skia-canvas';
import { YugiohCard } from 'yugioh-card';

const app = express();
const PORT = Number(process.env.PORT || 10000);
const ASSET_ROOT = path.resolve('renderer-assets/yugioh-card');

// 1394 × 2031 ist die native Größe des Renderers (~600 dpi).
// 0,75 ergibt ca. 1046 × 1523 px = ~450 dpi bei 59 × 86 mm.
const RENDER_SCALE = 0.75;

const GITHUB_TOKEN = process.env.GITHUB_TOKEN || '';
const GITHUB_REPO = process.env.GITHUB_REPO || 'jonassocke-bit/Yugioh-battlebox';
const GITHUB_BRANCH = process.env.GITHUB_BRANCH || 'main';

const jobs = new Map();
const metaCache = new Map();
const artworkCache = new Map();
const renderCache = new Map();

app.use(express.json({ limit: '1mb' }));
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
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

function safeKey(s='') {
  return String(s)
    .normalize('NFD').replace(/[\u0300-\u036f]/g,'')
    .replace(/[^a-zA-Z0-9_-]+/g,'-')
    .replace(/^-+|-+$/g,'')
    .toLowerCase();
}
function cardKey(card) {
  return safeKey(card.key || card.set || card.en);
}
function mainType(en) {
  if ((en.type || '').includes('Spell')) return 'spell';
  if ((en.type || '').includes('Trap')) return 'trap';
  return 'monster';
}
function cardType(en) {
  const frame = String(en.frameType || 'effect').toLowerCase();
  return ['normal','effect','ritual','fusion','synchro','xyz','link','token'].includes(frame)
    ? frame
    : ((en.type || '').includes('Normal Monster') ? 'normal' : 'effect');
}
function germanMonsterType(en) {
  const race = RACE_DE[en.race] || String(en.race || 'MONSTER').toUpperCase();
  const t = en.type || '';
  let kind = 'EFFEKT';
  if (t.includes('Normal Monster')) kind = 'NORMAL';
  else if (t.includes('Ritual')) kind = 'RITUAL / EFFEKT';
  else if (t.includes('Fusion')) kind = 'FUSION / EFFEKT';
  else if (t.includes('Synchro')) kind = 'SYNCHRO / EFFEKT';
  else if (t.includes('Xyz')) kind = 'XYZ / EFFEKT';
  else if (t.includes('Link')) kind = 'LINK / EFFEKT';
  return `${race} / ${kind}`;
}
async function fetchJSON(url, options={}) {
  const r = await fetch(url, { ...options, signal: AbortSignal.timeout(25000) });
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${url}`);
  return await r.json();
}
async function getCard(card) {
  const k = card.en;
  if (metaCache.has(k)) return metaCache.get(k);

  const enJ = await fetchJSON(`https://db.ygoprodeck.com/api/v7/cardinfo.php?name=${encodeURIComponent(card.en)}`);
  const en = enJ.data?.[0];
  if (!en) throw new Error(`Karte nicht gefunden: ${card.en}`);

  let de = null;
  try {
    const deJ = await fetchJSON(`https://db.ygoprodeck.com/api/v7/cardinfo.php?id=${en.id}&language=de`);
    de = deJ.data?.[0] || null;
  } catch {}

  const result = { en, de: de || en };
  metaCache.set(k, result);
  return result;
}
async function artworkDataUrl(en) {
  if (artworkCache.has(en.id)) return artworkCache.get(en.id);
  const url = en.card_images?.[0]?.image_url_cropped || en.card_images?.[0]?.image_url;
  if (!url) throw new Error(`Kein Artwork: ${en.name}`);

  const r = await fetch(url, { signal: AbortSignal.timeout(30000) });
  if (!r.ok) throw new Error(`Artwork HTTP ${r.status}: ${en.name}`);
  const type = r.headers.get('content-type') || 'image/jpeg';
  const bytes = Buffer.from(await r.arrayBuffer());
  const data = `data:${type};base64,${bytes.toString('base64')}`;
  artworkCache.set(en.id, data);
  return data;
}
function rendererData(card, en, de, artwork) {
  const type = mainType(en);
  return {
    language:'en',
    font:'',
    name:de.name || card.de || en.name,
    color:'',
    align:'left',
    gradient:false,
    type,
    attribute:(en.attribute || '').toLowerCase(),
    icon:iconMap[en.race] || '',
    image:artwork,
    cardType:cardType(en),
    pendulumType:'normal-pendulum',
    level:en.level || 0,
    rank:en.level || 0,
    pendulumScale:0,
    pendulumDescription:'',
    monsterType:type === 'monster' ? germanMonsterType(en) : '',
    atkBar:true,
    atk:Number.isFinite(en.atk) ? en.atk : 0,
    def:Number.isFinite(en.def) ? en.def : 0,
    arrowList:[],
    description:de.desc || en.desc || '',
    firstLineCompress:false,
    descriptionAlign:false,
    descriptionZoom:1,
    descriptionWeight:0,
    package:card.set || '',
    password:String(en.id || ''),
    copyright:'en',
    laser:'',
    rare:'',
    twentieth:false,
    radius:true,
    scale:RENDER_SCALE
  };
}
function pngFromExport(data) {
  if (Buffer.isBuffer(data)) return data;
  const m = String(data || '').match(/^data:image\/(?:png|jpeg);base64,(.+)$/);
  if (!m) throw new Error('Renderer lieferte kein PNG.');
  return Buffer.from(m[1], 'base64');
}
async function renderCard(card) {
  const k = cardKey(card);
  if (renderCache.has(k)) return renderCache.get(k);

  const { en, de } = await getCard(card);
  const art = await artworkDataUrl(en);
  const instance = new YugiohCard({
    data: rendererData(card, en, de, art),
    resourcePath: ASSET_ROOT,
    skia
  });

  if (mainType(en) === 'spell' || mainType(en) === 'trap') {
    Object.defineProperty(instance, 'spellTrapName', {
      configurable:true,
      get() { return mainType(en) === 'spell' ? 'Zauberkarte' : 'Fallenkarte'; }
    });
    instance.drawSpellTrap();
  }

  try {
    const out = await instance.leafer.export('png', { screenshot:true });
    if (!out || out.error) throw new Error(out?.error?.message || 'Renderer-Export fehlgeschlagen.');
    const png = pngFromExport(out.data);
    renderCache.set(k, png);
    return png;
  } finally {
    try { instance.leafer.destroy(); } catch {}
  }
}

async function gh(pathname, init={}) {
  if (!GITHUB_TOKEN) throw new Error('GITHUB_TOKEN fehlt auf Render.');
  const r = await fetch(`https://api.github.com/repos/${GITHUB_REPO}${pathname}`, {
    ...init,
    headers:{
      'Accept':'application/vnd.github+json',
      'Authorization':`Bearer ${GITHUB_TOKEN}`,
      'X-GitHub-Api-Version':'2022-11-28',
      'Content-Type':'application/json',
      ...(init.headers || {})
    },
    signal:AbortSignal.timeout(30000)
  });
  const text = await r.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!r.ok) throw new Error(`GitHub ${r.status}: ${typeof data === 'string' ? data : (data?.message || 'Fehler')}`);
  return data;
}

async function commitCardsToGithub(cardBuffers) {
  if (!cardBuffers.length) return null;

  const ref = await gh(`/git/ref/heads/${encodeURIComponent(GITHUB_BRANCH)}`);
  const parentSha = ref.object.sha;
  const parentCommit = await gh(`/git/commits/${parentSha}`);
  const treeEntries = [];

  for (const { key, png } of cardBuffers) {
    const blob = await gh('/git/blobs', {
      method:'POST',
      body:JSON.stringify({ content:png.toString('base64'), encoding:'base64' })
    });
    treeEntries.push({
      path:`cards/${key}.png`,
      mode:'100644',
      type:'blob',
      sha:blob.sha
    });
  }

  const tree = await gh('/git/trees', {
    method:'POST',
    body:JSON.stringify({ base_tree:parentCommit.tree.sha, tree:treeEntries })
  });

  const commit = await gh('/git/commits', {
    method:'POST',
    body:JSON.stringify({
      message:`Add ${cardBuffers.length} rendered Yu-Gi-Oh card${cardBuffers.length === 1 ? '' : 's'}`,
      tree:tree.sha,
      parents:[parentSha]
    })
  });

  await gh(`/git/refs/heads/${encodeURIComponent(GITHUB_BRANCH)}`, {
    method:'PATCH',
    body:JSON.stringify({ sha:commit.sha, force:false })
  });

  return commit.sha;
}

function publicJob(job) {
  return {
    id:job.id,
    state:job.state,
    progress:job.progress,
    label:job.label,
    error:job.error,
    persisted:job.persisted,
    commitSha:job.commitSha,
    outputs:[...job.outputs.keys()],
    cards:[...job.cardStates.values()]
  };
}
function patch(job, values) {
  Object.assign(job, values);
}
async function runRenderJob(job, cards) {
  try {
    patch(job, { state:'running', progress:0.02, label:'Auftrag wird vorbereitet …' });
    const rendered = [];

    for (let i=0;i<cards.length;i++) {
      const card = cards[i];
      const key = cardKey(card);
      job.cardStates.set(key, { key, name:card.de || card.en, state:'rendering' });
      patch(job, {
        progress:0.04 + (i / Math.max(1,cards.length)) * 0.78,
        label:`Render ${i+1}/${cards.length}: ${card.de || card.en}`
      });

      try {
        const png = await renderCard(card);
        job.outputs.set(key, png);
        rendered.push({ key, png });
        job.cardStates.set(key, { key, name:card.de || card.en, state:'done' });
      } catch (e) {
        job.cardStates.set(key, { key, name:card.de || card.en, state:'error', error:String(e.message || e) });
        throw e;
      }
    }

    if (GITHUB_TOKEN && rendered.length) {
      patch(job, { progress:0.86, label:`${rendered.length} Karten werden in GitHub gespeichert …` });
      const sha = await commitCardsToGithub(rendered);
      patch(job, { persisted:true, commitSha:sha });
    } else {
      patch(job, { persisted:false });
    }

    patch(job, { state:'done', progress:1, label:GITHUB_TOKEN ? 'Fertig · in GitHub gespeichert' : 'Fertig · nur temporär auf Render gespeichert' });
  } catch (e) {
    console.error(e);
    patch(job, { state:'error', label:'Fehler', error:String(e.stack || e.message || e) });
  }
}

app.get('/', (req,res) => {
  res.type('html').send(`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1">
  <body style="font-family:-apple-system;background:#0e1116;color:#fff;padding:24px">
  <h1>YGO Card Renderer</h1>
  <p>450-dpi Render-Service für die Battle-Box-Bibliothek.</p>
  <p>GitHub-Speicherung: <b>${GITHUB_TOKEN ? 'aktiv' : 'noch nicht konfiguriert'}</b></p>
  <p><a style="color:#e8c56a" href="/health">Health</a></p></body>`);
});

app.get('/health', (req,res) => {
  res.json({
    ok:true,
    version:'0.6-library-renderer',
    dpi:450,
    scale:RENDER_SCALE,
    githubPersistence:Boolean(GITHUB_TOKEN),
    repo:GITHUB_REPO,
    branch:GITHUB_BRANCH
  });
});

app.post('/api/render', (req,res) => {
  const cards = Array.isArray(req.body?.cards) ? req.body.cards : [];
  if (!cards.length) return res.status(400).json({ error:'Keine Karten übergeben.' });
  if (cards.length > 80) return res.status(400).json({ error:'Maximal 80 Karten pro Auftrag.' });

  const clean = cards.map(c => ({
    key:c.key ? String(c.key) : undefined,
    set:c.set ? String(c.set) : '',
    en:String(c.en || ''),
    de:String(c.de || ''),
    type:String(c.type || '')
  })).filter(c => c.en);

  if (!clean.length) return res.status(400).json({ error:'Keine gültigen Karten.' });

  const id = crypto.randomUUID();
  const job = {
    id,
    state:'queued',
    progress:0,
    label:'Wartet …',
    error:null,
    persisted:false,
    commitSha:null,
    outputs:new Map(),
    cardStates:new Map()
  };
  jobs.set(id, job);
  runRenderJob(job, clean);
  res.status(202).json({ id });
});

app.get('/api/jobs/:id', (req,res) => {
  const job = jobs.get(req.params.id);
  if (!job) return res.status(404).json({ error:'Auftrag nicht gefunden.' });
  res.json(publicJob(job));
});

app.get('/api/jobs/:id/cards/:key.png', (req,res) => {
  const job = jobs.get(req.params.id);
  if (!job) return res.status(404).send('Auftrag nicht gefunden.');
  const key = safeKey(req.params.key);
  const png = job.outputs.get(key);
  if (!png) return res.status(404).send('Karte noch nicht vorhanden.');
  res.setHeader('Content-Type','image/png');
  res.setHeader('Cache-Control','public, max-age=3600');
  res.send(png);
});

setInterval(() => {
  if (jobs.size <= 12) return;
  const ids = [...jobs.keys()];
  for (const id of ids.slice(0, Math.max(0, ids.length - 12))) jobs.delete(id);
}, 10 * 60 * 1000).unref();

app.listen(PORT, '0.0.0.0', () => {
  console.log(`YGO renderer v0.6 listening on ${PORT}`);
});
