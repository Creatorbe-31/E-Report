/* Inti: penyimpanan, kartu buku, autocomplete, tema, dan router hash */
const PK = (() => {
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const store = {
    get(k, d) {
      try { return JSON.parse(localStorage.getItem(k)) ?? d; }
      catch (error) { console.error(`Gagal membaca data lokal "${k}".`, error); return d; }
    },
    set(k, v) {
      try { localStorage.setItem(k, JSON.stringify(v)); }
      catch (error) { console.error(`Gagal menyimpan data lokal "${k}".`, error); }
    },
    remove(k) {
      try { localStorage.removeItem(k); }
      catch (error) { console.error(`Gagal menghapus data lokal "${k}".`, error); }
    }
  };
  const ss = {
    get(k) {
      try { return JSON.parse(sessionStorage.getItem(k)); }
      catch (error) { console.error(`Gagal membaca data sesi "${k}".`, error); return null; }
    },
    set(k, v) {
      try { sessionStorage.setItem(k, JSON.stringify(v)); }
      catch (error) { console.error(`Gagal menyimpan data sesi "${k}".`, error); }
    }
  };
  const reg = new Map(), views = {};
  const favs = () => store.get('pk:fav', {});
  const savedBooks = () => store.get('pk:bookmarks', {});
  const hist = () => store.get('pk:hist', []);
  const wantToRead = () => store.get('pk:wantread', {});
  const statuses = () => {
    const saved = store.get('pk:reading-status', {});
    if (!saved || typeof saved !== 'object' || Array.isArray(saved)) return {};
    let migrated = false;
    Object.keys(saved).forEach(id => {
      if (saved[id] === 'completed') {
        saved[id] = 'complete';
        migrated = true;
      }
    });
    if (migrated) store.set('pk:reading-status', saved);
    return saved;
  };
  function toggleBookmark(book) {
    const saved = savedBooks();
    if (saved[book.id]) delete saved[book.id];
    else saved[book.id] = book;
    store.set('pk:bookmarks', saved);
    toast(saved[book.id] ? 'Buku ditambahkan ke bookmark' : 'Bookmark buku dihapus');
    return Boolean(saved[book.id]);
  }
  function setReadingStatus(book, status) {
    const saved = statuses();
    const wanted = wantToRead();
    if (status) {
      saved[book.id] = status;
      store.set('pk:b:' + book.id, book);
    } else {
      delete saved[book.id];
    }
    store.set('pk:reading-status', saved);
    if (status === 'want') wanted[book.id] = book;
    else delete wanted[book.id];
    store.set('pk:wantread', wanted);
    if (status === 'complete') {
      const savedCompletions = store.get('pk:read:completions', {});
      const completed = savedCompletions && typeof savedCompletions === 'object' && !Array.isArray(savedCompletions)
        ? savedCompletions
        : {};
      if (!completed[book.id]) {
        completed[book.id] = {
          completedAt: Date.now(),
          title: book.title,
          subjects: Array.isArray(book.subjects) ? book.subjects : []
        };
        store.set('pk:read:completions', completed);
      }
    }
    return status;
  }
  function toggleFav(b) {
    const f = favs();
    if (f[b.id]) {
      delete f[b.id];
    } else {
      f[b.id] = b;
    }
    store.set('pk:fav', f);
    // Update all favorite buttons
    document.querySelectorAll('.card-fav').forEach(btn => {
      if (btn.dataset.fav === b.id) {
        if (f[b.id]) {
          btn.classList.add('active');
        } else {
          btn.classList.remove('active');
        }
      }
    });
    // If on favorites page, re-render
    if (document.body.dataset.view === 'favorites') {
      const view = PK.views.favorites;
      if (typeof view === 'function') {
        try { view(); } catch (error) { console.error('Favorit gagal diperbarui.', error); }
      }
    } else if (document.body.dataset.view === 'history') {
      const view = PK.views.history;
      if (typeof view === 'function') {
        try { view(); } catch (error) { console.error('Riwayat gagal diperbarui.', error); }
      }
    }
  }
  function addHist(b) { store.set('pk:hist', [b, ...hist().filter(x => x.id !== b.id)].slice(0, 60)); }
  const find = id => reg.get(id) || ss.get('pk:b:' + id) || store.get('pk:b:' + id, null) ||
    favs()[id] || savedBooks()[id] || hist().find(x => x.id === id) || null;
  function toast(msg) {
    const t = Object.assign(document.createElement('div'), { className: 'toast', textContent: msg, role: 'status' });
    document.body.append(t); setTimeout(() => t.remove(), 2200);
  }

  function card(b) {
    reg.set(b.id, b);
    const href = '#/buku/' + encodeURIComponent(b.id);
    const img = b.cover ? `<img src="${esc(b.cover)}" alt="${esc(b.title)}" loading="lazy" data-t="${esc(b.title)}">` : `<span class="ph"><svg width="40" height="60" viewBox="0 0 40 60" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><rect width="40" height="60" rx="4" fill="#EAE8E3"/><path d="M12 20H28M12 28H24M12 36H20" stroke="#7A8190" stroke-width="2" stroke-linecap="round"/></svg><div class="ph-title">${esc(b.title.length > 40 ? b.title.substring(0, 37) + '...' : b.title)}</div></span>`;
    const year = b.year ? `<span class="card-year">${esc(b.year)}</span>` : '';
    const language = b.lang ? `<span class="card-language">${esc(b.lang.toUpperCase())}</span>` : '';
    const author = b.author && b.author !== 'Penulis tidak diketahui' ? `<p class="card-author">${esc(b.author)}</p>` : '';
    const source = b.source ? `<span class="card-source">${esc(b.source)}</span>` : '';
    const access = b.access ? `<span class="card-access">${esc(b.access)}</span>` : '';
    const price = b.price != null && b.currency && /^[A-Z]{3}$/.test(b.currency)
      ? `<span class="card-price">${esc(new Intl.NumberFormat('id-ID', { style: 'currency', currency: b.currency }).format(b.price))}</span>`
      : ['paid-purchase', 'paid-subscription'].includes(b.accessType)
        ? '<span class="card-price">Cek harga di sumber resmi</span>'
        : '';
    const publisher = b.publisher ? `<span class="card-publisher">${esc(b.publisher)}</span>` : '';
    const progress = Number(b._progress?.percent ?? b._progress?.page);
    const progressBar = Number.isFinite(progress) && progress > 0
      ? `<progress class="card-progress" max="100" value="${Math.min(progress, 100)}" aria-label="Progres baca ${Math.min(progress, 100)}%"></progress>`
      : '';
    const rating = b.rating ? `<div class="card-rating"><svg width="12" height="12" viewBox="0 0 12 12" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M6 1L7.545 4.13L11 4.635L8.5 7.07L9.09 10.51L6 8.885L2.91 10.51L3.5 7.07L1 4.635L4.455 4.13L6 1Z" fill="#C5A46D"/></svg><span>${esc(b.rating)}</span></div>` : '';
    return `<article class="card">
      <div class="card-cover-wrap">
        <a class="cover" href="${href}" data-id="${esc(b.id)}" aria-label="${esc(b.title)}">${img}</a>
        <button class="card-fav" data-fav="${esc(b.id)}" aria-label="Tambah ke favorit" title="Favorit">
          <svg width="18" height="18" viewBox="0 0 18 18" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M9 15.75L7.9125 14.7825C4.05 11.31 1.5 9.0225 1.5 6.1875C1.5 3.9 3.315 2.085 5.6025 2.085C6.93 2.085 8.1975 2.7075 9 3.675C9.8025 2.7075 11.07 2.085 12.3975 2.085C14.685 2.085 16.5 3.9 16.5 6.1875C16.5 9.0225 13.95 11.31 10.0875 14.79L9 15.75Z" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </button>
      </div>
      <div class="card-body">
        <h3 class="card-title"><a href="${href}" data-id="${esc(b.id)}">${esc(b.title)}</a></h3>
        ${author}
        <div class="card-meta">
          ${year}
          ${language}
          ${rating}
        </div>
        <div class="card-publisher">${publisher}</div>
        <div class="card-foot">${access}${source}${price}</div>
        ${progressBar}
      </div>
    </article>`;
  }
  document.addEventListener('click', e => {
    const a = e.target.closest('a[data-id]'); if (!a) return;
    const b = reg.get(a.dataset.id);
    if (b) {
      ss.set('pk:b:' + b.id, b);
      store.set('pk:b:' + b.id, b);
    }
  });
  document.addEventListener('click', e => {
    const favBtn = e.target.closest('.card-fav');
    if (favBtn) {
      e.preventDefault();
      const id = favBtn.dataset.fav;
      const b = reg.get(id);
      if (b) {
        toggleFav(b);
        const f = favs();
        if (f[id]) {
          favBtn.classList.add('active');
        } else {
          favBtn.classList.remove('active');
        }
      }
    }
  });
  document.addEventListener('DOMContentLoaded', () => {
    setTimeout(() => {
      document.querySelectorAll('.card-fav').forEach(btn => {
        const id = btn.dataset.fav;
        const f = favs();
        if (f[id]) btn.classList.add('active');
      });
    }, 100);
  });
  document.addEventListener('error', e => {
    const i = e.target; if (i.tagName !== 'IMG' || !i.dataset.t) return;
    if (i.closest('.detail-cover')) {
      i.hidden = true;
      const placeholder = i.parentElement.querySelector('.detail-cover-placeholder');
      if (placeholder) placeholder.hidden = false;
      return;
    }
    i.replaceWith(Object.assign(document.createElement('span'), { className: 'ph', textContent: i.dataset.t }));
  }, true);

  /* tema */
  const setTheme = t => document.documentElement.dataset.theme = t;
  setTheme(store.get('pk:theme', matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'));
  if (typeof pdfjsLib !== 'undefined') {
    pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
  }

  function autocomplete(input) {
    const ul = Object.assign(document.createElement('ul'), { className: 'sug', hidden: true });
    input.parentNode.append(ul); let t, n = 0;
    input.addEventListener('input', () => {
      clearTimeout(t); const q = input.value.trim();
      if (q.length < 3) { ul.hidden = true; return; }
      t = setTimeout(async () => {
        const id = ++n;
        try {
          const r = await API.suggest(q); if (id !== n) return;
          const seen = new Set(), items = r.filter(b => !seen.has(b.title) && seen.add(b.title)).slice(0, 5);
          ul.innerHTML = items.map(b => `<li><a href="#/cari?q=${encodeURIComponent(b.title)}">${esc(b.title)}<small>${esc(b.author)}</small></a></li>`).join('');
          ul.hidden = !items.length;
        } catch { ul.hidden = true; }
      }, 350);
    });
    input.addEventListener('keydown', e => { if (e.key === 'Escape') ul.hidden = true; });
    document.addEventListener('click', e => { if (!input.parentNode.contains(e.target)) ul.hidden = true; });
    ul.addEventListener('click', () => { ul.hidden = true; });
  }

  /* router: #/  #/cari?q=  #/buku/<id>  #/favorit  #/riwayat */
  const ROUTES = { '': 'home', cari: 'search', favorit: 'favorites', riwayat: 'history', kategori: 'home', tentang: 'home', mylibrary: 'mylibrary' };
  function route() {
    const raw = location.hash.replace(/^#\/?/, ''), qi = raw.indexOf('?');
    const path = qi < 0 ? raw : raw.slice(0, qi), params = new URLSearchParams(qi < 0 ? '' : raw.slice(qi + 1));
    let name = ROUTES[path.split('/')[0]], arg = '';
    if (path.startsWith('buku/')) {
      try { name = 'detail'; arg = decodeURIComponent(path.slice(5)); }
      catch { name = 'home'; }
    }
    if (path.startsWith('baca/')) {
      try { name = 'reader'; arg = decodeURIComponent(path.slice(5)); }
      catch { name = 'home'; }
    }
    if (!name) name = 'home';
    document.body.dataset.view = name;
    document.querySelectorAll('[data-view-id]').forEach(s => s.hidden = s.dataset.viewId !== name);
    document.querySelectorAll('[data-nav]').forEach(a => a.dataset.nav === name ? a.setAttribute('aria-current', 'page') : a.removeAttribute('aria-current'));
    const q = name === 'search' ? params.get('q') || '' : '';
    document.querySelectorAll('.top [data-search] input[name=q]').forEach(i => i.value = q);
    scrollTo(0, 0);
    if (name !== 'detail') document.title = 'PustakaKita – Temukan Dunia Baru di Setiap Halaman.';
    views[name] && views[name](params, arg);
  }

    document.addEventListener('DOMContentLoaded', () => {
    document.querySelectorAll('[data-search] input[name=q]').forEach(autocomplete);
    document.addEventListener('submit', e => {
      const f = e.target.closest('form[data-search]'); if (!f) return;
      e.preventDefault();
      const q = f.q.value.trim();
      location.hash = '#/cari' + (q ? '?q=' + encodeURIComponent(q) : '');
      f.querySelector('.sug') && (f.querySelector('.sug').hidden = true);
    });
    const hamburger = document.getElementById('navHamburger');
    const mobileMenu = document.getElementById('navMobileMenu');
    if (hamburger && mobileMenu) {
      const desktopNav = matchMedia('(min-width: 1280px)');
      const closeMobileMenu = () => {
        mobileMenu.classList.remove('active');
        hamburger.setAttribute('aria-expanded', 'false');
      };
      hamburger.addEventListener('click', () => {
        const open = mobileMenu.classList.toggle('active');
        hamburger.setAttribute('aria-expanded', String(open));
      });
      mobileMenu.addEventListener('click', event => {
        if (event.target.closest('a')) {
          mobileMenu.classList.remove('active');
          hamburger.setAttribute('aria-expanded', 'false');
        }
      });
      document.addEventListener('keydown', event => {
        if (event.key === 'Escape') closeMobileMenu();
      });
      addEventListener('hashchange', closeMobileMenu);
      desktopNav.addEventListener('change', event => {
        if (event.matches) closeMobileMenu();
      });
    }
    const themeBtn = document.getElementById('themeBtn');
    if (themeBtn) {
      themeBtn.addEventListener('click', () => {
        const theme = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
        setTheme(theme);
        store.set('pk:theme', theme);
        themeBtn.setAttribute('aria-pressed', String(theme === 'dark'));
      });
      themeBtn.setAttribute('aria-pressed', String(document.documentElement.dataset.theme === 'dark'));
    }
    addEventListener('hashchange', route); route();
  });
  if ('serviceWorker' in navigator) {
    addEventListener('load', () => {
      navigator.serviceWorker.register('./sw.js')
        .catch(error => console.error('Service Worker gagal didaftarkan.', error));
    });
  }
  return { esc, store, favs, savedBooks, hist, wantToRead, statuses, setReadingStatus, toggleFav, toggleBookmark, addHist, find, card, toast, views };
})();