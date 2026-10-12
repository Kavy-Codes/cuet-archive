const fs = require('fs');
const path = require('path');
const cfg = require('./config.cjs');

const SITE_NAME = "CUET '27 Archive";
const SITE_TAGLINE = 'Every free CUET resource from the community — books, 66 in-browser mocks, notes and more.';
const SITE_URL = 'https://kavy-codes.github.io/cuet-archive/';
const REWRITES_FILE = path.join(cfg.ROOT, 'data', 'rewrites.json');
const MOCK_DIR = path.join(cfg.SITE_DIR, 'mocks');
const INVITE_URL = 'https://discord.gg/XwVtsUUygy';
const GUILD_ID = '1551614250508746814';
const chan = (id) => `https://discord.com/channels/${GUILD_ID}/${id}`;
const COMMUNITY = {
  invite: INVITE_URL,
  resources: chan('1554594963184943145'),
  request: chan('1555643010098790541'),
  mocks: chan('1551614253016944736'),
  general: chan('1558895340999155782'),
  welcome: chan('1551614251951587417'),
};

/* Subject presentation for the Mock Lab */
const SUBJECT_STYLE = {
  GAT: { color: '#a78bfa', icon: '🧠' },
  Physics: { color: '#6cb2f5', icon: '⚛️' },
  Chemistry: { color: '#7dd88a', icon: '⚗️' },
  Economics: { color: '#4fd1a5', icon: '📈' },
  'Business Studies': { color: '#4fd1a5', icon: '💼' },
  English: { color: '#f58bb0', icon: '📚' },
  Maths: { color: '#e9a13b', icon: '📐' },
};
const TOPIC_SUBJECT = {
  gat: 'GAT',
  'free-mock-test-paper': 'GAT',
  physics: 'Physics',
  chemistry: 'Chemistry',
  economics: 'Economics',
  'business-studies': 'Business Studies',
};

function normWs(s) {
  return String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
}

function loadRewrites() {
  let raw = {};
  try {
    raw = JSON.parse(fs.readFileSync(REWRITES_FILE, 'utf8'));
  } catch {
    raw = {};
  }
  const texts = new Map();
  for (const [k, v] of Object.entries(raw.texts || {})) texts.set(normWs(k).toLowerCase(), v);
  const sections = new Map(Object.entries(raw.sections || {}));
  const links = new Map();
  for (const [k, v] of Object.entries(raw.links || {})) links.set(normUrl(k), v);
  const usedTexts = new Set();
  return { texts, sections, links, usedTexts };
}

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function md(text) {
  let s = esc(text);
  s = s.replace(/`([^`]+)`/g, '<code>$1</code>');
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/__([^_]+)__/g, '<strong>$1</strong>');
  s = s.replace(/\*([^*]+)\*/g, '<em>$1</em>');
  s = s.replace(/~~([^~]+)~~/g, '<del>$1</del>');
  s = s.replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
  return s;
}

function slugify(text, used) {
  let slug = String(text)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50);
  if (!slug) slug = 'section';
  let candidate = slug;
  let n = 2;
  while (used && used.has(candidate)) candidate = slug + '-' + n++;
  if (used) used.add(candidate);
  return candidate;
}

const TRACKING = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'si', 'fbclid', 'igshid', 'ref', 'ref_src', 'feature', 'app', 's'];

function normUrl(u) {
  try {
    const url = new URL(u);
    const host = url.hostname.replace(/^www\./, '');
    if (host === 'youtube.com' || host === 'm.youtube.com' || host === 'youtu.be' || host === 'music.youtube.com') {
      let id = '';
      if (host === 'youtu.be') id = url.pathname.slice(1);
      else if (url.pathname === '/watch') id = url.searchParams.get('v') || '';
      else if (/^\/(live|embed|shorts)\//.test(url.pathname)) id = url.pathname.split('/')[2] || '';
      if (id) return 'https://www.youtube.com/watch?v=' + id;
    }
    TRACKING.forEach((p) => url.searchParams.delete(p));
    let out = url.toString();
    if (out.includes('?') && [...url.searchParams].length === 0) out = out.split('?')[0];
    return out.replace(/\/$/, '').replace(/^https:\/\/www\./, 'https://');
  } catch {
    return u;
  }
}

function fmtSize(bytes) {
  if (!bytes) return '';
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(0) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

function flowText(items) {
  return items
    .map((i) => (i.kind === 'text' ? i.text || '' : i.kind === 'role' ? '@' + (i.name || '') : '#' + (i.name || '')))
    .join('');
}

function flowHtml(items) {
  return items
    .map((i) => {
      if (i.kind === 'role') return '<span class="chip">' + esc(i.name) + '</span>';
      if (i.kind === 'channel') return '<span class="chip chan">#' + esc(i.name || 'channel') + '</span>';
      return md(i.text || '');
    })
    .join('');
}

function linkTitle(block) {
  return block.embedTitle || block.context || block.domain || block.url;
}

function linkDesc(block) {
  if (block.embedDesc) return block.embedDesc;
  const ctx = block.context;
  if (ctx && ctx !== block.embedTitle && !/[:#]\s*$/.test(ctx) && ctx.length > 3) return ctx;
  return '';
}

function buildModel(topic, rw) {
  const used = new Set();
  const sections = [];
  let current = { id: 'overview', title: 'Overview', items: [], isOverview: true };
  sections.push(current);
  const byId = new Map([['overview', current]]);
  const seenUrls = new Set();

  const startSection = (title) => {
    const id = slugify(title, used);
    const existing = byId.get(id);
    if (existing) {
      current = existing;
      return;
    }
    const sec = { id, title, items: [] };
    byId.set(id, sec);
    sections.push(sec);
    current = sec;
  };

  const textRewrite = (raw) => {
    const key = normWs(raw).toLowerCase();
    if (!rw || !rw.texts.has(key)) return undefined;
    rw.usedTexts.add(key);
    return rw.texts.get(key);
  };

  const namePlain = topic.name.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

  for (const msg of topic.messages) {
    const secTitle = rw && rw.sections.get(String(msg.id));
    if (secTitle) startSection(secTitle);
    for (const b of msg.blocks) {
      if (b.type === 'heading') {
        const t = (b.text || '').trim();
        if (!t) continue;
        const tPlain = t.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
        if (tPlain === namePlain) continue;
        const rwText = textRewrite(t);
        if (rwText !== undefined) {
          if (rwText === '') continue;
          if (rwText.length <= 60) startSection(rwText);
          else current.items.push({ type: 'note', text: rwText });
          continue;
        }
        if (t.length <= 60) startSection(t);
        else current.items.push({ type: 'note', text: t });
      } else if (b.type === 'flow') {
        const raw = flowText(b.items).trim();
        if (!raw) continue;
        const rawPlain = raw.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
        if (rawPlain === namePlain) continue;
        const rwText = textRewrite(raw);
        if (rwText !== undefined) {
          if (rwText !== '') current.items.push({ type: 'para', html: md(rwText) });
          continue;
        }
        current.items.push({ type: 'para', html: flowHtml(b.items) });
      } else if (b.type === 'link') {
        const key = normUrl(b.url);
        if (seenUrls.has(key)) continue;
        seenUrls.add(key);
        // permanently excluded: piracy-channel promos have no place in the archive
        if (/pirat/i.test(b.embedTitle || '') || /pirat/i.test(b.context || '')) continue;
        if (/^https:\/\/t\.me\/\+_9lS2ea_xUhlYWRl/.test(b.url)) continue;
        let title = linkTitle(b);
        let desc = linkDesc(b);
        const rwCtx = textRewrite(b.context || '');
        if (rwCtx !== undefined) {
          if (rwCtx === '') desc = '';
          else {
            title = rwCtx;
            desc = '';
          }
        }
        const rwTitle = textRewrite(title);
        if (rwTitle !== undefined) title = rwTitle === '' ? title : rwTitle;
        const rwLink = rw && rw.links.get(key);
        if (rwLink) {
          if (rwLink.title != null) title = rwLink.title;
          if (rwLink.desc != null) desc = rwLink.desc;
        }
        current.items.push({
          type: 'link',
          url: b.url,
          domain: b.domain || '',
          title,
          desc,
        });
      } else if (b.type === 'attachment') {
        const key = normUrl(b.url);
        if (seenUrls.has(key)) continue;
        seenUrls.add(key);
        const isHtml = (b.contentType || '').includes('html');
        const safeFile = String(b.filename || '').replace(/[\\/:*?"<>|]/g, '_');
        const localPath = isHtml && b.attId ? 'mocks/' + b.attId + '/' + safeFile : '';
        const localAbs = localPath ? path.join(MOCK_DIR, b.attId, safeFile) : '';
        current.items.push({
          type: 'file',
          url: b.url,
          filename: b.filename,
          size: b.size,
          messageUrl: msg.messageUrl || '',
          contentType: b.contentType || '',
          localPath: localPath && fs.existsSync(localAbs) ? localPath : '',
        });
      }
    }
  }

  const filled = sections.filter((s) => s.items.length > 0);
  if (filled[0] && filled[0].id !== 'overview') {
    const idx = filled.findIndex((s) => s.id === 'overview');
    if (idx > 0) {
      const [ov] = filled.splice(idx, 1);
      filled.unshift(ov);
    }
  }
  let count = 0;
  for (const s of filled) for (const it of s.items) if (it.type === 'link' || it.type === 'file') count++;
  return { sections: filled, count };
}

function fileKind(item) {
  const ext = (item.filename || '').split('.').pop().toLowerCase();
  const kinds = { html: 'HTML', htm: 'HTML', pdf: 'PDF', doc: 'DOC', docx: 'DOCX', ppt: 'PPT', pptx: 'PPTX', zip: 'ZIP', mp4: 'MP4', png: 'PNG', jpg: 'JPG', jpeg: 'JPG' };
  if (kinds[ext]) return kinds[ext];
  const ct = (item.contentType || '').split(';')[0].trim();
  if (ct === 'text/html') return 'HTML';
  if (ct === 'application/pdf') return 'PDF';
  return ext ? ext.toUpperCase() : 'FILE';
}

function fileMeta(item) {
  const bits = [fileKind(item)];
  if (item.size) bits.push(fmtSize(item.size));
  return bits.join(' · ');
}

function cardHtml(item, rel) {
  if (item.type === 'file') {
    const local = item.localPath ? rel + item.localPath : '';
    const actions = [];
    if (local) {
      actions.push(
        '<a class="btn primary" href="' + esc(local) + '" target="_blank" rel="noopener">Attempt mock ↗</a>'
      );
    } else if (item.messageUrl) {
      // attachment lives only on Discord (signed CDN URLs expire) — Discord first
      actions.push(
        '<a class="btn primary" href="' + esc(item.messageUrl) + '" target="_blank" rel="noopener">Open in Discord ↗</a>'
      );
      actions.push(
        '<a class="btn" href="' + esc(item.url) + '" target="_blank" rel="noopener">Try direct link</a>'
      );
    } else {
      actions.push(
        '<a class="btn primary" href="' + esc(item.url) + '" target="_blank" rel="noopener">Open file ↗</a>'
      );
    }
    if (item.messageUrl) {
      actions.push(
        '<a class="btn" href="' + esc(item.messageUrl) + '" target="_blank" rel="noopener">Open in Discord ↗</a>'
      );
    }
    actions.push(
      '<button class="btn" data-copy="' + esc(local || item.url) + '">Copy link</button>'
    );
    return (
      '<div class="card file-card">' +
      '<div class="card-head">' +
      '<span class="favicon">' + (local ? '🧪' : '📄') + '</span>' +
      '<div><a class="card-title" href="' +
      esc(local || item.url) +
      '" target="_blank" rel="noopener">' +
      esc(item.filename) +
      '</a><span class="card-domain">' +
      esc(fileMeta(item)) +
      (local ? ' · opens in your browser' : ' · on Discord') +
      '</span></div></div>' +
      '<div class="card-actions">' +
      actions.join('') +
      '</div></div>'
    );
  }
  const domain = item.domain || 'link';
  const favicon = 'https://icons.duckduckgo.com/ip3/' + encodeURIComponent(domain) + '.ico';
  return (
    '<div class="card">' +
    '<div class="card-head">' +
    '<img class="favicon" src="' +
    esc(favicon) +
    '" alt="" data-domain="' +
    esc(domain) +
    '">' +
    '<div><a class="card-title" href="' +
    esc(item.url) +
    '" target="_blank" rel="noopener">' +
    esc(item.title || domain) +
    '</a><span class="card-domain">' +
    esc(domain) +
    '</span></div></div>' +
    (item.desc ? '<p class="card-desc">' + esc(item.desc) + '</p>' : '') +
    '<div class="card-actions">' +
    '<a class="btn primary" href="' +
    esc(item.url) +
    '" target="_blank" rel="noopener">Open ↗</a>' +
    '<button class="btn" data-copy="' +
    esc(item.url) +
    '">Copy link</button>' +
    '</div></div>'
  );
}

function layout(opts) {
  const rel = opts.rel || '';
  const title = opts.title;
  const desc = opts.desc || SITE_TAGLINE;
  const pageUrl = SITE_URL + (opts.path || '');
  const nav = opts.nav || '';
  const navLink = (href, label, key) =>
    '<a href="' + rel + href + '"' + (nav === key ? ' class="current" aria-current="page"' : '') + '>' + label + '</a>';
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}">
<meta name="color-scheme" content="dark">
<meta name="theme-color" content="#0B0E14">
<link rel="canonical" href="${esc(pageUrl)}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="${esc(SITE_NAME)}">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:url" content="${esc(pageUrl)}">
<meta property="og:image" content="${rel}assets/logo.svg">
<meta name="twitter:card" content="summary">
<meta name="twitter:title" content="${esc(title)}">
<meta name="twitter:description" content="${esc(desc)}">
<link rel="icon" type="image/svg+xml" href="${rel}assets/logo.svg">
<link rel="stylesheet" href="${rel}assets/style.css">
<noscript><style>.reveal{opacity:1 !important;transform:none !important}</style></noscript>
<script type="application/ld+json">${JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    name: SITE_NAME,
    url: SITE_URL,
    description: SITE_TAGLINE,
  })}</script>
</head>
<body data-nav="${nav}" data-barba="wrapper">
<header class="topbar" id="top">
  <div class="topbar-inner">
    <a class="brand" href="${rel}index.html" aria-label="${esc(SITE_NAME)} home"><img src="${rel}assets/logo.svg" alt="CUET 27 logo" width="34" height="34"><span><span class="brand-name">CUET <em>'27</em> Archive</span><span class="brand-sub">Free · Community · Forever</span></span></a>
    <nav class="nav-links" aria-label="Primary">
      ${navLink('index.html', 'Home', 'home')}
      ${navLink('mocks.html', 'Mock Lab', 'mocks')}
      ${navLink('library.html', 'Library', 'library')}
    </nav>
    <div class="searchwrap">
      <input class="search-input" type="search" placeholder="Search mocks, books, notes…" autocomplete="off" aria-label="Search resources">
      <div class="results" hidden></div>
    </div>
  </div>
</header>
<main class="wrap" data-barba="container" data-barba-namespace="${esc(opts.namespace || nav || 'page')}">
${opts.content}
</main>
<footer>
  <div class="wrap footer-inner">
    <div class="footer-brand"><img src="${rel}assets/logo.svg" alt="" width="26" height="26">CUET '27 Archive</div>
    <div class="foot-links">
      <a href="${rel}index.html">Home</a>
      <a href="${rel}mocks.html">Mock Lab</a>
      <a href="${rel}library.html">Library</a>
      <a href="${esc(COMMUNITY.invite)}" target="_blank" rel="noopener">Join the Discord ↗</a>
      <a href="${esc(COMMUNITY.request)}" target="_blank" rel="noopener">Request a resource ↗</a>
      <a href="#top">Back to top ↑</a>
    </div>
    <div class="footer-note">Snapshot of community-shared free resources · Synced <span data-iso="${esc(opts.syncedAt || '')}"></span> · Mocks run fully in your browser — no login, no paywall. Question papers belong to their respective owners; shared here for practice only.</div>
  </div>
</footer>
<nav class="tabbar" aria-label="Mobile">
  <a href="${rel}index.html"${nav === 'home' ? ' class="current" aria-current="page"' : ''}><span class="t-ico">🏠</span>Home</a>
  <a href="${rel}mocks.html"${nav === 'mocks' ? ' class="current" aria-current="page"' : ''}><span class="t-ico">⚡</span>Mocks</a>
  <a href="${rel}library.html"${nav === 'library' ? ' class="current" aria-current="page"' : ''}><span class="t-ico">📖</span>Library</a>
  <a href="${esc(COMMUNITY.invite)}" target="_blank" rel="noopener"><span class="t-ico">💬</span>Discord</a>
</nav>
<script>window.__BASE__=${JSON.stringify(rel)};</script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/gsap/3.12.5/gsap.min.js" defer></script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/gsap/3.12.5/ScrollTrigger.min.js" defer></script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/animejs/3.2.1/anime.min.js" defer></script>
<script src="https://cdn.jsdelivr.net/npm/@barba/core@2.9.7/dist/barba.umd.js" defer></script>
<script src="${rel}assets/app.js" defer></script>
</body>
</html>`;
}

function renderSections(model, rel) {
  return model.sections
    .map((sec) => {
      const paras = sec.items
        .filter((i) => i.type === 'para')
        .map((i) => '<p class="para">' + i.html + '</p>')
        .join('');
      const notes = sec.items
        .filter((i) => i.type === 'note')
        .map((i) => '<div class="note">' + md(i.text) + '</div>')
        .join('');
      const cards = sec.items.filter((i) => i.type === 'link' || i.type === 'file');
      const cardsHtml = cards.length ? '<div class="cards">' + cards.map((c) => cardHtml(c, rel)).join('') + '</div>' : '';
      const heading = sec.isOverview ? '' : '<h2 id="' + sec.id + '">' + md(sec.title) + '</h2>';
      return (
        '<section class="section">' +
        heading +
        paras +
        notes +
        cardsHtml +
        '</section>'
      );
    })
    .join('\n');
}

function renderToc(model) {
  const secs = model.sections.filter((s) => !s.isOverview);
  if (secs.length < 4) return '';
  return (
    '<details class="toc"><summary>On this page (' + secs.length + ')</summary><div class="toc-links">' +
    secs.map((s) => '<a href="#' + s.id + '">' + esc(s.title) + '</a>').join('') +
    '</div></details>'
  );
}

/* ---------------- mock catalog ---------------- */
function scanMockFile(abs) {
  const s = fs.readFileSync(abs, 'utf8');
  const isPayload = s.includes('QUIZ_PAYLOAD');
  let title = null;
  if (isPayload) {
    const m = s.match(/"title":\s*"((?:[^"\\]|\\.)*)"/);
    if (m) {
      try {
        title = JSON.parse('"' + m[1] + '"');
      } catch {
        title = m[1];
      }
    }
  } else {
    const m = s.match(/<title>([\s\S]*?)<\/title>/);
    if (m) title = m[1].replace(/ — CUET Archive Mock$/, '').trim();
  }
  const qmarks = (s.match(/"question"\s*:/g) || []).length;
  const tmatch = s.match(/"timeLimitSec":\s*(\d+)/);
  return { title: title || 'Untitled mock', engine: isPayload ? 'CBT Pro' : 'Classic', questions: qmarks, minutes: tmatch ? Math.round(+tmatch[1] / 60) : 60 };
}

function sortKey(title) {
  const m = String(title).match(/(\d+)\s*$/);
  return (m ? String(+m[1]).padStart(4, '0') : title);
}

function buildMockCatalog(models) {
  const attTopic = new Map();
  for (const t of models.topics) {
    const m = models.byId.get(t.id);
    for (const sec of m.sections) {
      for (const it of sec.items) {
        if (it.type === 'file' && it.localPath) {
          const mm = it.localPath.match(/^mocks\/([^/]+)\//);
          if (mm) attTopic.set(mm[1], t.slug);
        }
      }
    }
  }
  const seenTitles = new Map();
  const catalog = [];
  if (!fs.existsSync(MOCK_DIR)) return catalog;
  for (const attId of fs.readdirSync(MOCK_DIR)) {
    const dir = path.join(MOCK_DIR, attId);
    if (!fs.statSync(dir).isDirectory()) continue;
    for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.html'))) {
      const meta = scanMockFile(path.join(dir, file));
      const slug = attTopic.get(attId) || '';
      const subject = TOPIC_SUBJECT[slug] || 'GAT';
      let display = meta.title;
      const dup = (seenTitles.get(display) || 0) + 1;
      seenTitles.set(display, dup);
      if (dup > 1) display = display + ' · Set ' + String.fromCharCode(64 + dup);
      catalog.push({
        id: attId,
        path: 'mocks/' + attId + '/' + file,
        title: meta.title,
        display,
        subject,
        engine: meta.engine,
        questions: meta.questions,
        minutes: meta.minutes,
        sort: subject + '|' + sortKey(meta.title),
      });
    }
  }
  catalog.sort((a, b) => (a.sort < b.sort ? -1 : a.sort > b.sort ? 1 : 0));
  catalog.forEach((m, i) => (m.order = i));
  return catalog;
}

function mockCardHtml(m, order) {
  const st = SUBJECT_STYLE[m.subject] || SUBJECT_STYLE.GAT;
  return (
    '<a class="mock-card reveal" style="--mc:' + st.color + '" href="' + esc(m.path) + '" target="_blank" rel="noopener"' +
    ' data-subject="' + esc(m.subject) + '" data-title="' + esc(m.display.toLowerCase()) + '" data-engine="' + esc(m.engine.toLowerCase()) + '" data-qs="' + (m.questions || 0) + '" data-order="' + (order != null ? order : m.order) + '">' +
    '<span class="m-subject">' + st.icon + ' ' + esc(m.subject) + '</span>' +
    '<h3 class="m-title">' + esc(m.display) + '</h3>' +
    '<span class="m-meta"><span class="m-pill">' + (m.questions || '–') + ' Qs</span>' +
    '<span class="m-pill">⏱ ' + (m.minutes || 60) + ' min</span>' +
    '<span class="m-pill">' + esc(m.engine) + '</span></span>' +
    '<span class="m-go"><span>Attempt now</span><span class="arrow">→</span></span></a>'
  );
}

function mocksPage(data, catalog) {
  const subjects = [...new Set(catalog.map((m) => m.subject))];
  const chips = ['<button class="fchip on" data-f="all" type="button">All papers</button>']
    .concat(subjects.map((s) => {
      const st = SUBJECT_STYLE[s] || SUBJECT_STYLE.GAT;
      return '<button class="fchip" data-f="' + esc(s) + '" type="button">' + st.icon + ' ' + esc(s) + '</button>';
    }))
    .join('');
  const cards = catalog.map((m) => mockCardHtml(m)).join('');
  const itemList = catalog.map((m, i) => ({
    '@type': 'ListItem',
    position: i + 1,
    url: SITE_URL + m.path,
    name: m.display,
  }));
  const content = `
<nav class="crumbs"><a href="index.html">← Home</a><span class="sep">/</span><span>Mock Lab</span></nav>
<section class="hero" style="padding-top:26px">
  <span class="hero-kicker"><span class="dot"></span>${catalog.length} papers · hosted · free</span>
  <h1>The Mock <span class="amber">Lab.</span></h1>
  <p class="hero-lede">Full-length CUET papers that run <strong>entirely in your browser</strong> — timed, auto-checked, with solutions. Pick a paper, hit attempt, beat the clock.</p>
</section>
<div class="lab-controls">
  <input id="lab-search" class="search-input" type="search" placeholder="Filter papers… (e.g. physics 9)" autocomplete="off" aria-label="Filter mock papers">
  <div class="lab-chips">${chips}</div>
  <div class="lab-row">
    <select id="lab-sort" class="fchip" aria-label="Sort papers" style="appearance:auto">
      <option value="feat">Sort: Featured</option>
      <option value="az">Sort: A–Z</option>
      <option value="qs">Sort: Most questions</option>
    </select>
    <button id="lab-random" class="fchip" type="button" title="Open a random paper">🎲 Surprise me</button>
    <span id="lab-count" class="lab-count"></span>
  </div>
</div>
<div id="mock-grid" class="mock-grid">${cards}</div>
<div id="lab-empty" class="lab-empty" hidden><h3>No papers match that filter</h3><p>Try a different subject or clear the search.</p></div>
<section class="discord-band reveal">
  <div>
    <h2>Attempted one? <em>Compare scores.</em></h2>
    <p>Drop your score in the mocks channel, ask doubts, and find the next paper worth your time.</p>
    <a class="btn primary" href="${esc(COMMUNITY.mocks)}" target="_blank" rel="noopener">Open #mocks on Discord ↗</a>
  </div>
  <ul class="channel-list">
    <li><a href="${esc(COMMUNITY.request)}" target="_blank" rel="noopener"><span class="hash">#</span> request a paper you can't find</a></li>
    <li><a href="${esc(COMMUNITY.resources)}" target="_blank" rel="noopener"><span class="hash">#</span> resources — where papers land first</a></li>
  </ul>
</section>
<script type="application/ld+json">${JSON.stringify({ '@context': 'https://schema.org', '@type': 'ItemList', name: 'CUET Mock Lab', itemListElement: itemList })}</script>`;

  return layout({
    rel: '',
    nav: 'mocks',
    path: 'mocks.html',
    title: `Mock Lab — ${catalog.length} free CUET mock tests in your browser | CUET '27 Archive`,
    desc: `Attempt ${catalog.length} free CUET mock tests online — GAT, Physics, Chemistry, Economics and Business Studies. Timed, auto-checked, no signup.`,
    content,
    syncedAt: data.generatedAt,
  });
}

function libraryPage(data, models) {
  const blocks = data.topics
    .map((t) => {
      const m = models.byId.get(t.id);
      const cards = [];
      for (const sec of m.sections) {
        for (const it of sec.items) {
          if (it.type === 'link' || it.type === 'file') cards.push(cardHtml(it, ''));
        }
      }
      if (!cards.length) return '';
      return (
        '<section class="section" id="lib-' + t.slug + '"><h2 id="' + t.slug + '">' + esc(t.emoji ? t.emoji + ' ' : '') + esc(t.name) + ' <span class="hint">(' + cards.length + ')</span></h2>' +
        '<div class="cards">' + cards.join('') + '</div></section>'
      );
    })
    .join('');
  const index = data.topics
    .map((t) => '<a href="#lib-' + t.slug + '">' + (t.emoji ? esc(t.emoji) + ' ' : '') + esc(t.name) + '</a>')
    .join('');
  const content = `
<nav class="crumbs"><a href="index.html">← Home</a><span class="sep">/</span><span>Library</span></nav>
<section class="hero" style="padding-top:26px">
  <span class="hero-kicker"><span class="dot"></span>Books · PDFs · Videos · Websites</span>
  <h1>The <span class="amber">Library.</span></h1>
  <p class="hero-lede">Everything that isn't a mock — every book, note, lecture and link ever shared in the resources forum, on one endless shelf.</p>
  <div class="hero-search">
    <input class="search-input" type="search" placeholder="Search the whole library…" autocomplete="off" aria-label="Search library">
    <div class="results" hidden></div>
  </div>
</section>
<div class="chips-row">${index}</div>
${blocks}
<p><a class="back-home" href="index.html">← Back home</a></p>`;

  return layout({
    rel: '',
    nav: 'library',
    path: 'library.html',
    title: "Library — all CUET books, notes & links | CUET '27 Archive",
    desc: 'The full CUET library: free books, PDFs, notes, video lectures and websites shared by the CUET 27 Discord community.',
    content,
    syncedAt: data.generatedAt,
  });
}

function notFoundPage(data) {
  const content = `
<section class="hero" style="text-align:center;padding-bottom:10px">
  <span class="hero-kicker" style="margin-left:auto;margin-right:auto"><span class="dot"></span>404 · off the shelf</span>
  <h1>Lost in the <span class="amber">stacks?</span></h1>
  <p class="hero-lede" style="margin-left:auto;margin-right:auto">That page isn't on this shelf. Try the search, or head somewhere useful:</p>
  <div class="hero-search" style="margin-left:auto;margin-right:auto">
    <input class="search-input" type="search" placeholder="Search the archive…" autocomplete="off" aria-label="Search resources">
    <div class="results" hidden></div>
  </div>
  <div class="hero-actions" style="justify-content:center">
    <a class="btn primary" href="index.html">🏠 Home</a>
    <a class="btn ghost" href="mocks.html">⚡ Mock Lab</a>
    <a class="btn ghost" href="library.html">📖 Library</a>
  </div>
</section>`;
  return layout({
    rel: '',
    nav: '',
    path: '404.html',
    title: "Page not found | CUET '27 Archive",
    desc: 'This archive page does not exist. Browse free CUET mocks, books and notes instead.',
    content,
    syncedAt: data.generatedAt,
  });
}

function streamDefs(models, byTopic) {
  const count = (slugs) => slugs.reduce((n, s) => n + (byTopic[s] || 0), 0);
  return [
    { icon: '🧠', name: 'GAT & Reasoning', desc: 'General aptitude papers plus free full-length mocks.', slugs: ['gat', 'free-mock-test-paper'], c1: '#2b2350', c2: '#a78bfa' },
    { icon: '🔬', name: 'Science', desc: 'Physics and Chemistry — theory threads, notes and 31 mocks.', slugs: ['physics', 'chemistry'], c1: '#0f2f3a', c2: '#4fd1a5' },
    { icon: '📐', name: 'Maths', desc: 'Formulas, shortcuts and problem collections.', slugs: ['maths'], c1: '#3a2c10', c2: '#e9a13b' },
    { icon: '📚', name: 'English', desc: 'Reading material, vocab vaults and practice sets.', slugs: ['english', 'cuet-english-archive-alot-of-material'], c1: '#3d1f31', c2: '#f58bb0' },
    { icon: '💵', name: 'Commerce', desc: 'Economics and Business Studies with 10 in-browser mocks.', slugs: ['economics', 'business-studies'], c1: '#123a2c', c2: '#7dd88a' },
    { icon: '🎭', name: 'Humanities & Sports', desc: 'Psychology, physical education and past papers.', slugs: ['psychology', 'physical-education', 'cuet-question-papers-google-drive'], c1: '#3a2412', c2: '#f09a5c' },
    { icon: '📖', name: 'Library & Media', desc: 'Free books, websites, lectures and research papers.', slugs: ['library-free-books', 'websites', 'youtube', 'academic-research-papers', 'miscellaneous'], c1: '#232a3a', c2: '#6cb2f5' },
  ].map((s) => ({ ...s, n: count(s.slugs) }));
}

function homePage(data, models, catalog) {
  const topics = data.topics;
  const byTopic = {};
  for (const t of topics) byTopic[t.slug] = models.byId.get(t.id).count;
  const totalResources = Object.values(byTopic).reduce((a, b) => a + b, 0);
  const totalQuestions = catalog.reduce((n, m) => n + (m.questions || 0), 0);

  const streams = streamDefs(models, byTopic)
    .map(
      (s) =>
        '<a class="stream-card reveal" style="--sc1:' + s.c1 + ';--sc2:' + s.c2 + '" href="topics/' + s.slugs[0] + '.html">' +
        '<span class="s-arrow">↗</span><span class="s-emoji">' + s.icon + '</span>' +
        '<h3>' + esc(s.name) + '</h3><p>' + esc(s.desc) + '</p>' +
        '<span class="s-meta">' + s.n + ' resources →</span></a>'
    )
    .join('');

  const featured = catalog
    .filter((m) => /Mock Test (1|2)$|MOCK -(1|2)$|Part Test - 0?1$/.test(m.title))
    .slice(0, 6)
    .map((m) => mockCardHtml(m))
    .join('');

  const cards = topics
    .map((t) => {
      const n = byTopic[t.slug] || 0;
      const tags = (t.tags || []).slice(0, 3).map((x) => '<span class="chip">' + esc(x) + '</span>').join('');
      return (
        '<a class="topic-card reveal" href="topics/' + t.slug + '.html">' +
        '<span class="tc-top"><span class="tc-emoji">' + esc(t.emoji || '📦') + '</span>' +
        '<span class="tc-count">' + n + ' resource' + (n === 1 ? '' : 's') + '</span></span>' +
        '<span class="tc-name">' + esc(t.name) + '</span>' +
        (tags ? '<span class="tc-tags">' + tags + '</span>' : '') +
        '<span class="tc-go">Open collection →</span></a>'
      );
    })
    .join('');

  const content = `
<section class="hero">
  <span class="hero-kicker"><span class="dot"></span><span class="k-full">CUET '27 · Community Archive · Free Forever</span><span class="k-short">CUET '27 · Free Forever</span></span>
  <h1>Every resource.<br><span class="stroke">One</span> <span class="amber">archive.</span><br><span class="serif-it">Zero paywalls.</span></h1>
  <p class="hero-lede">The complete collection of free CUET material shared by the <strong>CUET '27 Discord community</strong> — <strong>${catalog.length} mock tests</strong> you can attempt right in your browser, plus books, notes, lectures and past papers.</p>
  <div class="hero-search">
    <input class="search-input" type="search" placeholder="Try &quot;GAT mock&quot;, &quot;physics&quot;, &quot;books&quot;…" autocomplete="off" aria-label="Search resources">
    <div class="results" hidden></div>
  </div>
  <p class="hero-hint">Press <kbd>/</kbd> anywhere to jump to search · <kbd>↑</kbd><kbd>↓</kbd> to navigate results</p>
  <div class="hero-actions">
    <a class="btn primary" href="mocks.html">⚡ Enter the Mock Lab</a>
    <a class="btn ghost" href="${esc(COMMUNITY.invite)}" target="_blank" rel="noopener">Join the Discord ↗</a>
  </div>
  <nav class="page-map reveal" aria-label="On this page">
    <a href="#streams"><b>01</b>Pick your stream</a>
    <a href="#lab"><b>02</b>Mock Lab</a>
    <a href="#collections"><b>03</b>Collections</a>
    <a href="#alive"><b>04</b>How it stays alive</a>
  </nav>
  <div class="stats">
    <div class="stat"><b><span data-countup="${catalog.length}">${catalog.length}</span></b><span>In-browser mocks</span></div>
    <div class="stat"><b><span data-countup="${totalQuestions}">${totalQuestions.toLocaleString('en-IN')}</span><span class="suffix">+</span></b><span>Practice questions</span></div>
    <div class="stat"><b><span data-countup="${totalResources}">${totalResources}</span></b><span>Links &amp; files</span></div>
    <div class="stat"><b><span data-countup="${topics.length}">${topics.length}</span></b><span>Collections</span></div>
  </div>
</section>

<div class="section-title reveal" id="streams"><h2><span class="n">01</span> Pick your stream</h2></div>
<p class="section-sub reveal">Seven prep streams mapped to the server's subject channels. Start where you are weakest.</p>
<div class="streams">${streams}</div>

<div class="section-title reveal" id="lab"><h2><span class="n">02</span> Mock Lab — this week's papers</h2></div>
<p class="section-sub reveal">Full-length, timed, auto-checked. No signup, no Telegram, no expiry.</p>
<div class="mock-grid rail-m">${featured}</div>
<p class="reveal" style="margin-top:18px"><a class="btn" href="mocks.html">Open all ${catalog.length} papers →</a></p>

<div class="section-title reveal" id="collections"><h2><span class="n">03</span> All collections</h2></div>
<p class="section-sub reveal">Books, PDFs, websites, lectures and papers — exactly as shared in the resources forum.</p>
<div class="grid">${cards}</div>

<div class="section-title reveal" id="alive"><h2><span class="n">04</span> How the archive stays alive</h2></div>
<div class="split">
  <div class="pipe reveal"><h3>🔄 The pipeline</h3><ol>
    <li><strong>Shared in Discord</strong> — members drop books, mocks and links in the resources forum.</li>
    <li><strong>Synced automatically</strong> — the archive bot mirrors new posts on every sync.</li>
    <li><strong>Published here</strong> — this site rebuilds with fresh pages, search and mocks.</li>
  </ol></div>
  <div class="faq reveal"><h3 style="margin:0 0 14px;font-size:18px">❓ Quick answers</h3>
    <details open><summary>Are the mocks really free?</summary><div class="faq-body">Yes. All ${catalog.length} papers are hosted here and run entirely in your browser. No account, no paywall, no expiring download links.</div></details>
    <details><summary>Some file links ask me to join Discord?</summary><div class="faq-body">Original Discord attachment links expire. Every mock is hosted on this site; for other files use the “Open in Discord” button on its card.</div></details>
    <details><summary>How do I request a missing resource?</summary><div class="faq-body">Drop it in the <a href="${esc(COMMUNITY.request)}" target="_blank" rel="noopener">request-resources forum</a> — it lands in the archive on the next sync.</div></details>
  </div>
</div>

<section class="discord-band reveal">
  <div>
    <h2>Study alone, <em>never solo.</em></h2>
    <p>40+ aspirants sharing doubts, daily targets, mocks and motivation in the CUET '27 server. The archive is the library — the server is the classroom.</p>
    <a class="btn primary" href="${esc(COMMUNITY.invite)}" target="_blank" rel="noopener">Join CUET '27 on Discord ↗</a>
  </div>
  <ul class="channel-list">
    <li><a href="${esc(COMMUNITY.resources)}" target="_blank" rel="noopener"><span class="hash">#</span> resources — the source of this archive</a></li>
    <li><a href="${esc(COMMUNITY.mocks)}" target="_blank" rel="noopener"><span class="hash">#</span> mocks — discuss papers &amp; scores</a></li>
    <li><a href="${esc(COMMUNITY.request)}" target="_blank" rel="noopener"><span class="hash">#</span> request-resources — ask for anything</a></li>
    <li><a href="${esc(COMMUNITY.general)}" target="_blank" rel="noopener"><span class="hash">#</span> general — meet your prep crew</a></li>
  </ul>
</section>`;

  return layout({
    rel: '',
    nav: 'home',
    path: '',
    title: "CUET '27 Archive — Free mocks, books & notes for CUET",
    desc: `Attempt ${catalog.length} free CUET mock tests in your browser, plus ${totalResources} books, notes, lectures and papers from the CUET '27 Discord community.`,
    content,
    syncedAt: data.generatedAt,
  });
}

function topicPage(data, topic, model, pos) {
  const topics = data.topics;
  const prev = pos > 0 ? topics[pos - 1] : null;
  const next = pos < topics.length - 1 ? topics[pos + 1] : null;

  const chips = topics
    .map(
      (t) =>
        '<a href="' +
        t.slug +
        '.html" class="' +
        (t.id === topic.id ? 'current' : '') +
        '">' +
        (t.emoji ? esc(t.emoji) + ' ' : '') +
        esc(t.name) +
        '</a>'
    )
    .join('');

  const tags = topic.tags.map((x) => '<span class="chip">' + esc(x) + '</span>').join('');

  const pager =
    '<nav class="pager">' +
    (prev
      ? '<a class="prev" href="' + prev.slug + '.html"><div class="p-dir">← Previous</div><div class="p-name">' + esc(prev.emoji ? prev.emoji + ' ' : '') + esc(prev.name) + '</div></a>'
      : '<a class="spacer"></a>') +
    (next
      ? '<a class="next" href="' + next.slug + '.html"><div class="p-dir">Next →</div><div class="p-name">' + esc(next.emoji ? next.emoji + ' ' : '') + esc(next.name) + '</div></a>'
      : '<a class="spacer"></a>') +
    '</nav>';

  const content = `
<nav class="crumbs"><a href="../index.html">← Home</a><span class="sep">/</span><span>${esc(topic.name)}</span></nav>
<header class="topic-head">
  <h1><span class="t-emoji">${esc(topic.emoji || '📦')}</span>${esc(topic.name)}</h1>
  <div class="topic-meta">
    <span><strong>${model.count}</strong> resource${model.count === 1 ? '' : 's'}</span>
    ${tags}
    <a class="discord-link" href="${esc(topic.url)}" target="_blank" rel="noopener">View original thread ↗</a>
  </div>
</header>
<div class="chips-row">${chips}</div>
${renderToc(model)}
${renderSections(model, '../')}
${pager}
<a class="back-home" href="../index.html">← Back to all topics</a>`;

  return layout({
    rel: '../',
    path: 'topics/' + topic.slug + '.html',
    namespace: 'topic',
    title: topic.name + " — CUET '27 Archive",
    desc: 'Free ' + topic.name + ' study resources for CUET — books, mocks, notes and links from the CUET 27 community.',
    content,
    syncedAt: data.generatedAt,
  });
}

function buildSearchIndex(data, models, catalog) {
  const mockTitle = new Map();
  for (const m of catalog || []) mockTitle.set(m.path, m.display);
  const entries = [];
  for (const t of data.topics) {
    const m = models.byId.get(t.id);
    entries.push({ k: 'topic', t: t.name, tp: t.name, ts: t.slug, n: m.count });
  }
  const seen = new Set();
  for (const t of data.topics) {
    for (const sec of m_sections(t, models)) {
      for (const item of sec.items) {
        if (item.type !== 'link' && item.type !== 'file') continue;
        const key = t.slug + '|' + normUrl(item.url);
        if (seen.has(key)) continue;
        seen.add(key);
        const pretty = item.localPath && mockTitle.get(item.localPath);
        entries.push({
          k: 'link',
          t: pretty || item.title || item.filename || item.domain,
          d: item.desc || '',
          u: item.url,
          lu: item.localPath || '',
          dm: item.type === 'file' ? (item.localPath ? 'Mock test' : fileKind(item) + ' file') : item.domain,
          tp: t.name,
          ts: t.slug,
        });
      }
    }
  }
  return entries;
}

function m_sections(t, models) {
  return models.byId.get(t.id).sections;
}

function generate() {
  if (!fs.existsSync(cfg.DATA_FILE)) {
    throw new Error('data/resources.json not found — run extraction first');
  }
  const data = JSON.parse(fs.readFileSync(cfg.DATA_FILE, 'utf8'));
  const rw = loadRewrites();

  data.topics.sort((a, b) => a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }));

  const byId = new Map();
  for (const t of data.topics) byId.set(t.id, buildModel(t, rw));
  const models = { byId, topics: data.topics };

  const missed = [...rw.texts.keys()].filter((k) => !rw.usedTexts.has(k));
  if (missed.length) {
    console.log('  rewrite texts not matched (' + missed.length + '):');
    missed.forEach((k) => console.log('    - ' + JSON.stringify(k)));
  }

  const site = cfg.SITE_DIR;
  fs.mkdirSync(path.join(site, 'topics'), { recursive: true });
  fs.mkdirSync(path.join(site, 'assets'), { recursive: true });

  const catalog = buildMockCatalog(models);
  console.log('  mock catalog: ' + catalog.length + ' papers');

  fs.writeFileSync(path.join(site, 'index.html'), homePage(data, models, catalog));
  console.log('  index.html');

  let totalResources = 0;
  const pages = ['index.html', 'mocks.html', 'library.html', '404.html'];
  for (const t of data.topics) {
    const m = byId.get(t.id);
    totalResources += m.count;
    const pos = data.topics.indexOf(t);
    fs.writeFileSync(path.join(site, 'topics', t.slug + '.html'), topicPage(data, t, m, pos));
    pages.push('topics/' + t.slug + '.html');
  }
  console.log('  topics: ' + data.topics.length + ' pages');

  fs.writeFileSync(path.join(site, 'mocks.html'), mocksPage(data, catalog));
  console.log('  mocks.html');
  fs.writeFileSync(path.join(site, 'library.html'), libraryPage(data, models));
  console.log('  library.html');
  fs.writeFileSync(path.join(site, '404.html'), notFoundPage(data));
  console.log('  404.html');

  const index = buildSearchIndex(data, models, catalog);
  fs.writeFileSync(path.join(site, 'search.json'), JSON.stringify(index));
  console.log('  search.json: ' + index.length + ' entries');

  fs.writeFileSync(path.join(site, 'mocks.json'), JSON.stringify(catalog, null, 2));
  console.log('  mocks.json');

  for (const f of ['style.css', 'app.js', 'logo.svg']) {
    fs.copyFileSync(path.join(cfg.ASSETS_SRC, f), path.join(site, 'assets', f));
  }
  console.log('  assets copied');

  const lastmod = String(data.generatedAt || '').slice(0, 10) || '2026-09-27';
  const allUrls = pages.concat(catalog.map((m) => m.path));
  const sitemap =
    '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
    allUrls.map((p) => '  <url><loc>' + SITE_URL + p + '</loc><lastmod>' + lastmod + '</lastmod></url>').join('\n') +
    '\n</urlset>\n';
  fs.writeFileSync(path.join(site, 'sitemap.xml'), sitemap);
  fs.writeFileSync(path.join(site, 'robots.txt'), 'User-agent: *\nAllow: /\nSitemap: ' + SITE_URL + 'sitemap.xml\n');
  fs.writeFileSync(path.join(site, '.nojekyll'), '');
  console.log('  sitemap.xml, robots.txt, .nojekyll');

  const meta = {
    generatedAt: data.generatedAt,
    topics: data.topics.length,
    resources: totalResources,
    mocks: catalog.length,
    mockQuestions: catalog.reduce((n, m) => n + (m.questions || 0), 0),
    searchEntries: index.length,
  };
  fs.writeFileSync(path.join(site, 'meta.json'), JSON.stringify(meta, null, 2));

  console.log('\nSite generated: ' + path.relative(cfg.ROOT, site));
  console.log('  topics: ' + meta.topics + ', resources: ' + meta.resources + ', mocks: ' + meta.mocks + ' (' + meta.mockQuestions + ' Qs), search entries: ' + meta.searchEntries);
  return meta;
}

if (require.main === module) {
  try {
    generate();
  } catch (e) {
    console.error('GENERATE FAILED:', e.message);
    process.exit(1);
  }
}

module.exports = { generate };
