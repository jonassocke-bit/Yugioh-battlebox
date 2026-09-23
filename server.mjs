import express from 'express';
import path from 'node:path';
import skia from 'skia-canvas';
import { PDFDocument } from 'pdf-lib';
import { YugiohCard } from 'yugioh-card';

const app = express();
const PORT = Number(process.env.PORT || 10000);
const ASSET_ROOT = path.resolve('renderer-assets/yugioh-card');
const MM = 72 / 25.4;

// Zielauflösung etwas reduziert für schnelleren Render:
// 59 × 86 mm bei ca. 450 dpi ≈ 1046 × 1524 px
const TARGET_W = 1046;
const TARGET_H = 1524;

const TEST_CARDS = [
  { en: 'Red-Eyes Darkness Dragon', de: 'Rotäugiger Finsterer Drache', set: 'SD1-DE001' },
  { en: 'Armed Dragon LV3', de: 'Bewaffneter Drache LV3', set: 'SD1-DE005' },
  { en: 'Mystical Space Typhoon', de: 'Mystischer Raum-Taifun', set: 'SD1-DE011' },
];

const metaCache = new Map();
const artworkCache = new Map();
const renderCache = new Map();

const RACE_DE = {
  'Aqua': 'AQUA',
  'Beast': 'UNGEHEUER',
  'Beast-Warrior': 'UNGEHEUER-KRIEGER',
  'Cyberse': 'CYBERSE',
  'Dinosaur': 'DINOSAURIER',
  'Divine-Beast': 'GÖTTLICHES UNGEHEUER',
  'Dragon': 'DRACHE',
  'Fairy': 'FEE',
  'Fiend': 'UNTERWELTLER',
  'Fish': 'FISCH',
  'Illusion': 'ILLUSION',
  'Insect': 'INSEKT',
  'Machine': 'MASCHINE',
  'Plant': 'PFLANZE',
  'Psychic': 'PSI',
  'Pyro': 'PYRO',
  'Reptile': 'REPTIL',
  'Rock': 'FELS',
  'Sea Serpent': 'SEESCHLANGE',
  'Spellcaster': 'HEXER',
  'Thunder': 'DONNER',
  'Warrior': 'KRIEGER',
  'Winged Beast': 'GEFLÜGELTES UNGEHEUER',
  'Wyrm': 'WYRM',
  'Zombie': 'ZOMBIE',
};

function esc(s='') {
  return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));
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
  'Equip Card': 'equip',
  'Field Spell': 'field',
  'Quick-Play Spell': 'quick-play',
  'Ritual Spell': 'ritual',
  'Continuous Spell': 'continuous',
  'Continuous Trap': 'continuous',
  'Counter Trap': 'counter'
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
    scale: 1
  };
}

function dataUrlToBuffer(data) {
  if (Buffer.isBuffer(data)) return data;
  if (typeof data !== 'string') throw new Error('Unbekanntes Renderer-Ausgabeformat');
  const m = data.match(/^data:image\/(?:png|jpeg);base64,(.+)$/);
  if (!m) throw new Error('Renderer lieferte keine PNG/JPEG-Data-URL');
  return Buffer.from(m[1], 'base64');
}

async function downscalePng(pngBuffer, width = TARGET_W, height = TARGET_H) {
  const img = await skia.loadImage(pngBuffer);
  const canvas = new skia.Canvas(width, height);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, 0, 0, width, height);
  return await canvas.toBuffer('png');
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

    const rawPng = dataUrlToBuffer(result.data);
    const png = await downscalePng(rawPng);
    renderCache.set(card.en, png);
    return png;
  } finally {
    try { instance.leafer.destroy(); } catch {}
  }
}

async function fetchFullScan(card) {
  const { en } = await getCard(card);
  const url = en.card_images?.[0]?.image_url;
  if (!url) throw new Error(`Kein Komplettbild für ${card.en}`);

  const r = await fetch(url, { signal: AbortSignal.timeout(30000) });
  if (!r.ok) throw new Error(`Scan HTTP ${r.status}`);

  return Buffer.from(await r.arrayBuffer());
}

async function makeThreeCardPdf(mode='render') {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([420*MM, 297*MM]);

  const cw = 59*MM;
  const ch = 86*MM;
  const gap = 5*MM;
  const totalW = 3*cw + 2*gap;

  let x = (420*MM - totalW) / 2;
  const y = (297*MM - ch) / 2;

  for (const card of TEST_CARDS) {
    const bytes = mode === 'scan' ? await fetchFullScan(card) : await renderCard(card);

    let img;
    if (mode === 'scan') {
      try { img = await pdf.embedJpg(bytes); }
      catch { img = await pdf.embedPng(bytes); }
    } else {
      img = await pdf.embedPng(bytes);
    }

    page.drawImage(img, { x, y, width: cw, height: ch });
    x += cw + gap;
  }

  return Buffer.from(await pdf.save());
}

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
      .wrap{max-width:720px;margin:auto;padding:calc(22px + env(safe-area-inset-top)) 16px calc(30px + env(safe-area-inset-bottom))}
      h1{font-size:31px;margin:6px 0 8px}
      .sub{color:#a7b0bf;line-height:1.5}
      .card{margin-top:18px;background:#171c24;border:1px solid #313a49;border-radius:18px;padding:16px}
      .btn{display:block;width:100%;text-align:center;text-decoration:none;padding:15px;border-radius:14px;margin:10px 0;background:#202733;border:1px solid #394353;color:#fff;font-weight:700}
      .primary{background:#e8c56a;color:#18130a;border:0}
      .ok{color:#63d69a}
      .small{font-size:12px;color:#9da8b8;line-height:1.45}
    </style>
  </head>
  <body><div class="wrap">${body}</div></body>
  </html>`;
}

app.get('/', (req,res) => {
  res.type('html').send(shell('YGO Render Test', `
    <div class="sub">CLASSIC BATTLE BOX · SERVER-TEST V0.3</div>
    <h1>Dragon's Roar</h1>
    <div class="sub">Artwork serverseitig eingebettet, Monstertypen deutsch übersetzt und Rendergröße für schnellere Tests auf ca. <b>450 dpi</b> reduziert.</div>
    <div class="card">
      <div class="ok"><b>Server läuft.</b></div>
      <a class="btn primary" href="/test-card">1. Testkarte rendern</a>
      <a class="btn" href="/test-pdf?mode=render">2. 3-Karten Render-PDF</a>
      <a class="btn" href="/test-pdf?mode=scan">3. 3-Karten Scan-PDF</a>
      <div class="small">Bei der Testkarte müssen jetzt Artwork und „DRACHE / EFFEKT“ sichtbar sein.</div>
    </div>
  `));
});

app.get('/health', (req,res) => res.json({
  ok: true,
  version: '0.3-downscaled-450dpi',
  node: process.version,
  assets: ASSET_ROOT,
  targetWidth: TARGET_W,
  targetHeight: TARGET_H
}));

app.get('/test-card', async (req,res) => {
  try {
    const png = await renderCard(TEST_CARDS[1]);
    res.setHeader('Content-Type','image/png');
    res.setHeader('Content-Disposition','inline; filename="Bewaffneter_Drache_LV3.png"');
    res.send(png);
  } catch (e) {
    console.error(e);
    res.status(500).type('html').send(shell('Renderfehler',
      `<h1>Renderfehler</h1><div class="card"><div style="color:#ef7373">${esc(e.stack || e.message || e)}</div></div>`
    ));
  }
});

app.get('/test-pdf', async (req,res) => {
  try {
    const mode = req.query.mode === 'scan' ? 'scan' : 'render';
    const pdf = await makeThreeCardPdf(mode);

    res.setHeader('Content-Type','application/pdf');
    res.setHeader('Content-Disposition',`inline; filename="YGO_${mode}_test.pdf"`);
    res.send(pdf);
  } catch (e) {
    console.error(e);
    res.status(500).type('html').send(shell('PDF-Fehler',
      `<h1>PDF-Fehler</h1><div class="card"><div style="color:#ef7373">${esc(e.stack || e.message || e)}</div></div>`
    ));
  }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`YGO render test v0.3 listening on ${PORT}`);
});
