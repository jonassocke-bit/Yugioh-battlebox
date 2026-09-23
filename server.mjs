import express from 'express';
import path from 'node:path';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import crypto from 'node:crypto';
import skia from 'skia-canvas';
import { PDFDocument } from 'pdf-lib';
import { YugiohCard } from 'yugioh-card';

const app = express();
const PORT = Number(process.env.PORT || 10000);
const ASSET_ROOT = path.resolve('renderer-assets/yugioh-card');
const DATA_DIR = path.resolve('data');
const JOB_DIR = path.join(DATA_DIR, 'jobs');
const OUT_DIR = path.join(DATA_DIR, 'outputs');
const MM = 72 / 25.4;

// ~300 dpi direkt im Renderer
const RENDER_SCALE = 0.5;
const TARGET_W = Math.round(1394 * RENDER_SCALE);
const TARGET_H = Math.round(2031 * RENDER_SCALE);

const TEST_CARDS = [
  { en: 'Red-Eyes Darkness Dragon', de: 'Rotäugiger Finsterer Drache', set: 'SD1-DE001' },
  { en: 'Armed Dragon LV3', de: 'Bewaffneter Drache LV3', set: 'SD1-DE005' },
  { en: 'Mystical Space Typhoon', de: 'Mystischer Raum-Taifun', set: 'SD1-DE011' },
];

const DRAGONS_ROAR = [
  { en:'Red-Eyes Darkness Dragon', de:'Rotäugiger Finsterer Drache', set:'SD1-DE001', qty:1 },
  { en:'Red-Eyes Black Dragon', de:'Rotäugiger schwarzer Drache', set:'SD1-DE002', qty:1 },
  { en:'Luster Dragon', de:'Schimmerdrache', set:'SD1-DE003', qty:2 },
  { en:'Twin-Headed Behemoth', de:'Zweiköpfiger Behemoth', set:'SD1-DE004', qty:1 },
  { en:'Armed Dragon LV3', de:'Bewaffneter Drache LV3', set:'SD1-DE005', qty:2 },
  { en:'Armed Dragon LV5', de:'Bewaffneter Drache LV5', set:'SD1-DE006', qty:2 },
  { en:"Black Dragon's Chick", de:'Schwarzes Drachenküken', set:'SD1-DE007', qty:1 },
  { en:'Element Dragon', de:'Elementardrache', set:'SD1-DE008', qty:1 },
  { en:'Masked Dragon', de:'Maskierter Drache', set:'SD1-DE009', qty:3 },
  { en:'Snatch Steal', de:'Schnappstahl', set:'SD1-DE010', qty:1 },
  { en:'Mystical Space Typhoon', de:'Mystischer Raum-Taifun', set:'SD1-DE011', qty:1 },
  { en:'Nobleman of Crossout', de:'Adliger der Auslöschung', set:'SD1-DE012', qty:2 },
  { en:'Premature Burial', de:'Voreiliges Begräbnis', set:'SD1-DE013', qty:1 },
  { en:'Swords of Revealing Light', de:'Verräterische Schwerter', set:'SD1-DE014', qty:1 },
  { en:'Pot of Greed', de:'Topf der Gier', set:'SD1-DE015', qty:1 },
  { en:'Heavy Storm', de:'Schwerer Sturm', set:'SD1-DE016', qty:1 },
  { en:'Stamping Destruction', de:'Stampfende Zerstörung', set:'SD1-DE017', qty:3 },
  { en:'Creature Swap', de:'Kreaturentausch', set:'SD1-DE018', qty:2 },
  { en:'Reload', de:'Nachladen', set:'SD1-DE019', qty:2 },
  { en:'The Graveyard in the Fourth Dimension', de:'Friedhof in der Vierten Dimension', set:'SD1-DE020', qty:1 },
  { en:'Call of the Haunted', de:'Ruf der Gejagten', set:'SD1-DE021', qty:1 },
  { en:'Ceasefire', de:'Waffenstillstand', set:'SD1-DE022', qty:1 },
  { en:"The Dragon's Bead", de:'Perle des Drachen', set:'SD1-DE023', qty:1 },
  { en:"Dragon's Rage", de:'Drachenzorn', set:'SD1-DE024', qty:2 },
  { en:'Reckless Greed', de:'Tollkühne Gier', set:'SD1-DE025', qty:1 },
  { en:'Interdimensional Matter Transporter', de:'Interdimensionaler Materietransporter', set:'SD1-DE026', qty:2 },
  { en:'Trap Jammer', de:'Fallenfalle', set:'SD1-DE027', qty:1 },
  { en:'Curse of Anubis', de:'Fluch des Anubis', set:'SD1-DE028', qty:1 },
];

const LAYOUTS = {
  a3safe:  { pageW: 420, pageH: 297, cols: 6, rows: 3, orientation: 'landscape', label: 'A3 sicher · 18/Bogen' },
  a3tight: { pageW: 420, pageH: 297, cols: 7, rows: 3, orientation: 'landscape', label: 'A3 maximal · 21/Bogen' },
  sra3:    { pageW: 320, pageH: 450, cols: 5, rows: 5, orientation: 'portrait',  label: 'SRA3 · 25/Bogen' }
};

const metaCache = new Map();
const artworkCache = new Map();
const renderCache = new Map();
const scanCache = new Map();
const jobs = new Map();

const RACE_DE = {
  'Aqua': 'AQUA', 'Beast': 'UNGEHEUER', 'Beast-Warrior': 'UNGEHEUER-KRIEGER',
  'Cyberse': 'CYBERSE', 'Dinosaur': 'DINOSAURIER', 'Divine-Beast': 'GÖTTLICHES UNGEHEUER',
  'Dragon': 'DRACHE', 'Fairy': 'FEE', 'Fiend': 'UNTERWELTLER', 'Fish': 'FISCH',
  'Illusion': 'ILLUSION', 'Insect': 'INSEKT', 'Machine': 'MASCHINE', 'Plant': 'PFLANZE',
  'Psychic': 'PSI', 'Pyro': 'PYRO', 'Reptile': 'REPTIL', 'Rock': 'FELS',
  'Sea Serpent': 'SEESCHLANGE', 'Spellcaster': 'HEXER', 'Thunder': 'DONNER',
  'Warrior': 'KRIEGER', 'Winged Beast': 'GEFLÜGELTES UNGEHEUER', 'Wyrm': 'WYRM',
  'Zombie': 'ZOMBIE',
};

function esc(s='') {
  return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));
}
function slug(s='') {
  return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}
function ensureLayout(key) {
  return LAYOUTS[key] ? key : 'a3safe';
}
function totalCards(deck) {
  return deck.reduce((a,c)=>a + (c.qty || 1), 0);
}
function expandDeck(deck) {
  const arr = [];
  for (const card of deck) {
    for (let i=0; i<(card.qty || 1); i++) arr.push(card);
  }
  return arr;
}

async function ensureDirs() {
  await fs.mkdir(JOB_DIR, { recursive: true });
  await fs.mkdir(OUT_DIR, { recursive: true });
}
await ensureDirs();

function jobMetaPath(id) { return path.join(JOB_DIR, `${id}.json`); }
async function saveJob(job) {
  const meta = {
    id: job.id,
    state: job.state,
    progress: job.progress,
    label: job.label,
    error: job.error,
    createdAt: job.createdAt,
    updatedAt: Date.now(),
    task: job.task,
    mode: job.mode,
    layout: job.layout,
    resultPath: job.resultPath,
    contentType: job.contentType,
    filename: job.filename
  };
  await fs.writeFile(jobMetaPath(job.id), JSON.stringify(meta, null, 2), 'utf8');
}
async function loadJobsFromDisk() {
  try {
    const files = await fs.readdir(JOB_DIR);
    for (const file of files) {
      if (!file.endsWith('.json')) continue;
      try {
        const meta = JSON.parse(await fs.readFile(path.join(JOB_DIR, file), 'utf8'));
        jobs.set(meta.id, meta);
      } catch {}
    }
  } catch {}
}
await loadJobsFromDisk();

function patchJob(job, patch) {
  Object.assign(job, patch);
  saveJob(job).catch(console.error);
}
function jobPublic(job) {
  return {
    id: job.id,
    state: job.state,
    progress: job.progress ?? 0,
    label: job.label || '',
    error: job.error || null,
    ready: job.state === 'done',
    filename: job.filename || null,
    task: job.task,
    mode: job.mode,
    layout: job.layout
  };
}
function createJob({ task, mode='', layout='a3safe' }) {
  const id = crypto.randomUUID();
  const job = {
    id, task, mode, layout,
    state: 'queued',
    progress: 0,
    label: 'Wartet …',
    error: null,
    createdAt: Date.now(),
    resultPath: null,
    contentType: null,
    filename: null,
  };
  jobs.set(id, job);
  saveJob(job).catch(console.error);
  return job;
}
async function writeJobResult(job, buffer, contentType, filename) {
  const ext = contentType === 'application/pdf' ? 'pdf' : 'png';
  const outPath = path.join(OUT_DIR, `${job.id}.${ext}`);
  await fs.writeFile(outPath, buffer);
  patchJob(job, {
    state: 'done',
    progress: 1,
    label: 'Fertig',
    resultPath: outPath,
    contentType,
    filename
  });
}

async function fetchJSON(url) {
  const r = await fetch(url, { signal: AbortSignal.timeout(20000) });
  if (!r.ok) throw new Error(`YGOPRODeck API HTTP ${r.status}`);
  return await r.json();
}
async function getCard(card) {
  if (metaCache.has(card.en)) return metaCache.get(card.en);

  const enJSON = await fetchJSON(`https://db.ygoprodeck.com/api/v7/cardinfo.php?name=${encodeURIComponent(card.en)}`);
  const en = enJSON.data?.[0];
  if (!en) throw new Error(`Karte nicht gefunden: ${card.en}`);

  let de = null;
  try {
    const deJSON = await fetchJSON(`https://db.ygoprodeck.com/api/v7/cardinfo.php?id=${en.id}&language=de`);
    de = deJSON.data?.[0] || null;
  } catch {}

  const result = { en, de: de || en };
  metaCache.set(card.en, result);
  return result;
}
async function getArtworkDataUrl(en) {
  if (artworkCache.has(en.id)) return artworkCache.get(en.id);

  const url = en.card_images?.[0]?.image_url_cropped || en.card_images?.[0]?.image_url;
  if (!url) throw new Error(`Kein Artwork für ${en.name}`);

  const r = await fetch(url, { signal: AbortSignal.timeout(30000) });
  if (!r.ok) throw new Error(`Artwork HTTP ${r.status}`);

  const contentType = r.headers.get('content-type') || 'image/jpeg';
  const bytes = Buffer.from(await r.arrayBuffer());
  const dataUrl = `data:${contentType};base64,${bytes.toString('base64')}`;

  artworkCache.set(en.id, dataUrl);
  return dataUrl;
}

const iconMap = {
  'Equip Card': 'equip', 'Field Spell': 'field', 'Quick-Play Spell': 'quick-play',
  'Ritual Spell': 'ritual', 'Continuous Spell': 'continuous',
  'Continuous Trap': 'continuous', 'Counter Trap': 'counter'
};
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
function rendererData(card, en, de, artwork) {
  const type = mainType(en);
  return {
    language: 'en',
    font: '',
    name: de.name || card.de,
    color: '',
    align: 'left',
    gradient: false,
    type,
    attribute: (en.attribute || '').toLowerCase(),
    icon: iconMap[en.race] || '',
    image: artwork,
    cardType: cardType(en),
    pendulumType: 'normal-pendulum',
    level: en.level || 0,
    rank: en.level || 0,
    pendulumScale: 0,
    pendulumDescription: '',
    monsterType: type === 'monster' ? germanMonsterType(en) : '',
    atkBar: true,
    atk: Number.isFinite(en.atk) ? en.atk : 0,
    def: Number.isFinite(en.def) ? en.def : 0,
    arrowList: [],
    description: de.desc || en.desc || '',
    firstLineCompress: false,
    descriptionAlign: false,
    descriptionZoom: 1,
    descriptionWeight: 0,
    package: card.set,
    password: String(en.id || ''),
    copyright: 'en',
    laser: '',
    rare: '',
    twentieth: false,
    radius: true,
    scale: RENDER_SCALE
  };
}
function dataUrlToBuffer(data) {
  if (Buffer.isBuffer(data)) return data;
  if (typeof data !== 'string') throw new Error('Unbekanntes Renderer-Ausgabeformat');
  const m = data.match(/^data:image\/(?:png|jpeg);base64,(.+)$/);
  if (!m) throw new Error('Renderer lieferte keine PNG/JPEG-Data-URL');
  return Buffer.from(m[1], 'base64');
}
async function renderCard(card) {
  if (renderCache.has(card.en)) return renderCache.get(card.en);

  const { en, de } = await getCard(card);
  const artwork = await getArtworkDataUrl(en);

  const instance = new YugiohCard({
    data: rendererData(card, en, de, artwork),
    resourcePath: ASSET_ROOT,
    skia
  });

  if (mainType(en) === 'spell' || mainType(en) === 'trap') {
    Object.defineProperty(instance, 'spellTrapName', {
      configurable: true,
      get() {
        return mainType(en) === 'spell' ? 'Zauberkarte' : 'Fallenkarte';
      }
    });
    instance.drawSpellTrap();
  }

  try {
    const result = await instance.leafer.export('png', { screenshot: true });
    if (!result || result.error) {
      throw new Error(result?.error?.message || 'Renderer-Export fehlgeschlagen');
    }
    const png = dataUrlToBuffer(result.data);
    renderCache.set(card.en, png);
    return png;
  } finally {
    try { instance.leafer.destroy(); } catch {}
  }
}
async function fetchFullScan(card) {
  if (scanCache.has(card.en)) return scanCache.get(card.en);
  const { en } = await getCard(card);
  const url = en.card_images?.[0]?.image_url;
  if (!url) throw new Error(`Kein Komplettbild für ${card.en}`);

  const r = await fetch(url, { signal: AbortSignal.timeout(30000) });
  if (!r.ok) throw new Error(`Scan HTTP ${r.status}`);

  const bytes = Buffer.from(await r.arrayBuffer());
  scanCache.set(card.en, bytes);
  return bytes;
}

function cropMarks(pdf, layout, sxPt, syPt, cardWPt, cardHPt) {
  const gap = 0.65 * MM;
  const mark = 2.0 * MM;
  const right = sxPt + layout.cols * cardWPt;
  const bottom = syPt + layout.rows * cardHPt;
  const page = pdf.getPages()[pdf.getPages().length - 1];
  for (let i = 0; i <= layout.cols; i++) {
    const x = sxPt + i * cardWPt;
    page.drawLine({ start: {x, y: syPt - gap - mark}, end: {x, y: syPt - gap}, thickness: 0.2 });
    page.drawLine({ start: {x, y: bottom + gap}, end: {x, y: bottom + gap + mark}, thickness: 0.2 });
  }
  for (let i = 0; i <= layout.rows; i++) {
    const y = syPt + i * cardHPt;
    page.drawLine({ start: {x: sxPt - gap - mark, y}, end: {x: sxPt - gap, y}, thickness: 0.2 });
    page.drawLine({ start: {x: right + gap, y}, end: {x: right + gap + mark, y}, thickness: 0.2 });
  }
}

async function makeThreeCardPdf(mode='render', progress=()=>{}) {
  progress({ progress: 0.05, label: 'PDF wird vorbereitet …' });

  const pdf = await PDFDocument.create();
  const page = pdf.addPage([420*MM, 297*MM]);
  const cw = 59*MM, ch = 86*MM, gap = 5*MM;
  const totalW = 3*cw + 2*gap;
  let x = (420*MM - totalW) / 2;
  const y = (297*MM - ch) / 2;

  for (let i = 0; i < TEST_CARDS.length; i++) {
    const card = TEST_CARDS[i];
    progress({ progress: 0.1 + (i / TEST_CARDS.length) * 0.75, label: `${mode === 'render' ? 'Render' : 'Scan'} ${i+1}/${TEST_CARDS.length}: ${card.de}` });
    const bytes = mode === 'scan' ? await fetchFullScan(card) : await renderCard(card);
    const img = mode === 'scan'
      ? await (async()=>{ try { return await pdf.embedJpg(bytes); } catch { return await pdf.embedPng(bytes); } })()
      : await pdf.embedPng(bytes);
    page.drawImage(img, { x, y, width: cw, height: ch });
    x += cw + gap;
  }

  progress({ progress: 0.92, label: 'PDF wird zusammengesetzt …' });
  const result = Buffer.from(await pdf.save());
  progress({ progress: 1, label: 'Fertig' });
  return result;
}

async function makeDeckPdf(deck, mode='render', layoutKey='a3safe', progress=()=>{}) {
  const layout = LAYOUTS[ensureLayout(layoutKey)];
  const copies = expandDeck(deck);
  const unique = deck;
  const cardWPt = 59 * MM;
  const cardHPt = 86 * MM;
  const cap = layout.cols * layout.rows;

  progress({ progress: 0.03, label: 'Deckauftrag wird vorbereitet …' });

  if (mode === 'render') {
    for (let i = 0; i < unique.length; i++) {
      const card = unique[i];
      progress({
        progress: 0.04 + (i / unique.length) * 0.60,
        label: `Render ${i+1}/${unique.length}: ${card.de}`
      });
      await renderCard(card);
    }
  } else {
    for (let i = 0; i < unique.length; i++) {
      const card = unique[i];
      progress({
        progress: 0.04 + (i / unique.length) * 0.35,
        label: `Scan ${i+1}/${unique.length}: ${card.de}`
      });
      await fetchFullScan(card);
    }
  }

  const pdf = await PDFDocument.create();
  const numPages = Math.ceil(copies.length / cap);

  for (let p = 0; p < numPages; p++) {
    const pageSize = [layout.pageW * MM, layout.pageH * MM];
    const page = pdf.addPage(pageSize);
    const sx = (pageSize[0] - layout.cols * cardWPt) / 2;
    const sy = (pageSize[1] - layout.rows * cardHPt) / 2;
    const chunk = copies.slice(p * cap, (p + 1) * cap);

    for (let slot = 0; slot < chunk.length; slot++) {
      const card = chunk[slot];
      const row = Math.floor(slot / layout.cols);
      const col = slot % layout.cols;
      const x = sx + col * cardWPt;
      const y = sy + (layout.rows - 1 - row) * cardHPt;

      const cardIndex = p * cap + slot;
      progress({
        progress: (mode === 'render' ? 0.66 : 0.41) + (cardIndex / copies.length) * 0.28,
        label: `Seite ${p+1}/${numPages} · Karte ${cardIndex+1}/${copies.length}: ${card.de}`
      });

      const bytes = mode === 'scan' ? scanCache.get(card.en) : renderCache.get(card.en);
      const img = mode === 'scan'
        ? await (async()=>{ try { return await pdf.embedJpg(bytes); } catch { return await pdf.embedPng(bytes); } })()
        : await pdf.embedPng(bytes);

      page.drawImage(img, { x, y, width: cardWPt, height: cardHPt });
    }

    cropMarks(pdf, layout, sx, sy, cardWPt, cardHPt);
  }

  progress({ progress: 0.96, label: 'PDF wird gespeichert …' });
  return Buffer.from(await pdf.save());
}

async function runJob(job) {
  try {
    patchJob(job, { state: 'running', progress: 0.01, label: 'Server bereitet den Auftrag vor …', error: null });

    if (job.task === 'card') {
      patchJob(job, { progress: 0.08, label: 'Testkarte wird gerendert …' });
      const png = await renderCard(TEST_CARDS[1]);
      await writeJobResult(job, png, 'image/png', 'Bewaffneter_Drache_LV3.png');
      return;
    }

    if (job.task === 'pdf3') {
      const mode = job.mode === 'scan' ? 'scan' : 'render';
      const pdf = await makeThreeCardPdf(mode, p => patchJob(job, p));
      await writeJobResult(job, pdf, 'application/pdf', `YGO_${mode}_test.pdf`);
      return;
    }

    if (job.task === 'deck') {
      const mode = job.mode === 'scan' ? 'scan' : 'render';
      const layoutKey = ensureLayout(job.layout);
      const pdf = await makeDeckPdf(DRAGONS_ROAR, mode, layoutKey, p => patchJob(job, p));
      await writeJobResult(
        job,
        pdf,
        'application/pdf',
        `Dragons_Roar_${mode === 'render' ? 'GermanRender' : 'BestScan'}_${layoutKey}.pdf`
      );
      return;
    }

    throw new Error('Unbekannter Auftrag');
  } catch (e) {
    console.error(e);
    patchJob(job, {
      state: 'error',
      label: 'Fehler',
      error: String(e.stack || e.message || e)
    });
  }
}

setInterval(async () => {
  const cutoff = Date.now() - 24 * 60 * 60 * 1000;
  for (const [id, job] of jobs) {
    if ((job.createdAt || 0) < cutoff) {
      jobs.delete(id);
      try { await fs.unlink(jobMetaPath(id)); } catch {}
      if (job.resultPath) { try { await fs.unlink(job.resultPath); } catch {} }
    }
  }
}, 10 * 60 * 1000).unref();

function shell(title, body) {
  return `<!doctype html>
  <html lang="de">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
    <meta name="theme-color" content="#0e1116">
    <title>${esc(title)}</title>
    <style>
      :root{color-scheme:dark}
      *{box-sizing:border-box}
      body{margin:0;background:#0e1116;color:#f4f6f8;font-family:-apple-system,BlinkMacSystemFont,"SF Pro Text",Arial,sans-serif}
      .wrap{max-width:760px;margin:auto;padding:calc(20px + env(safe-area-inset-top)) 16px calc(34px + env(safe-area-inset-bottom))}
      h1{font-size:31px;margin:6px 0 8px}
      .sub{color:#a7b0bf;line-height:1.5}
      .card{margin-top:18px;background:#171c24;border:1px solid #313a49;border-radius:18px;padding:16px}
      .grid{display:grid;grid-template-columns:1fr 1fr;gap:10px}
      @media(max-width:680px){ .grid{grid-template-columns:1fr} }
      .btn{display:block;width:100%;text-align:center;text-decoration:none;padding:15px;border-radius:14px;margin:10px 0;background:#202733;border:1px solid #394353;color:#fff;font-weight:700;font:inherit}
      button.btn{cursor:pointer}
      button:disabled{opacity:.45}
      .primary{background:#e8c56a;color:#18130a;border:0}
      .ok{color:#63d69a}
      .bad{color:#ef7373;white-space:pre-wrap;font-size:12px}
      .small{font-size:12px;color:#9da8b8;line-height:1.45}
      .pill{display:inline-block;border:1px solid #313a49;background:#11161d;padding:6px 10px;border-radius:999px;font-size:12px;margin:0 8px 8px 0;color:#a7b0bf}
      .progressbox{margin-top:16px;display:none}
      .bar{height:12px;background:#2a303a;border-radius:999px;overflow:hidden}
      .bar > i{display:block;width:0;height:100%;background:#e8c56a;transition:width .25s ease}
      .progressrow{display:flex;justify-content:space-between;gap:12px;margin-top:8px;font-size:13px;color:#a7b0bf}
      #progressLabel{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      .row{display:flex;gap:12px;align-items:center;flex-wrap:wrap}
      select{background:#202733;border:1px solid #394353;color:#fff;border-radius:12px;padding:11px 12px;font:inherit}
      a.inline{color:#e8c56a}
    </style>
  </head>
  <body><div class="wrap">${body}</div></body>
  </html>`;
}

app.get('/', (req,res) => {
  res.type('html').send(shell('YGO Render Server', `
    <div class="sub">CLASSIC BATTLE BOX · SERVER V0.5</div>
    <h1>Dragon's Roar</h1>
    <div class="sub">
      Läuft jetzt mit <b>300 dpi</b> direkt im Renderer, sichtbarem Fortschrittsbalken
      und <b>Job-Fortsetzung</b>: Wenn du die Seite schließt und später zurückkommst,
      wird der letzte Auftrag automatisch wieder verbunden.
    </div>

    <div style="margin-top:14px">
      <span class="pill">Rendergröße: ${TARGET_W} × ${TARGET_H}px</span>
      <span class="pill">Dragon's Roar: ${DRAGONS_ROAR.length} einzigartige Karten</span>
      <span class="pill">Gesamt: ${totalCards(DRAGONS_ROAR)} Karten</span>
    </div>

    <div class="card">
      <div class="ok"><b>Server läuft.</b></div>

      <div class="row" style="margin-top:12px">
        <label for="layoutSel" class="small" style="margin:0">Layout:</label>
        <select id="layoutSel">
          <option value="a3safe">A3 sicher · 18/Bogen</option>
          <option value="a3tight">A3 maximal · 21/Bogen</option>
          <option value="sra3">SRA3 · 25/Bogen</option>
        </select>
      </div>

      <div class="grid" style="margin-top:10px">
        <button class="btn primary jobBtn" data-task="card">1. Testkarte rendern</button>
        <button class="btn jobBtn" data-task="pdf3" data-mode="render">2. 3-Karten Render-PDF</button>
        <button class="btn jobBtn" data-task="pdf3" data-mode="scan">3. 3-Karten Scan-PDF</button>
        <button class="btn primary jobBtn" data-task="deck" data-mode="render">4. Dragon's Roar Render-PDF</button>
        <button class="btn jobBtn" data-task="deck" data-mode="scan">5. Dragon's Roar Scan-PDF</button>
      </div>

      <div id="resumeBox" class="small" style="display:none;margin-top:12px">
        Letzter Auftrag gefunden. Verbinde wieder …
      </div>

      <div id="progressBox" class="progressbox">
        <div class="bar"><i id="progressFill"></i></div>
        <div class="progressrow">
          <span id="progressLabel">Start …</span>
          <b id="progressPct">0 %</b>
        </div>
      </div>

      <div id="doneBox" class="small" style="display:none;margin-top:12px">
        Fertig. <a id="doneLink" class="inline" href="#">Datei öffnen</a>
      </div>

      <div id="errorBox" class="bad"></div>

      <div class="small" style="margin-top:14px">
        Bei Deck-PDFs wird jede unterschiedliche Karte nur einmal gerechnet und danach
        mehrfach ins PDF gesetzt. Das spart deutlich Zeit.
      </div>
    </div>

    <script>
      const buttons=[...document.querySelectorAll('.jobBtn')];
      const box=document.getElementById('progressBox');
      const fill=document.getElementById('progressFill');
      const label=document.getElementById('progressLabel');
      const pct=document.getElementById('progressPct');
      const err=document.getElementById('errorBox');
      const resumeBox=document.getElementById('resumeBox');
      const doneBox=document.getElementById('doneBox');
      const doneLink=document.getElementById('doneLink');
      const layoutSel=document.getElementById('layoutSel');

      let activeJobId=null;
      let pollTimer=null;

      const savedLayout=localStorage.getItem('ygo_layout');
      if(savedLayout) layoutSel.value=savedLayout;
      layoutSel.addEventListener('change',()=>localStorage.setItem('ygo_layout',layoutSel.value));

      function setBusy(busy){ buttons.forEach(b=>b.disabled=busy); }
      function setProgress(p, text){
        box.style.display='block';
        fill.style.width=(Math.max(0,Math.min(1,p))*100).toFixed(1)+'%';
        pct.textContent=Math.round(Math.max(0,Math.min(1,p))*100)+' %';
        label.textContent=text || '…';
      }
      function rememberJob(id){
        activeJobId=id;
        localStorage.setItem('ygo_active_job', id);
      }
      function clearRememberedJob(){
        activeJobId=null;
        localStorage.removeItem('ygo_active_job');
      }

      async function pollJob(id){
        if (pollTimer) clearTimeout(pollTimer);
        try{
          const r=await fetch('/api/job/'+id,{cache:'no-store'});
          const j=await r.json();
          if(!r.ok) throw new Error(j.error||'Jobstatus konnte nicht geladen werden.');

          rememberJob(id);
          setProgress(Number(j.progress)||0, j.label || '…');

          if(j.state==='running' || j.state==='queued'){
            resumeBox.style.display='block';
            doneBox.style.display='none';
            setBusy(true);
            pollTimer=setTimeout(()=>pollJob(id), 800);
            return;
          }

          if(j.state==='done'){
            setBusy(false);
            resumeBox.style.display='none';
            doneBox.style.display='block';
            doneLink.href='/api/job/'+id+'/file';
            clearRememberedJob();
            return;
          }

          if(j.state==='error'){
            setBusy(false);
            resumeBox.style.display='none';
            err.textContent=j.error || 'Unbekannter Fehler';
            clearRememberedJob();
            return;
          }
        }catch(e){
          setBusy(false);
          err.textContent=String(e.message||e);
        }
      }

      async function startJob(task, mode=''){
        setBusy(true);
        err.textContent='';
        doneBox.style.display='none';
        resumeBox.style.display='none';
        setProgress(0.02, 'Auftrag wird gestartet …');

        try{
          const qs=new URLSearchParams({task});
          if(mode) qs.set('mode',mode);
          if(task==='deck') qs.set('layout', layoutSel.value);

          const start=await fetch('/api/job?'+qs,{method:'POST'});
          const sj=await start.json();
          if(!start.ok) throw new Error(sj.error||'Auftrag konnte nicht gestartet werden.');

          rememberJob(sj.id);
          pollJob(sj.id);
        }catch(e){
          setBusy(false);
          err.textContent=String(e.message||e);
        }
      }

      buttons.forEach(b=>{
        b.addEventListener('click',()=>startJob(b.dataset.task,b.dataset.mode||''));
      });

      const existing=localStorage.getItem('ygo_active_job');
      if(existing){
        resumeBox.style.display='block';
        setBusy(true);
        setProgress(0.02,'Verbinde mit laufendem Auftrag …');
        pollJob(existing);
      }
    </script>
  `));
});

app.get('/health', (req,res) => res.json({
  ok: true,
  version: '0.5-resume-full-deck',
  node: process.version,
  renderScale: RENDER_SCALE,
  targetWidth: TARGET_W,
  targetHeight: TARGET_H,
  layouts: LAYOUTS
}));

app.post('/api/job', (req,res) => {
  const task = String(req.query.task || '');
  const mode = String(req.query.mode || '');
  const layout = ensureLayout(String(req.query.layout || 'a3safe'));

  if (!['card','pdf3','deck'].includes(task)) {
    return res.status(400).json({ error: 'Ungültiger Auftrag' });
  }
  if (task !== 'card' && !['render','scan'].includes(mode)) {
    return res.status(400).json({ error: 'Ungültiger Modus' });
  }

  const job = createJob({ task, mode, layout });
  runJob(job);
  res.status(202).json({ id: job.id });
});

app.get('/api/job/:id', (req,res) => {
  const job = jobs.get(req.params.id);
  if (!job) return res.status(404).json({ error: 'Auftrag nicht gefunden' });
  res.setHeader('Cache-Control','no-store');
  res.json(jobPublic(job));
});

app.get('/api/job/:id/file', async (req,res) => {
  const job = jobs.get(req.params.id);
  if (!job) return res.status(404).send('Auftrag nicht gefunden');
  if (job.state !== 'done' || !job.resultPath) return res.status(409).send('Datei noch nicht fertig');

  try {
    const data = await fs.readFile(job.resultPath);
    res.setHeader('Content-Type', job.contentType || 'application/octet-stream');
    res.setHeader('Content-Disposition', `inline; filename="${job.filename || 'output.bin'}"`);
    res.send(data);
  } catch {
    res.status(500).send('Datei konnte nicht gelesen werden');
  }
});

// Fallback-Routen
app.get('/test-card', async (req,res) => {
  try { res.type('png').send(await renderCard(TEST_CARDS[1])); }
  catch (e) { res.status(500).type('text').send(String(e.stack || e.message || e)); }
});
app.get('/test-pdf', async (req,res) => {
  try { res.type('pdf').send(await makeThreeCardPdf(req.query.mode === 'scan' ? 'scan' : 'render')); }
  catch (e) { res.status(500).type('text').send(String(e.stack || e.message || e)); }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`YGO render server v0.5 listening on ${PORT}`);
});
