(() => {
  const $ = id => document.getElementById(id);
  const filters = $('filters');
  const state = {
    query: '',
    page: 1,
    books: [],
    request: 0,
    pagination: null,
    controller: null,
    languages: new Map(),
    access: 'all'
  };
  const filterKeys = ['lang', 'genre', 'year', 'readable', 'cover', 'sort', 'source'];
  let debounceTimer;

  function languageLabel(code) {
    try {
      return new Intl.DisplayNames(['id'], { type: 'language' }).of(code) || code.toUpperCase();
    } catch {
      return code.toUpperCase();
    }
  }

  function addLanguageOption(code) {
    if (!code || state.languages.has(code)) return;
    state.languages.set(code, languageLabel(code));
    const select = filters?.elements.namedItem('lang');
    if (!select) return;
    const selected = select.value;
    const options = [...state.languages.entries()]
      .sort((a, b) => a[1].localeCompare(b[1], 'id'));
    select.replaceChildren(new Option('Semua bahasa', ''));
    options.forEach(([value, label]) => select.add(new Option(label, value)));
    if (selected && state.languages.has(selected)) select.value = selected;
  }

  function readParams(params) {
    state.query = (params.get('q') || '').trim();
    state.page = Math.max(1, Number(params.get('page')) || 1);
    state.access = ['all', 'free', 'paid'].includes(params.get('access')) ? params.get('access') : 'all';
    document.querySelectorAll('[data-access]').forEach(button => {
      const active = button.dataset.access === state.access;
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', String(active));
    });
    if (!filters) return;
    filterKeys.forEach(key => {
      const field = filters.elements.namedItem(key);
      if (!field) return;
      if (field.type === 'checkbox') field.checked = params.get(key) === '1';
      else {
        const value = params.get(key) || '';
        if (key === 'lang' && value) addLanguageOption(value);
        field.value = value;
      }
    });
  }

  function writeParams() {
    const params = new URLSearchParams();
    if (state.query) params.set('q', state.query);
    if (state.page > 1) params.set('page', state.page);
    if (state.access !== 'all') params.set('access', state.access);
    filterKeys.forEach(key => {
      const field = filters?.elements.namedItem(key);
      if (!field) return;
      if (field.type === 'checkbox' && field.checked) params.set(key, '1');
      else if (field.type !== 'checkbox' && field.value) params.set(key, field.value);
    });
    const query = params.toString();
    history.replaceState(null, '', '#/cari' + (query ? `?${query}` : ''));
  }

  function visibleBooks() {
    const field = name => filters?.elements.namedItem(name);
    let books = state.books.slice();
    if (state.access === 'free') {
      books = books.filter(book =>
        ['full', 'free-epub', 'free-pdf', 'external-full', 'user'].includes(book.accessType)
      );
    } else if (state.access === 'paid') {
      books = books.filter(book => ['paid-purchase', 'paid-subscription'].includes(book.accessType));
    }
    const language = field('lang')?.value;
    if (language) books = books.filter(book => book.lang === language);
    const genre = field('genre')?.value?.toLocaleLowerCase();
    if (genre) {
      books = books.filter(book =>
        `${book.title} ${book.author} ${book.desc} ${(book.subjects || []).join(' ')}`
          .toLocaleLowerCase().includes(genre)
      );
    }
    const year = Number(field('year')?.value);
    if (year) books = books.filter(book => Number(book.year) === year);
    if (field('readable')?.checked) {
      books = books.filter(book =>
        ['full', 'user', 'free-epub', 'free-pdf'].includes(book.accessType) && book.readUrl
      );
    }
    if (field('cover')?.checked) books = books.filter(book => Boolean(book.cover));
    switch (field('sort')?.value) {
      case 'az': books.sort((a, b) => a.title.localeCompare(b.title, 'id')); break;
      case 'za': books.sort((a, b) => b.title.localeCompare(a.title, 'id')); break;
      case 'newest':
        books.sort((a, b) => (Number(b.year) || 0) - (Number(a.year) || 0));
        break;
    }
    return books;
  }

  function render(note = '') {
    const results = $('results');
    const count = $('count');
    const accessCount = $('accessCount');
    const empty = $('state');
    const previous = $('prev');
    const next = $('next');
    const pageLabel = $('pageNo');
    if (!results) return;

    const books = visibleBooks();
    results.innerHTML = books.map(PK.card).join('');
    results.removeAttribute('aria-busy');
    if (count) count.textContent = `${books.length} dari ${state.books.length} hasil ditampilkan${note}`;
    if (accessCount) {
      const free = state.books.filter(book =>
        ['full', 'free-epub', 'free-pdf', 'external-full', 'user'].includes(book.accessType)
      ).length;
      const paid = state.books.filter(book =>
        ['paid-purchase', 'paid-subscription'].includes(book.accessType)
      ).length;
      accessCount.textContent = `Gratis ${free} · Berbayar ${paid}`;
    }
    if (empty) {
      empty.innerHTML = books.length ? '' : `<div class="search-empty">
        <p class="search-empty-title">${state.query || filters?.elements.namedItem('genre')?.value ? 'Tidak ada hasil yang cocok' : 'Mulai pencarian'}</p>
        <p class="search-empty-desc">${state.query || filters?.elements.namedItem('genre')?.value ? 'Coba kata kunci lain atau ganti pilihan filter.' : 'Cari judul, penulis, topik, atau kata kunci.'}</p>
      </div>`;
    }
    const pagination = state.pagination;
    const hasPagination = Boolean(pagination);
    if (pageLabel) pageLabel.textContent = hasPagination
      ? `Halaman ${pagination.page}`
      : 'Halaman berikutnya tidak tersedia.';
    if (previous) previous.disabled = !hasPagination || state.page <= 1;
    if (next) next.disabled = !hasPagination || !pagination.has_next;
  }

  async function load() {
    state.controller?.abort();
    state.controller = new AbortController();
    const requestId = ++state.request;
    writeParams();
    const title = $('title');
    const standardSearch = $('standardEbooksSearch');
    const results = $('results');
    const count = $('count');
    const empty = $('state');
    const sourceStatus = $('sourceStatus');
    if (title) title.textContent = state.query ? `Hasil untuk "${state.query}"` : 'Jelajahi buku';
    if (standardSearch) standardSearch.href = API.standardEbooksSearchUrl(state.query);
    document.title = `${state.query ? state.query + ' – ' : ''}Cari buku – PustakaKita`;
    if (count) count.textContent = 'Mencari katalog…';
    if (sourceStatus) sourceStatus.textContent = 'Menghubungi enam katalog…';
    if (empty) empty.replaceChildren();
    if (results) results.setAttribute('aria-busy', 'true');
    if (results) results.innerHTML = Array(8).fill('<div class="card"><div class="skel"></div></div>').join('');

    try {
      const response = await API.search({
        q: state.query || filters?.elements.namedItem('genre')?.value || '',
        page: state.page,
        lang: filters?.elements.namedItem('lang')?.value || '',
        source: filters?.elements.namedItem('source')?.value || '',
        signal: state.controller.signal
      });
      if (requestId !== state.request) return;
      state.books = response.books;
      state.pagination = response.pagination;
      response.books.forEach(book => addLanguageOption(book.lang));
      render();
      if (sourceStatus) {
        const active = response.total - response.failed;
        sourceStatus.textContent = response.failedSources.length
          ? `${active}/${response.total} sumber aktif · gagal: ${response.failedSources.join(', ')}`
          : `${active} sumber katalog aktif`;
      }
    } catch (error) {
      if (requestId !== state.request) return;
      console.error('Pencarian buku gagal.', error);
      state.books = [];
      state.pagination = null;
      if (results) results.replaceChildren();
      if (results) results.removeAttribute('aria-busy');
      if (count) count.textContent = '';
      if (sourceStatus) sourceStatus.textContent = 'Sumber katalog tidak dapat dijangkau.';
      if (empty) empty.innerHTML = '<div class="search-error"><p class="search-error-title">Pencarian gagal</p><p class="search-error-desc">Periksa koneksi internet, lalu coba lagi.</p><button class="detail-btn detail-btn-primary" id="retrySearch" type="button">Coba lagi</button></div>';
      $('retrySearch')?.addEventListener('click', load);
    }
  }

  function scheduleReload() {
    state.request += 1;
    state.controller?.abort();
    state.page = 1;
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(load, 250);
  }

  if (filters) {
    filters.addEventListener('submit', event => event.preventDefault());
    filters.addEventListener('change', event => {
      if (['lang', 'genre', 'source'].includes(event.target.name)) scheduleReload();
      else { writeParams(); render(); }
    });
    filters.addEventListener('input', event => {
      if (event.target.name === 'year') {
        writeParams();
        render();
      }
    });
  }

  $('prev')?.addEventListener('click', () => {
    if (state.page > 1) { state.page -= 1; load(); }
  });
  document.querySelectorAll('[data-access]').forEach(button => {
    button.addEventListener('click', () => {
      state.access = button.dataset.access;
      state.page = 1;
      writeParams();
      document.querySelectorAll('[data-access]').forEach(item => {
        const active = item === button;
        item.classList.toggle('active', active);
        item.setAttribute('aria-pressed', String(active));
      });
      render();
    });
  });
  $('next')?.addEventListener('click', () => {
    if (state.pagination?.has_next) {
      state.page += 1;
      load();
    }
  });

  const setView = grid => {
    $('results')?.classList.toggle('list', !grid);
    $('vGrid')?.setAttribute('aria-pressed', String(grid));
    $('vList')?.setAttribute('aria-pressed', String(!grid));
  };
  $('vGrid')?.addEventListener('click', () => setView(true));
  $('vList')?.addEventListener('click', () => setView(false));
  $('clearFilters')?.addEventListener('click', () => {
    state.access = 'all';
    document.querySelectorAll('[data-access]').forEach(button => {
      const active = button.dataset.access === 'all';
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', String(active));
    });
    filterKeys.forEach(key => {
      const field = filters?.elements.namedItem(key);
      if (!field) return;
      if (field.type === 'checkbox') field.checked = false;
      else field.value = '';
    });
    scheduleReload();
  });

  PK.views.search = params => {
    readParams(params);
    load();
  };
})();
