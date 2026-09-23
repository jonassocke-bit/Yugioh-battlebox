import express from 'express';
import path from 'node:path';
import crypto from 'node:crypto';
import skia from 'skia-canvas';
import { PDFDocument } from 'pdf-lib';
import { YugiohCard } from 'yugioh-card';

const app = express();
const PORT = Number(process.env.PORT || 10000);
const ASSET_ROOT = path.resolve('renderer-assets/yugioh-card');
const MM = 72 / 25.4;

// Native renderer: 1394 × 2031 px.
// scale 0.5 => ca. 697 × 1016 px = ziemlich genau 300 dpi bei 59 × 86 mm.
// WICHTIG: Wir rendern direkt kleiner statt erst hinterher herunterzuskalieren.
const RENDER_SCALE = 0.5;
const TARGET_W = Math.round(1394 * RENDER_SCALE);
const TARGET_H = Math.round(2031 * RENDER_SCALE);

const TEST_CARDS = [
  { en: 'Red-Eyes Darkness Dragon', de: 'Rotäugiger Finsterer Drache', set: 'SD1-DE001' },
  { en: 'Armed Dragon LV3', de: 'Bewaffneter Drache LV3', set: 'SD1-DE005' },
  { en: 'Mystical Space Typhoon', de: 'Mystischer Raum-Taifun', set: 'SD1-DE011' },
];

const metaCache = new Map();
const artworkCache = new Map();
const renderCache = new Map();
const jobs = new Map();

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
  const { en } = await getCard(card);
  const url = en.card_images?.[0]?.image_url;
  if (!url) throw new Error(`Kein Komplettbild für ${card.en}`);

  const r = await fetch(url, { signal: AbortSignal.timeout(30000) });
  if (!r.ok) throw new Error(`Scan HTTP ${r.status}`);

  return Buffer.from(await r.arrayBuffer());
}

async function makeThreeCardPdf(mode='render', progress=()=>{}) {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([420*MM, 297*MM]);

  const cw = 59*MM;
  const ch = 86*MM;
  const gap = 5*MM;
  const totalW = 3*cw + 2*gap;

  let x = (420*MM - totalW) / 2;
  const y = (297*MM - ch) / 2;

  for (let i = 0; i < TEST_CARDS.length; i++) {
    const card = TEST_CARDS[i];

    progress({
      progress: 0.08 + (i / TEST_CARDS.length) * 0.78,
      label: `${mode === 'render' ? 'Render' : 'Scan'} ${i+1}/${TEST_CARDS.length}: ${card.de}`
    });

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

  progress({ progress: 0.92, label: 'PDF wird zusammengesetzt …' });
  const result = Buffer.from(await pdf.save());
  progress({ progress: 1, label: 'Fertig' });
  return result;
}

/* ---------- Job-System für sichtbaren Fortschritt ---------- */

function createJob() {
  const id = crypto.randomUUID();
  jobs.set(id, {
    id,
    state: 'queued',
    progress: 0,
    label: 'Wartet …',
    result: null,
    contentType: null,
    filename: null,
    error: null,
    createdAt: Date.now()
  });
  return jobs.get(id);
}

function patchJob(job, patch) {
  Object.assign(job, patch);
}

function jobPublic(job) {
  return {
    id: job.id,
    state: job.state,
    progress: job.progress,
    label: job.label,
    error: job.error,
    ready: job.state === 'done'
  };
}

async function runJob(job, task, mode) {
  try {
    patchJob(job, { state: 'running', progress: 0.03, label: 'Server bereitet den Auftrag vor …' });

    if (task === 'card') {
      patchJob(job, { progress: 0.12, label: 'Kartendaten + Artwork werden geladen …' });
      const png = await renderCard(TEST_CARDS[1]);
      patchJob(job, {
        state: 'done',
        progress: 1,
        label: 'Fertig',
        result: png,
        contentType: 'image/png',
        filename: 'Bewaffneter_Drache_LV3.png'
      });
      return;
    }

    if (task === 'pdf') {
      const selected = mode === 'scan' ? 'scan' : 'render';
      const pdf = await makeThreeCardPdf(selected, p => patchJob(job, p));
      patchJob(job, {
        state: 'done',
        progress: 1,
        label: 'Fertig',
        result: pdf,
        contentType: 'application/pdf',
        filename: `YGO_${selected}_test.pdf`
      });
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

// Alte Jobs nach 20 Minuten löschen.
setInterval(() => {
  const cutoff = Date.now() - 20 * 60 * 1000;
  for (const [id, job] of jobs) {
    if (job.createdAt < cutoff) jobs.delete(id);
  }
}, 5 * 60 * 1000).unref();

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
      .btn{display:block;width:100%;text-align:center;text-decoration:none;padding:15px;border-radius:14px;margin:10px 0;background:#202733;border:1px solid #394353;color:#fff;font-weight:700;font:inherit}
      button.btn{cursor:pointer}
      .primary{background:#e8c56a;color:#18130a;border:0}
      .ok{color:#63d69a}
      .bad{color:#ef7373;white-space:pre-wrap;font-size:12px}
      .small{font-size:12px;color:#9da8b8;line-height:1.45}
      .progressbox{margin-top:16px;display:none}
      .bar{height:12px;background:#2a303a;border-radius:999px;overflow:hidden}
      .bar > i{display:block;width:0;height:100%;background:#e8c56a;transition:width .25s ease}
      .progressrow{display:flex;justify-content:space-between;gap:12px;margin-top:8px;font-size:13px;color:#a7b0bf}
      #progressLabel{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      button:disabled{opacity:.45}
    </style>
  </head>
  <body><div class="wrap">${body}</div></body>
  </html>`;
}

app.get('/', (req,res) => {
  res.type('html').send(shell('YGO Render Test', `
    <div class="sub">CLASSIC BATTLE BOX · SERVER-TEST V0.4</div>
    <h1>Dragon's Roar</h1>
    <div class="sub">
      Jetzt direkt auf ca. <b>300 dpi</b> gerendert (${TARGET_W} × ${TARGET_H} px/Karte).
      Dazu gibt es einen echten Fortschrittsbalken für Server-Aufträge.
    </div>

    <div class="card">
      <div class="ok"><b>Server läuft.</b></div>
      <button class="btn primary jobBtn" data-task="card">1. Testkarte rendern</button>
      <button class="btn jobBtn" data-task="pdf" data-mode="render">2. 3-Karten Render-PDF</button>
      <button class="btn jobBtn" data-task="pdf" data-mode="scan">3. 3-Karten Scan-PDF</button>

      <div id="progressBox" class="progressbox">
        <div class="bar"><i id="progressFill"></i></div>
        <div class="progressrow">
          <span id="progressLabel">Start …</span>
          <b id="progressPct">0 %</b>
        </div>
      </div>

      <div id="errorBox" class="bad"></div>

      <div class="small" style="margin-top:14px">
        Für die fertige 40-Karten-Version kann derselbe Balken dann z. B.
        „Render 17/28 · Maskierter Drache“ anzeigen.
      </div>
    </div>

    <script>
      const buttons=[...document.querySelectorAll('.jobBtn')];
      const box=document.getElementById('progressBox');
      const fill=document.getElementById('progressFill');
      const label=document.getElementById('progressLabel');
      const pct=document.getElementById('progressPct');
      const err=document.getElementById('errorBox');

      function setBusy(busy){
        buttons.forEach(b=>b.disabled=busy);
      }

      async function startJob(task,mode=''){
        setBusy(true);
        err.textContent='';
        box.style.display='block';
        fill.style.width='2%';
        label.textContent='Auftrag wird gestartet …';
        pct.textContent='2 %';

        try{
          const qs=new URLSearchParams({task});
          if(mode) qs.set('mode',mode);

          const start=await fetch('/api/job?'+qs,{method:'POST'});
          const sj=await start.json();
          if(!start.ok) throw new Error(sj.error||'Auftrag konnte nicht gestartet werden.');

          const id=sj.id;

          while(true){
            await new Promise(r=>setTimeout(r,500));
            const r=await fetch('/api/job/'+id,{cache:'no-store'});
            const j=await r.json();

            const p=Math.max(0,Math.min(1,Number(j.progress)||0));
            fill.style.width=(p*100).toFixed(1)+'%';
            pct.textContent=Math.round(p*100)+' %';
            label.textContent=j.label||'…';

            if(j.state==='done'){
              fill.style.width='100%';
              pct.textContent='100 %';
              label.textContent='Fertig – Datei wird geöffnet …';
              setTimeout(()=>location.href='/api/job/'+id+'/file',300);
              return;
            }

            if(j.state==='error'){
              throw new Error(j.error||'Unbekannter Serverfehler');
            }
          }
        }catch(e){
          err.textContent=String(e.message||e);
          label.textContent='Fehler';
        }finally{
          setBusy(false);
        }
      }

      buttons.forEach(b=>{
        b.addEventListener('click',()=>startJob(b.dataset.task,b.dataset.mode||''));
      });
    </script>
  `));
});

app.get('/health', (req,res) => res.json({
  ok: true,
  version: '0.4-300dpi-progress',
  node: process.version,
  assets: ASSET_ROOT,
  renderScale: RENDER_SCALE,
  targetWidth: TARGET_W,
  targetHeight: TARGET_H
}));

app.post('/api/job', (req,res) => {
  const task = req.query.task;
  const mode = req.query.mode;
  if (!['card','pdf'].includes(task)) {
    return res.status(400).json({ error: 'Ungültiger Auftrag' });
  }

  const job = createJob();
  runJob(job, task, mode);
  res.status(202).json({ id: job.id });
});

app.get('/api/job/:id', (req,res) => {
  const job = jobs.get(req.params.id);
  if (!job) return res.status(404).json({ error: 'Auftrag nicht gefunden' });
  res.setHeader('Cache-Control','no-store');
  res.json(jobPublic(job));
});

app.get('/api/job/:id/file', (req,res) => {
  const job = jobs.get(req.params.id);
  if (!job) return res.status(404).send('Auftrag nicht gefunden');
  if (job.state !== 'done' || !job.result) return res.status(409).send('Datei noch nicht fertig');

  res.setHeader('Content-Type', job.contentType);
  res.setHeader('Content-Disposition', `inline; filename="${job.filename}"`);
  res.send(job.result);
});

// Direkte URLs bleiben als Fallback erhalten.
app.get('/test-card', async (req,res) => {
  try {
    const png = await renderCard(TEST_CARDS[1]);
    res.type('png').send(png);
  } catch (e) {
    res.status(500).type('text').send(String(e.stack || e.message || e));
  }
});

app.get('/test-pdf', async (req,res) => {
  try {
    const mode = req.query.mode === 'scan' ? 'scan' : 'render';
    const pdf = await makeThreeCardPdf(mode);
    res.type('pdf').send(pdf);
  } catch (e) {
    res.status(500).type('text').send(String(e.stack || e.message || e));
  }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`YGO render test v0.4 listening on ${PORT}`);
});
