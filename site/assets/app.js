/* CUET '27 Archive — front-end engine.
 * Vanilla core (search, lab filters, counters, copy, reveals) always runs.
 * GSAP + ScrollTrigger + Anime.js are progressive enhancement only.
 */
(function () {
  'use strict';
  const BASE = window.__BASE__ || '';
  const reducedMotion =
    window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));
  /* per-page cleanups (observers etc.) — run on every Barba leave */
  const cleanups = [];
  const onTeardown = (fn) => cleanups.push(fn);
  function teardownPage() {
    cleanups.splice(0).forEach((fn) => {
      try { fn(); } catch (e) {}
    });
    if (window.ScrollTrigger) {
      try { window.ScrollTrigger.getAll().forEach((t) => t.kill()); } catch (e) {}
    }
    if (window.gsap) {
      try { window.gsap.killTweensOf('*'); } catch (e) {}
    }
  }
  const esc = (s) =>
    String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');

  /* ---------------- search ---------------- */
  let INDEX = null;
  let loading = null;
  function loadIndex() {
    if (INDEX) return Promise.resolve(INDEX);
    if (loading) return loading;
    loading = fetch(BASE + 'search.json')
      .then((r) => r.json())
      .then((d) => (INDEX = d))
      .catch(() => (INDEX = []));
    return loading;
  }
  function score(e, q) {
    const t = String(e.t || '').toLowerCase();
    const topic = String(e.tp || '').toLowerCase();
    const d = String(e.d || '').toLowerCase();
    const dm = String(e.dm || '').toLowerCase();
    if (t === q) return 100;
    if (t.startsWith(q)) return 82;
    if (topic.startsWith(q)) return 72;
    if (t.includes(q)) return 62;
    if (topic.includes(q)) return 52;
    if (dm.includes(q)) return 42;
    if (d.includes(q)) return 32;
    const words = q.split(/\s+/).filter(Boolean);
    if (words.length > 1 && words.every((w) => (t + ' ' + topic + ' ' + d).includes(w))) return 22;
    return 0;
  }
  function doSearch(q, limit) {
    if (!INDEX) return [];
    const query = q.trim().toLowerCase();
    if (query.length < 2) return [];
    return INDEX.map((e) => ({ e, s: score(e, query) }))
      .filter((h) => h.s > 0)
      .sort((a, b) => b.s - a.s)
      .slice(0, limit || 30)
      .map((h) => h.e);
  }
  function entryUrl(e) {
    if (e.k === 'topic') return BASE + 'topics/' + e.ts + '.html';
    if (e.lu) return BASE + e.lu;
    return e.u;
  }
  function mark(text, q) {
    const safe = esc(text);
    if (!q) return safe;
    const i = safe.toLowerCase().indexOf(q.toLowerCase());
    if (i === -1) return safe;
    return safe.slice(0, i) + '<mark>' + safe.slice(i, i + q.length) + '</mark>' + safe.slice(i + q.length);
  }
  function paint(box, items, q) {
    if (!q.trim()) {
      box.hidden = true;
      box.innerHTML = '';
      return;
    }
    if (!items.length) {
      box.innerHTML = '<div class="empty">Nothing found for &ldquo;' + esc(q) + '&rdquo; — try &ldquo;mock&rdquo;, &ldquo;GAT&rdquo; or &ldquo;books&rdquo;.</div>';
      box.hidden = false;
      return;
    }
    box.innerHTML = items
      .map((e) => {
        const sub =
          e.k === 'topic'
            ? '<span class="r-kind">Topic</span> &middot; ' + e.n + ' resources'
            : '<span class="r-kind">' + esc(e.dm || 'link') + '</span> &middot; ' + esc(e.tp);
        // mock papers are standalone apps — always open in a new tab, never Barba-swap
        const newtab = e.k !== 'topic';
        const external = newtab;
        return (
          '<a class="result" href="' +
          esc(entryUrl(e)) +
          '"' +
          (newtab ? ' target="_blank" rel="noopener"' : '') +
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
    if (input.dataset.bound) return;
    input.dataset.bound = '1';
    const box = input.parentElement.querySelector('.results');
    if (!box) return;
    let timer = null;
    let active = -1;
    const run = () => {
      const q = input.value;
      loadIndex().then(() => {
        paint(box, doSearch(q), q);
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
        const t = items[active >= 0 ? active : 0];
        if (t) {
          ev.preventDefault();
          window.location.href = t.getAttribute('href');
        }
      }
    });
    document.addEventListener('click', (ev) => {
      if (!input.parentElement.contains(ev.target)) box.hidden = true;
    });
  }

  /* ---------------- mock lab ---------------- */
  function initLab() {
    const grid = $('#mock-grid');
    if (!grid) return;
    const cards = $$('.mock-card', grid);
    const empty = $('#lab-empty');
    const count = $('#lab-count');
    const search = $('#lab-search');
    const chips = $$('.fchip[data-f]');
    const sort = $('#lab-sort');
    let subject = 'all';
    const norm = (s) => String(s || '').toLowerCase();
    function apply() {
      const q = norm(search && search.value).trim();
      let shown = 0;
      cards.forEach((c) => {
        const okSub = subject === 'all' || c.dataset.subject === subject;
        const hay = norm(c.dataset.title + ' ' + c.dataset.subject + ' ' + c.dataset.engine);
        const okQ = !q || q.split(/\s+/).every((w) => hay.includes(w));
        const show = okSub && okQ;
        c.hidden = !show;
        if (show) shown++;
      });
      if (empty) empty.hidden = shown !== 0;
      if (count) count.textContent = shown + ' / ' + cards.length + ' papers';
    }
    function order() {
      if (!sort) return;
      const list = cards.slice();
      if (sort.value === 'az') list.sort((a, b) => norm(a.dataset.title).localeCompare(norm(b.dataset.title)));
      else if (sort.value === 'qs') list.sort((a, b) => (+b.dataset.qs || 0) - (+a.dataset.qs || 0));
      else list.sort((a, b) => (+a.dataset.order || 0) - (+b.dataset.order || 0));
      list.forEach((c) => grid.appendChild(c));
    }
    chips.forEach((ch) =>
      ch.addEventListener('click', () => {
        chips.forEach((c) => c.classList.remove('on'));
        ch.classList.add('on');
        subject = ch.dataset.f;
        apply();
      })
    );
    if (search) {
      let t = null;
      search.addEventListener('input', () => {
        clearTimeout(t);
        t = setTimeout(apply, 80);
      });
    }
    if (sort) sort.addEventListener('change', order);
    const dice = $('#lab-random');
    if (dice) {
      dice.addEventListener('click', () => {
        const pool = cards.filter((c) => !c.hidden);
        if (!pool.length) return;
        const pick = pool[Math.floor(Math.random() * pool.length)];
        dice.textContent = '🎲 ' + (pick.dataset.title || 'paper').split(' ').slice(0, 3).join(' ') + '…';
        setTimeout(() => {
          window.open(pick.getAttribute('href'), '_blank', 'noopener');
          dice.textContent = '🎲 Surprise me';
        }, 450);
      });
    }
    apply();
  }

  /* ---------------- counters ---------------- */
  function initCounters() {
    const els = $$('[data-countup]');
    if (!els.length) return;
    const set = (el) => {
      el.textContent = (+el.dataset.countup || 0).toLocaleString('en-IN');
    };
    if (reducedMotion || !('IntersectionObserver' in window)) {
      els.forEach(set);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((en) => {
          if (!en.isIntersecting) return;
          const el = en.target;
          io.unobserve(el);
          const target = +el.dataset.countup || 0;
          const t0 = performance.now();
          const dur = 1100;
          const tick = (t) => {
            const p = Math.min(1, (t - t0) / dur);
            const eased = 1 - Math.pow(1 - p, 3);
            el.textContent = Math.round(target * eased).toLocaleString('en-IN');
            if (p < 1) requestAnimationFrame(tick);
          };
          requestAnimationFrame(tick);
        });
      },
      { threshold: 0.4 }
    );
    els.forEach((el) => io.observe(el));
    onTeardown(() => io.disconnect());
  }

  /* ---------------- copy buttons ---------------- */
  function initCopy() {
    document.addEventListener('click', (ev) => {
      const btn = ev.target.closest('[data-copy]');
      if (!btn) return;
      ev.preventDefault();
      let url = btn.getAttribute('data-copy');
      if (url && !/^[a-z]+:/i.test(url)) {
        try {
          url = new URL(url, location.href).href;
        } catch (e) {}
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
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(url).then(done, done);
      else {
        const ta = document.createElement('textarea');
        ta.value = url;
        document.body.appendChild(ta);
        ta.select();
        try {
          document.execCommand('copy');
        } catch (e) {}
        document.body.removeChild(ta);
        done();
      }
    });
  }

  /* ---------------- card cursor glow (fine pointers only) ---------------- */
  function initGlow() {
    if (reducedMotion) return;
    if (window.matchMedia && !window.matchMedia('(pointer: fine)').matches) return;
    $$('.topic-card, .stream-card').forEach((card) => {
      card.addEventListener('pointermove', (ev) => {
        const r = card.getBoundingClientRect();
        card.style.setProperty('--mx', ev.clientX - r.left + 'px');
        card.style.setProperty('--my', ev.clientY - r.top + 'px');
      });
    });
  }

  /* ---------------- dates ---------------- */
  function initDates() {
    $$('[data-iso]').forEach((el) => {
      if (!el.dataset.iso) return;
      const d = new Date(el.dataset.iso);
      if (isNaN(d)) return;
      el.textContent = d.toLocaleString(undefined, {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
      });
    });
  }

  /* ---------------- back to top (all viewports — long library pages) ---------------- */
  function initToTop() {
    const btn = document.createElement('button');
    btn.className = 'to-top';
    btn.type = 'button';
    btn.setAttribute('aria-label', 'Back to top');
    btn.textContent = '↑';
    document.body.appendChild(btn);
    let ticking = false;
    const sync = () => {
      ticking = false;
      btn.classList.toggle('show', window.scrollY > 700);
    };
    window.addEventListener('scroll', () => {
      if (!ticking) {
        ticking = true;
        requestAnimationFrame(sync);
      }
    }, { passive: true });
    sync();
    btn.addEventListener('click', () => {
      window.scrollTo({ top: 0, behavior: reducedMotion ? 'auto' : 'smooth' });
    });
  }

  /* ---------------- motion: GSAP + Anime, guarded ---------------- */
  function initMotion(simple) {
    const targets = $$('.reveal');
    targets.forEach((el) => el.classList.add('reveal'));
    if (reducedMotion) {
      document.documentElement.classList.add('no-motion');
      targets.forEach((el) => el.classList.add('in'));
      return;
    }
    const isMobile = window.matchMedia && window.matchMedia('(max-width: 700px)').matches;
    const rise = isMobile ? 16 : 30;
    const dur = isMobile ? 0.5 : 0.75;
    // Path 1 — GSAP + ScrollTrigger (skipped for Barba enters: curtain owns the motion)
    if (!simple && window.gsap && window.ScrollTrigger) {
      try {
        gsap.registerPlugin(ScrollTrigger);
        if (window.ScrollTrigger.config) ScrollTrigger.config({ ignoreMobileResize: true });
        gsap.fromTo(
          '.hero > *',
          { y: isMobile ? 18 : 34, opacity: 0 },
          { y: 0, opacity: 1, duration: isMobile ? 0.6 : 0.9, stagger: isMobile ? 0.05 : 0.09, ease: 'power3.out', delay: 0.05, overwrite: 'auto' }
        );
        $$('.reveal').forEach((el) => {
          if (el.closest('.hero')) {
            el.classList.add('in');
            return;
          }
          gsap.fromTo(
            el,
            { y: rise, opacity: 0 },
            {
              y: 0,
              opacity: 1,
              duration: dur,
              ease: 'power3.out',
              overwrite: 'auto',
              scrollTrigger: { trigger: el, start: 'top 92%', once: true },
              onComplete: () => el.classList.add('in'),
            }
          );
        });
      } catch (e) {
        fallbackReveal(targets);
      }
    } else {
      fallbackReveal(targets);
    }
    // Path 2 — Anime.js micro-interactions (hero kicker + stat pop)
    if (window.anime && !reducedMotion) {
      try {
        anime({
          targets: '.hero-kicker',
          scale: [0.9, 1],
          opacity: [0, 1],
          duration: 700,
          easing: 'easeOutBack(2.2)',
        });
        anime({
          targets: '.stat',
          translateY: [16, 0],
          opacity: [0, 1],
          delay: anime.stagger(90, { start: 350 }),
          duration: 600,
          easing: 'easeOutCubic',
        });
      } catch (e) {}
    }
  }
  function fallbackReveal(targets) {
    if (!('IntersectionObserver' in window)) {
      targets.forEach((el) => el.classList.add('in'));
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((en) => {
          if (en.isIntersecting) {
            en.target.classList.add('in');
            io.unobserve(en.target);
          }
        });
      },
      { rootMargin: '0px 0px -6% 0px', threshold: 0.04 }
    );
    targets.forEach((el) => io.observe(el));
    onTeardown(() => io.disconnect());
    setTimeout(() => targets.forEach((el) => el.classList.add('in')), 3000);
  }

  /* ---------------- per-page boot (runs on load + every Barba enter) ---------------- */
  function bootPage(simple) {
    $$('.search-input').forEach(bindSearch);
    initLab();
    initCounters();
    initGlow();
    initDates();
    initMotion(!!simple);
    $$('img.favicon').forEach((img) => {
      img.addEventListener('error', () => {
        const span = document.createElement('span');
        span.className = 'favicon';
        span.textContent = '🔗';
        if (img.parentNode) img.parentNode.replaceChild(span, img);
      });
    });
  }

  /* ---------------- Barba page transitions (progressive enhancement) ---------------- */
  function barbaOK() {
    return !!(window.barba && window.gsap) && !reducedMotion;
  }
  function internalLink(a) {
    if (!a || a.target === '_blank') return false;
    const href = a.getAttribute('href') || '';
    if (!href || href.startsWith('#')) return false;
    if (href.includes('/mocks/') || href.endsWith('.html') && href.includes('mocks/')) return false;
    if (/^(mailto:|tel:|javascript:)/.test(href)) return false;
    if (/^https?:/.test(href)) {
      try {
        if (new URL(href, location.href).origin !== location.origin) return false;
      } catch (e) {
        return false;
      }
    }
    return true;
  }
  /* hover-prefetch: warm the HTTP cache so Barba swaps feel instant */
  function initPrefetch() {
    let last = 0;
    const warm = (a) => {
      if (!internalLink(a)) return;
      const now = Date.now();
      if (now - last < 150) return;
      last = now;
      try {
        fetch(a.href, { mode: 'same-origin', credentials: 'same-origin' }).catch(() => {});
      } catch (e) {}
    };
    document.addEventListener('mouseover', (ev) => {
      const a = ev.target && ev.target.closest ? ev.target.closest('a[href]') : null;
      if (a) warm(a);
    }, { passive: true });
    document.addEventListener('focusin', (ev) => {
      const a = ev.target && ev.target.closest ? ev.target.closest('a[href]') : null;
      if (a) warm(a);
    }, { passive: true });
  }
  function veil() {
    let v = $('.page-veil');
    if (v) return v;
    v = document.createElement('div');
    v.className = 'page-veil';
    v.setAttribute('aria-hidden', 'true');
    const base = window.__BASE__ || '';
    v.innerHTML =
      '<div class="veil-inner"><img src="' + base + 'assets/logo.svg" alt=""><span>CUET <em>\'27</em></span></div>';
    document.body.appendChild(v);
    return v;
  }
  function initBarba() {
    if (!barbaOK()) return;
    const mobile = window.matchMedia && window.matchMedia('(max-width: 700px)').matches;
    const D = mobile ? 0.38 : 0.5;
    let busy = false;
    let watchdog = null;
    /* promise that ALWAYS resolves — a stuck tween can never strand the veil */
    const tweenTo = (targets, vars) =>
      new Promise((resolve) => {
        let done = false;
        const finish = () => {
          if (!done) {
            done = true;
            resolve();
          }
        };
        const timer = setTimeout(finish, (vars.duration || 0.5) * 1000 + 1500);
        try {
          gsap.to(targets, {
            ...vars,
            onComplete: () => {
              clearTimeout(timer);
              finish();
            },
            onInterrupt: () => {
              clearTimeout(timer);
              finish();
            },
          });
        } catch (e) {
          clearTimeout(timer);
          finish();
        }
      });
    const hideVeilNow = () => {
      const v = $('.page-veil');
      if (!v) return;
      try {
        gsap.killTweensOf(v);
        gsap.set(v, { yPercent: 101 });
      } catch (e) {
        v.style.transform = 'translateY(101%)';
      }
    };
    const armWatchdog = () => {
      clearTimeout(watchdog);
      watchdog = setTimeout(() => {
        // last-resort recovery: never leave the user staring at the curtain
        hideVeilNow();
        busy = false;
        const c = document.querySelector('[data-barba="container"]');
        if (c) {
          try {
            gsap.set(c, { opacity: 1, y: 0 });
          } catch (e) {
            c.style.opacity = '1';
            c.style.transform = 'none';
          }
        }
      }, 3500);
    };
    try {
      window.barba.init({
        timeout: 4000,
        prevent: ({ el }) => {
          if (busy) return true; // ignore taps while a transition is in flight
          return !internalLink(el);
        },
        transitions: [
          {
            name: 'curtain',
            async leave() {
              busy = true;
              armWatchdog();
              teardownPage();
              const v = veil();
              try {
                gsap.set(v, { yPercent: 101 });
              } catch (e) {}
              await tweenTo(v, { yPercent: 0, duration: D, ease: 'power4.inOut' });
            },
            async beforeEnter(data) {
              try {
                const m = String(data.next.html || '').match(/<title>([\s\S]*?)<\/title>/i);
                if (m) {
                  const ta = document.createElement('textarea');
                  ta.innerHTML = m[1];
                  document.title = ta.value;
                }
              } catch (e) {}
              try {
                bootPage(true);
              } catch (e) {}
            },
            async enter(data) {
              try {
                const v = veil();
                const hash = data.next.url && data.next.url.hash ? data.next.url.hash.slice(1) : '';
                const container = data.next.container;
                try {
                  gsap.set(container, { opacity: 0, y: mobile ? 16 : 26 });
                } catch (e) {}
                if (!hash) window.scrollTo(0, 0);
                await Promise.all([
                  tweenTo(v, { yPercent: -101, duration: D + 0.1, ease: 'power4.inOut', delay: 0.05 }),
                  tweenTo(container, { opacity: 1, y: 0, duration: D + 0.15, ease: 'power3.out', delay: 0.12 }),
                ]);
                if (hash) {
                  const t = document.getElementById(hash);
                  if (t) t.scrollIntoView({ behavior: 'auto' });
                }
              } catch (e) {
                hideVeilNow();
              }
            },
            after() {
              clearTimeout(watchdog);
              busy = false;
              hideVeilNow();
              if (window.ScrollTrigger) {
                try { window.ScrollTrigger.refresh(); } catch (e) {}
              }
            },
          },
        ],
      });
    } catch (e) {}
  }

  document.addEventListener('DOMContentLoaded', () => {
    // global-once bindings (document-delegated — survive Barba swaps)
    document.addEventListener('keydown', (ev) => {
      if (ev.key !== '/' || ev.ctrlKey || ev.metaKey || ev.altKey) return;
      const tag = (document.activeElement && document.activeElement.tagName) || '';
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      const box = $('.hero-search .search-input') || $('.search-input');
      if (box) {
        ev.preventDefault();
        box.focus();
        box.scrollIntoView({ block: 'center', behavior: reducedMotion ? 'auto' : 'smooth' });
      }
    });
    initCopy();
    initToTop();
    bootPage(false);
    initPrefetch();
    initBarba();
  });
})();
