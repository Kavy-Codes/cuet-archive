(function () {
  const BASE = window.__BASE__ || '';
  let INDEX = null;
  let loading = null;

  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));

  function loadIndex() {
    if (INDEX) return Promise.resolve(INDEX);
    if (loading) return loading;
    loading = fetch(BASE + 'search.json')
      .then((r) => r.json())
      .then((d) => {
        INDEX = d;
        return INDEX;
      })
      .catch(() => {
        INDEX = [];
        return INDEX;
      });
    return loading;
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function mark(text, q) {
    const safe = escapeHtml(text);
    if (!q) return safe;
    const i = safe.toLowerCase().indexOf(q.toLowerCase());
    if (i === -1) return safe;
    return safe.slice(0, i) + '<mark>' + safe.slice(i, i + q.length) + '</mark>' + safe.slice(i + q.length);
  }

  function score(entry, q) {
    const t = entry.t.toLowerCase();
    const topic = entry.tp.toLowerCase();
    const d = (entry.d || '').toLowerCase();
    const dm = (entry.dm || '').toLowerCase();
    if (t === q) return 100;
    if (t.startsWith(q)) return 80;
    if (topic.startsWith(q)) return 70;
    if (t.includes(q)) return 60;
    if (topic.includes(q)) return 50;
    if (dm.includes(q)) return 40;
    if (d.includes(q)) return 30;
    const words = q.split(/\s+/).filter(Boolean);
    if (words.length > 1 && words.every((w) => (t + ' ' + topic + ' ' + d).includes(w))) return 20;
    return 0;
  }

  function search(q, limit) {
    if (!INDEX) return [];
    const query = q.trim().toLowerCase();
    if (!query) return [];
    const hits = [];
    for (const e of INDEX) {
      const s = score(e, query);
      if (s > 0) hits.push({ e, s });
    }
    hits.sort((a, b) => b.s - a.s);
    return hits.slice(0, limit || 30).map((h) => h.e);
  }

  function entryUrl(entry) {
    if (entry.k === 'topic') return BASE + 'topics/' + entry.ts + '.html';
    if (entry.lu) return BASE + entry.lu;
    return entry.u;
  }

  function renderResults(box, items, q) {
    if (!q.trim()) {
      box.hidden = true;
      box.innerHTML = '';
      return;
    }
    if (!items.length) {
      box.innerHTML = '<div class="empty">Nothing found for “' + escapeHtml(q) + '”</div>';
      box.hidden = false;
      return;
    }
    box.innerHTML = items
      .map((e) => {
        const sub =
          e.k === 'topic'
            ? '<span class="r-kind">Topic</span> · ' + e.n + ' resources'
            : '<span class="r-kind">' + escapeHtml(e.dm || 'link') + '</span> · ' + escapeHtml(e.tp);
        const href = entryUrl(e);
        const external = e.k !== 'topic' && !e.lu;
        return (
          '<a class="result" href="' +
          escapeHtml(href) +
          '"' +
          (external ? ' target="_blank" rel="noopener"' : '') +
          '><div class="r-title">' +
          mark(e.t, q) +
          '</div><div class="r-sub">' +
          sub +
          '</div></a>'
        );
      })
      .join('');
    box.hidden = false;
  }

  function bindSearch(input) {
    const box = input.parentElement.querySelector('.results');
    if (!box) return;
    let timer = null;
    let active = -1;

    const run = () => {
      const q = input.value;
      loadIndex().then(() => {
        renderResults(box, search(q), q);
        active = -1;
      });
    };

    input.addEventListener('input', () => {
      clearTimeout(timer);
      timer = setTimeout(run, 90);
    });
    input.addEventListener('focus', loadIndex);

    input.addEventListener('keydown', (ev) => {
      const items = $$('.result', box);
      if (ev.key === 'Escape') {
        box.hidden = true;
        input.blur();
        return;
      }
      if (!items.length) return;
      if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
        ev.preventDefault();
        active += ev.key === 'ArrowDown' ? 1 : -1;
        if (active < 0) active = items.length - 1;
        if (active >= items.length) active = 0;
        items.forEach((el, i) => el.classList.toggle('active', i === active));
        items[active].scrollIntoView({ block: 'nearest' });
      } else if (ev.key === 'Enter') {
        const target = items[active >= 0 ? active : 0];
        if (target) {
          ev.preventDefault();
          window.location.href = target.getAttribute('href');
        }
      }
    });

    document.addEventListener('click', (ev) => {
      if (!input.parentElement.contains(ev.target)) box.hidden = true;
    });
  }

  function initTheme() {
    const stored = localStorage.getItem('cuet-archive-theme');
    if (stored) document.documentElement.setAttribute('data-theme', stored);
    const btn = $('#theme-toggle');
    if (!btn) return;
    const sync = () => {
      const t = document.documentElement.getAttribute('data-theme') || 'dark';
      btn.textContent = t === 'dark' ? '☀️' : '🌙';
      btn.setAttribute('aria-label', 'Switch theme');
    };
    sync();
    btn.addEventListener('click', () => {
      const cur = document.documentElement.getAttribute('data-theme') || 'dark';
      const next = cur === 'dark' ? 'light' : 'dark';
      document.documentElement.setAttribute('data-theme', next);
      localStorage.setItem('cuet-archive-theme', next);
      sync();
    });
  }

  function initCopy() {
    document.addEventListener('click', (ev) => {
      const btn = ev.target.closest('[data-copy]');
      if (!btn) return;
      ev.preventDefault();
      let url = btn.getAttribute('data-copy');
      if (url && !/^[a-z]+:/i.test(url)) {
        try { url = new URL(url, location.href).href; } catch (e) {}
      }
      const done = () => {
        const old = btn.textContent;
        btn.textContent = 'Copied ✓';
        btn.classList.add('copied');
        setTimeout(() => {
          btn.textContent = old;
          btn.classList.remove('copied');
        }, 1600);
      };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(url).then(done, done);
      } else {
        const ta = document.createElement('textarea');
        ta.value = url;
        document.body.appendChild(ta);
        ta.select();
        try { document.execCommand('copy'); } catch (e) {}
        document.body.removeChild(ta);
        done();
      }
    });
  }

  function initFavicons() {
    $$('img.favicon').forEach((img) => {
      const domain = img.getAttribute('data-domain');
      img.addEventListener('error', () => {
        const span = document.createElement('span');
        span.className = 'favicon';
        span.textContent = (domain || '?').charAt(0).toUpperCase();
        if (img.parentNode) img.parentNode.replaceChild(span, img);
      });
    });
  }

  function initSyncedTime() {
    $$('[data-iso]').forEach((el) => {
      if (!el.dataset.iso) return;
      const d = new Date(el.dataset.iso);
      if (isNaN(d)) return;
      el.textContent = d.toLocaleString(undefined, {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
    });
  }

  function initReveal() {
    const targets = $$('.hero > *, .section-title, .grid > *, .section, .pager, .topic-head, .toc');
    const reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    targets.forEach((el) => el.classList.add('reveal'));
    if (reduced || !('IntersectionObserver' in window)) {
      targets.forEach((el) => el.classList.add('in'));
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (e.isIntersecting) {
            e.target.classList.add('in');
            io.unobserve(e.target);
          }
        });
      },
      { rootMargin: '0px 0px -8% 0px', threshold: 0.05 }
    );
    targets.forEach((el, i) => {
      el.style.transitionDelay = Math.min(i % 6, 5) * 55 + 'ms';
      io.observe(el);
    });
    setTimeout(() => targets.forEach((el) => el.classList.add('in')), 2500);
  }

  document.addEventListener('DOMContentLoaded', () => {
    initTheme();
    initCopy();
    initFavicons();
    initSyncedTime();
    initReveal();
    $$('.search-input').forEach(bindSearch);
  });
})();
