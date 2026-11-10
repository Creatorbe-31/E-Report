(() => {
  let loaded = false;
  const $ = id => document.getElementById(id);
  const jobs = {
    featuredShelf: ['featuredMsg', API.popularBooks, books => books.filter(book =>
      book.readUrl && ['full', 'free-epub', 'free-pdf'].includes(book.accessType)
    )],
    indonesiaShelf: ['indonesiaMsg', async () => (await API.search({ q: 'novel', lang: 'id' })).books, books => books.filter(book => book.readUrl)],
    internationalShelf: ['internationalMsg', async () => (await API.search({ q: 'novel', lang: 'en' })).books, books => books.filter(book => book.readUrl)],
    newestShelf: ['newestMsg', API.newestBooks]
  };

  async function fill(id, messageId, load) {
    const shelf = $(id);
    const message = $(messageId);
    if (!shelf || !message) return;

    shelf.setAttribute('aria-busy', 'true');
    shelf.innerHTML = Array(5).fill('<div class="card"><div class="skel"></div></div>').join('');
    try {
      const loadedBooks = await load();
      const filter = jobs[id][2];
      const books = (filter ? filter(loadedBooks) : loadedBooks).filter(book => book.title).slice(0, 15);
      shelf.innerHTML = books.map(PK.card).join('');
      message.textContent = books.length ? '' : 'Belum ada hasil yang sesuai dari sumber ini.';
    } catch (error) {
      console.error(`Koleksi ${id} gagal dimuat.`, error);
      shelf.replaceChildren();
      message.innerHTML = `Katalog belum dapat dimuat. <button class="btn alt" type="button" data-retry="${id}">Coba lagi</button> <a class="btn alt" href="#/cari">Jelajahi katalog</a>`;
    } finally {
      shelf.removeAttribute('aria-busy');
    }
  }

  document.addEventListener('click', event => {
    const category = event.target.closest('.category-card');
    if (category) {
      const params = new URLSearchParams({ q: category.dataset.cat || '' });
      if (category.dataset.lang) params.set('lang', category.dataset.lang);
      location.hash = '#/cari?' + params.toString();
    }

    const retry = event.target.closest('[data-retry]');
    if (retry && jobs[retry.dataset.retry]) {
      const [messageId, load] = jobs[retry.dataset.retry];
      fill(retry.dataset.retry, messageId, load);
    }
  });

  PK.views.home = () => {
    const continueShelf = $('continueShelf');
    const continueMessage = $('continueMsg');
    const continuing = Object.entries(PK.statuses())
      .filter(([id, status]) => status === 'reading' && PK.store.get(`pk:read:${encodeURIComponent(id)}:progress`, null))
      .map(([id]) => {
        const book = PK.find(id);
        const progress = PK.store.get(`pk:read:${encodeURIComponent(id)}:progress`, null);
        return book ? { ...book, _progress: progress } : null;
      })
      .filter(book => book && book.readUrl && ['full', 'user', 'free-epub', 'free-pdf'].includes(book.accessType))
      .slice(0, 10);
    if (continueShelf && continueMessage) {
      continueShelf.innerHTML = continuing.map(PK.card).join('');
      continueMessage.textContent = continuing.length ? '' : 'Belum ada progres bacaan. Buka buku yang bisa dibaca untuk memulai.';
    }

    const history = PK.hist()
      .filter(book => book.readUrl && ['full', 'user', 'free-epub', 'free-pdf'].includes(book.accessType))
      .slice(0, 12);
    const recent = $('recentShelf');
    const recentMessage = $('recentMsg');
    if (recent && recentMessage) {
      recent.innerHTML = history.map(PK.card).join('');
      recentMessage.textContent = history.length ? '' : 'Belum ada riwayat bacaan.';
    }

    if (loaded) return;
    loaded = true;
    Object.entries(jobs).forEach(([id, [messageId, load]]) => fill(id, messageId, load));
  };
})();
