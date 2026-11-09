(() => {
  const $ = id => document.getElementById(id);
  const filters = $('filters');
  const state = { query: '', page: 1, books: [], request: 0, pagination: null };
  const filterKeys = ['lang', 'genre', 'year', 'readable', 'cover', 'sort'];
  let debounceTimer;

  function readParams(params) {
    state.query = (params.get('q') || '').trim();
    state.page = Math.max(1, Number(params.get('page')) || 1);
    if (!filters) return;
    filterKeys.forEach(key => {
      const field = filters.elements.namedItem(key);
      if (!field) return;
      if (field.type === 'checkbox') field.checked = params.get(key) === '1';
      else field.value = params.get(key) || '';
    });
  }

  function writeParams() {
    const params = new URLSearchParams();
    if (state.query) params.set('q', state.query);
    if (state.page > 1) params.set('page', state.page);
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
      books = books.filter(book => ['full', 'user'].includes(book.accessType) && book.readUrl);
    }
    if (field('cover')?.checked) books = books.filter(book => Boolean(book.cover));
    switch (field('sort')?.value) {
      case 'az': books.sort((a, b) => a.title.localeCompare(b.title, 'id')); break;
    }
    return books;
  }

  function render(note = '') {
    const results = $('results');
    const count = $('count');
    const empty = $('state');
    const previous = $('prev');
    const next = $('next');
    const pageLabel = $('pageNo');
    if (!results) return;

    const books = visibleBooks();
    results.innerHTML = books.map(PK.card).join('');
    results.removeAttribute('aria-busy');
    if (count) count.textContent = `${books.length} hasil ditampilkan${note}`;
    if (empty) {
      empty.innerHTML = books.length ? '' : `<div class="search-empty">
        <p class="search-empty-title">${state.query ? 'Tidak ada teks yang cocok' : 'Mulai pencarian'}</p>
        <p class="search-empty-desc">${state.query ? 'Coba kata kunci lain atau ganti pilihan filter.' : 'Cari judul, penulis, topik, atau kata kunci.'}</p>
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
    const requestId = ++state.request;
    writeParams();
    const title = $('title');
    const standardSearch = $('standardEbooksSearch');
    const results = $('results');
    const count = $('count');
    const empty = $('state');
    if (title) title.textContent = state.query ? `Hasil untuk "${state.query}"` : 'Jelajahi buku';
    if (standardSearch) standardSearch.href = API.standardEbooksSearchUrl(state.query);
    document.title = `${state.query ? state.query + ' – ' : ''}Cari buku – PustakaKita`;
    if (count) count.textContent = 'Mencari katalog…';
    if (empty) empty.replaceChildren();
    if (results) results.setAttribute('aria-busy', 'true');
    if (results) results.innerHTML = Array(8).fill('<div class="card"><div class="skel"></div></div>').join('');

    try {
      const response = await API.search({
        q: state.query,
        page: state.page,
        lang: filters?.elements.namedItem('lang')?.value || ''
      });
      if (requestId !== state.request) return;
      state.books = response.books;
      state.pagination = response.pagination;
      render(response.failed ? ` · ${response.failed} sumber gagal` : '');
    } catch (error) {
      if (requestId !== state.request) return;
      console.error('Pencarian buku gagal.', error);
      state.books = [];
      state.pagination = null;
      if (results) results.replaceChildren();
      if (results) results.removeAttribute('aria-busy');
      if (count) count.textContent = '';
      if (empty) empty.innerHTML = '<div class="search-error"><p class="search-error-title">Pencarian gagal</p><p class="search-error-desc">Periksa koneksi internet, lalu coba lagi.</p><button class="detail-btn detail-btn-primary" id="retrySearch" type="button">Coba lagi</button></div>';
      $('retrySearch')?.addEventListener('click', load);
    }
  }

  function scheduleReload() {
    state.page = 1;
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(load, 250);
  }

  if (filters) {
    filters.addEventListener('submit', event => event.preventDefault());
    filters.addEventListener('change', event => {
      if (event.target.name === 'lang') scheduleReload();
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

  PK.views.search = params => {
    readParams(params);
    load();
  };
})();
