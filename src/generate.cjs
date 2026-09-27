const fs = require('fs');
const path = require('path');
const cfg = require('./config.cjs');

const SITE_NAME = 'The CUET Archive';

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
    return out.replace(/\/$/, '');
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

function buildModel(topic) {
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

  const namePlain = topic.name.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

  for (const msg of topic.messages) {
    for (const b of msg.blocks) {
      if (b.type === 'heading') {
        const t = (b.text || '').trim();
        if (!t) continue;
        const tPlain = t.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
        if (tPlain === namePlain) continue;
        if (t.length <= 60) startSection(t);
        else current.items.push({ type: 'note', text: t });
      } else if (b.type === 'flow') {
        const raw = flowText(b.items).trim();
        if (!raw) continue;
        const rawPlain = raw.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
        if (rawPlain === namePlain) continue;
        current.items.push({ type: 'para', html: flowHtml(b.items) });
      } else if (b.type === 'link') {
        const key = normUrl(b.url);
        if (seenUrls.has(key)) continue;
        seenUrls.add(key);
        current.items.push({
          type: 'link',
          url: b.url,
          domain: b.domain || '',
          title: linkTitle(b),
          desc: linkDesc(b),
        });
      } else if (b.type === 'attachment') {
        const key = normUrl(b.url);
        if (seenUrls.has(key)) continue;
        seenUrls.add(key);
        current.items.push({
          type: 'file',
          url: b.url,
          filename: b.filename,
          size: b.size,
          messageUrl: msg.messageUrl || '',
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

function cardHtml(item) {
  if (item.type === 'file') {
    return (
      '<div class="card file-card">' +
      '<div class="card-head">' +
      '<span class="favicon">📄</span>' +
      '<div><a class="card-title" href="' +
      esc(item.url) +
      '" target="_blank" rel="noopener">' +
      esc(item.filename) +
      '</a><span class="card-domain">Discord file' +
      (item.size ? ' · <span class="file-size">' + fmtSize(item.size) + '</span>' : '') +
      '</span></div></div>' +
      '<div class="card-actions">' +
      '<a class="btn primary" href="' +
      esc(item.url) +
      '" target="_blank" rel="noopener">Open file</a>' +
      (item.messageUrl
        ? '<a class="btn" href="' + esc(item.messageUrl) + '" target="_blank" rel="noopener">Open in Discord ↗</a>'
        : '') +
      '<button class="btn" data-copy="' +
      esc(item.url) +
      '">Copy link</button>' +
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
  const desc = opts.desc || 'Free CUET resources mirrored from Discord.';
  return `<!doctype html>
<html lang="en" data-theme="dark">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}">
<meta name="color-scheme" content="dark light">
<link rel="icon" href="data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 100%22><text y=%22.9em%22 font-size=%2290%22>🏛️</text></svg>">
<link rel="stylesheet" href="${rel}assets/style.css">
</head>
<body>
<header class="topbar">
  <div class="topbar-inner">
    <a class="brand" href="${rel}index.html"><span class="logo">🏛️</span><span>${SITE_NAME}</span></a>
    <div class="searchwrap">
      <input class="search-input" type="search" placeholder="Search resources…" autocomplete="off" aria-label="Search resources">
      <div class="results" hidden></div>
    </div>
    <button id="theme-toggle" class="iconbtn" type="button">☀️</button>
  </div>
</header>
<main class="wrap">
${opts.content}
</main>
<footer>
  <div class="wrap footer-inner">
    <div>Mirrored from the <strong>CUET 2027</strong> Discord · <span id="synced-time" data-iso="${esc(opts.syncedAt || '')}"></span></div>
    <div class="foot-links">
      <a href="${esc(opts.forumUrl || '#')}" target="_blank" rel="noopener">Source forum</a>
      <a href="${rel}index.html">Home</a>
    </div>
  </div>
</footer>
<script>window.__BASE__=${JSON.stringify(rel)};</script>
<script src="${rel}assets/app.js" defer></script>
</body>
</html>`;
}

function renderSections(model) {
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
      const cardsHtml = cards.length ? '<div class="cards">' + cards.map(cardHtml).join('') + '</div>' : '';
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
    '<details class="toc"><summary>Jump to section (' + secs.length + ')</summary><div class="toc-links">' +
    secs.map((s) => '<a href="#' + s.id + '">' + esc(s.title) + '</a>').join('') +
    '</div></details>'
  );
}

function homePage(data, models) {
  const topics = data.topics;
  const totalResources = topics.reduce((sum, t) => sum + models.get(t.id).count, 0);
  const cards = topics
    .map((t) => {
      const m = models.get(t.id);
      const tags = t.tags.map((x) => '<span class="chip">' + esc(x) + '</span>').join('');
      return (
        '<a class="topic-card" href="topics/' +
        t.slug +
        '.html">' +
        '<span class="tc-emoji">' +
        esc(t.emoji || '📦') +
        '</span>' +
        '<span class="tc-name">' +
        esc(t.name) +
        '</span>' +
        (tags ? '<span class="tc-tags">' + tags + '</span>' : '') +
        '<span class="tc-count">' +
        m.count +
        ' resource' +
        (m.count === 1 ? '' : 's') +
        '</span>' +
        '</a>'
      );
    })
    .join('');

  const content = `
<section class="hero">
  <h1>The <span class="hl">CUET</span> Archive</h1>
  <p>Every free resource from the CUET 2027 Discord — books, mocks, PDFs, websites and videos — in one place, easy to search, no clutter.</p>
  <div class="hero-search">
    <input class="search-input" type="search" placeholder="Search for books, mocks, websites…" autocomplete="off" aria-label="Search resources">
    <div class="results" hidden></div>
  </div>
  <div class="stats">
    <span class="stat"><b>${data.stats.topics}</b> topics</span>
    <span class="stat"><b>${totalResources}</b> links &amp; files</span>
    <span class="stat">synced <b id="synced-time-hero" data-iso="${esc(data.generatedAt)}"></b></span>
  </div>
</section>
<div class="section-title">
  <h2>Browse by topic</h2>
  <span class="hint">Tap a card to open its page</span>
</div>
<div class="grid">${cards}</div>`;

  return layout({
    rel: '',
    title: SITE_NAME + ' — Free CUET resources, mirrored from Discord',
    desc: 'A searchable archive of every free resource shared in the CUET 2027 Discord: books, mock tests, PDFs, websites and videos.',
    content,
    syncedAt: data.generatedAt,
    forumUrl: data.source.forumUrl,
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
    <a class="discord-link" href="${esc(topic.url)}" target="_blank" rel="noopener">View in Discord ↗</a>
  </div>
</header>
<div class="chips-row">${chips}</div>
${renderToc(model)}
${renderSections(model)}
${pager}
<a class="back-home" href="../index.html">← Back to all topics</a>`;

  return layout({
    rel: '../',
    title: topic.name + ' — ' + SITE_NAME,
    desc: 'Free ' + topic.name + ' resources for CUET, mirrored from the CUET 2027 Discord.',
    content,
    syncedAt: data.generatedAt,
    forumUrl: data.source.forumUrl,
  });
}

function buildSearchIndex(data, models) {
  const entries = [];
  for (const t of data.topics) {
    const m = models.get(t.id);
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
        entries.push({
          k: 'link',
          t: item.title || item.filename || item.domain,
          d: item.desc || '',
          u: item.url,
          dm: item.type === 'file' ? 'discord attachment' : item.domain,
          tp: t.name,
          ts: t.slug,
        });
      }
    }
  }
  return entries;
}

function m_sections(t, models) {
  return models.get(t.id).sections;
}

function generate() {
  if (!fs.existsSync(cfg.DATA_FILE)) {
    throw new Error('data/resources.json not found — run extraction first');
  }
  const data = JSON.parse(fs.readFileSync(cfg.DATA_FILE, 'utf8'));

  data.topics.sort((a, b) => a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }));

  const models = new Map();
  for (const t of data.topics) models.set(t.id, buildModel(t));

  const site = cfg.SITE_DIR;
  fs.mkdirSync(path.join(site, 'topics'), { recursive: true });
  fs.mkdirSync(path.join(site, 'assets'), { recursive: true });

  fs.writeFileSync(path.join(site, 'index.html'), homePage(data, models));
  console.log('  index.html');

  let totalResources = 0;
  for (const t of data.topics) {
    const m = models.get(t.id);
    totalResources += m.count;
    const pos = data.topics.indexOf(t);
    fs.writeFileSync(path.join(site, 'topics', t.slug + '.html'), topicPage(data, t, m, pos));
  }
  console.log('  topics: ' + data.topics.length + ' pages');

  const index = buildSearchIndex(data, models);
  fs.writeFileSync(path.join(site, 'search.json'), JSON.stringify(index));
  console.log('  search.json: ' + index.length + ' entries');

  for (const f of ['style.css', 'app.js']) {
    fs.copyFileSync(path.join(cfg.ASSETS_SRC, f), path.join(site, 'assets', f));
  }
  console.log('  assets copied');

  const meta = {
    generatedAt: data.generatedAt,
    topics: data.topics.length,
    resources: totalResources,
    searchEntries: index.length,
  };
  fs.writeFileSync(path.join(site, 'meta.json'), JSON.stringify(meta, null, 2));

  console.log('\nSite generated: ' + path.relative(cfg.ROOT, site));
  console.log('  topics: ' + meta.topics + ', resources: ' + meta.resources + ', search entries: ' + meta.searchEntries);
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
