(() => {
  const root = document.getElementById('detailRoot');
  const esc = PK.esc;
  const safeUrl = value => {
    try {
      const url = new URL(value);
      return url.protocol === 'https:' ? url.href : '';
    } catch {
      return '';
    }
  };
  const displayPrice = book => {
    if (book.price == null || !/^[A-Z]{3}$/.test(book.currency || '')) return 'Cek harga di sumber resmi';
    try {
      return new Intl.NumberFormat('id-ID', { style: 'currency', currency: book.currency }).format(book.price);
    } catch {
      return `${book.price} ${book.currency}`;
    }
  };
  function actionLink(url, label, primary = false) {
    const safe = safeUrl(url);
    if (!safe) return '';
    return `<a class="detail-btn${primary ? ' detail-btn-primary' : ''}" href="${esc(safe)}" target="_blank" rel="noopener noreferrer">${label}</a>`;
  }

  function renderBook(book) {
    const sources = book.sources || [book.source].filter(Boolean);
    const image = book.cover
      ? `<img src="${esc(book.cover)}" alt="Sampul ${esc(book.title)}" data-t="${esc(book.title)}">`
      : '';
    const placeholder = `<div class="detail-cover-placeholder"${image ? ' hidden' : ''}><span class="cover-placeholder-mark" aria-hidden="true">Buku</span><span>${esc(book.title)}</span></div>`;
    const readableFile = ['full', 'user', 'free-epub', 'free-pdf'].includes(book.accessType) &&
      (book.localFile || Boolean(safeUrl(book.readUrl)));
    const preview = book.previewUrl;
    const externalRead = book.accessType === 'external-full' && book.externalReadUrl;
    const status = PK.statuses()[book.id] || '';
    const savedProgress = PK.store.get(`pk:read:${encodeURIComponent(book.id)}:progress`, null);
    const safeInfo = safeUrl(book.infoUrl);
    const sourceLinks = (book.sourceIds || [])
      .filter(source => safeUrl(source.infoUrl))
      .map(source => actionLink(source.infoUrl, `Buka ${esc(source.source)}`));
    const formats = [...new Set([book.fileType, ...(book.formats || [])].filter(Boolean))];
    const rows = [
      ['Sumber', book.source],
      ['Identitas sumber', (book.sourceIds || []).map(source => `${source.source}: ${source.id}`).join('; ') || book.id],
      ['Penerbit', book.publisher],
      ['Tahun terbit', book.year],
      ['Ditambahkan', book.addedDate],
      ['Jumlah halaman', book.pages],
      ['Harga', ['paid-purchase', 'paid-subscription'].includes(book.accessType) ? displayPrice(book) : ''],
      ['Format', formats.join(', ')],
      ['ISBN', book.isbn],
      ['Bahasa', book.lang],
      ['Kategori', (book.subjects || []).join(', ')],
      ['Hak cipta / lisensi', book.rights]
    ];

    root.innerHTML = `<article class="detail-layout">
      <div class="detail-left"><div class="detail-cover">${image}${placeholder}</div></div>
      <div class="detail-right">
        <h1 class="detail-title">${esc(book.title)}</h1>
        <p class="detail-author">${esc(book.author)}</p>
        <div class="detail-badges">
          <span class="detail-badge detail-badge-accent">${esc(book.access)}</span>
          ${sources.map(source => `<span class="detail-badge">${esc(source)}</span>`).join('')}
        </div>
        <div class="detail-actions">
          ${readableFile ? `<a class="detail-btn detail-btn-primary" href="#/baca/${encodeURIComponent(book.id)}">${savedProgress ? 'Lanjutkan Membaca' : 'Baca Sekarang'}</a>` : ''}
          ${preview ? actionLink(book.previewUrl, 'Buka Pratinjau Resmi', true) : ''}
          ${externalRead ? actionLink(book.externalReadUrl, 'Baca di Sumber Resmi', true) : ''}
          ${book.accessType === 'borrow' ? actionLink(book.infoUrl, 'Pinjam di Sumber Resmi', true) : ''}
          ${book.downloadUrl ? actionLink(book.downloadUrl, `Unduh ${esc(formats.join(', ') || 'Buku')}`) : ''}
          ${book.accessType === 'paid-purchase' ? actionLink(book.buyUrl || book.infoUrl, 'Beli Buku', true) : ''}
          ${sourceLinks.length ? sourceLinks.join('') : safeInfo ? actionLink(book.infoUrl, 'Halaman Sumber') : ''}
          <button class="detail-btn" id="favoriteBook" type="button"></button>
          <button class="detail-btn" id="bookmarkBook" type="button"></button>
          <button class="detail-btn" id="shareBook" type="button">Bagikan</button>
        </div>
        ${!readableFile && !preview && !externalRead ? '<p class="detail-access-note">Teks lengkap tidak tersedia di reader PustakaKita. Periksa halaman sumber untuk mengetahui apakah buku dapat dibaca atau dipinjam di sana.</p>' : ''}
        <label class="library-status-label" for="readingStatus">Status di perpustakaan saya</label>
        <select id="readingStatus" class="reader-select">
          <option value="">Tidak disimpan</option>
          <option value="want">Ingin dibaca</option>
          <option value="reading">Sedang dibaca</option>
          <option value="complete">Selesai dibaca</option>
        </select>
        ${book.desc ? `<section class="detail-section"><h2 class="detail-section-title">Deskripsi</h2><p class="detail-description">${esc(book.desc.slice(0, 1800))}</p></section>` : ''}
        <section class="detail-section"><h2 class="detail-section-title">Informasi Buku</h2>
          <div class="detail-meta">${rows.filter(([, value]) => value).map(([label, value]) =>
            `<div class="detail-meta-row"><span class="detail-meta-label">${esc(label)}</span><span class="detail-meta-value">${esc(value)}</span></div>`
          ).join('')}</div>
        </section>
        <section class="detail-section related-books" id="relatedBooks" hidden>
          <h2 class="detail-section-title">Buku terkait</h2><div class="grid"></div>
        </section>
      </div>
    </article>`;

    const favorite = document.getElementById('favoriteBook');
    const updateFavorite = () => {
      const isFavorite = Boolean(PK.favs()[book.id]);
      favorite.textContent = isFavorite ? 'Hapus dari Favorit' : 'Tambah ke Favorit';
      favorite.setAttribute('aria-pressed', String(isFavorite));
    };
    updateFavorite();
    favorite.addEventListener('click', () => {
      PK.toggleFav(book);
      updateFavorite();
    });

    const bookmark = document.getElementById('bookmarkBook');
    const updateBookmark = () => {
      const saved = Boolean(PK.savedBooks()[book.id]);
      bookmark.textContent = saved ? 'Hapus Bookmark' : 'Tambah ke Bookmark';
      bookmark.setAttribute('aria-pressed', String(saved));
    };
    updateBookmark();
    bookmark.addEventListener('click', () => {
      PK.toggleBookmark(book);
      updateBookmark();
    });

    const statusSelect = document.getElementById('readingStatus');
    statusSelect.value = status;
    statusSelect.addEventListener('change', () => {
      PK.setReadingStatus(book, statusSelect.value);
      PK.toast(statusSelect.value ? 'Status perpustakaan diperbarui' : 'Buku dihapus dari perpustakaan');
    });

    document.getElementById('shareBook').addEventListener('click', async () => {
      try {
        if (navigator.share) await navigator.share({ title: book.title, url: location.href });
        else if (navigator.clipboard) {
          await navigator.clipboard.writeText(location.href);
          PK.toast('Tautan disalin');
        } else {
          PK.toast('Fitur berbagi tidak tersedia di browser ini');
        }
      } catch (error) {
        if (error.name !== 'AbortError') {
          console.error('Tautan buku gagal dibagikan.', error);
          PK.toast('Tautan gagal dibagikan');
        }
      }
    });

    loadRelated(book);
  }

  async function loadRelated(book) {
    const section = document.getElementById('relatedBooks');
    const grid = section?.querySelector('.grid');
    if (!grid || !book.author || book.author === 'Penulis tidak diketahui') return;
    try {
      const response = await API.search({ q: book.author });
      const related = response.books.filter(item => item.id !== book.id).slice(0, 5);
      if (!related.length) return;
      grid.innerHTML = related.map(PK.card).join('');
      section.hidden = false;
    } catch (error) {
      console.error('Buku terkait gagal dimuat.', error);
    }
  }

  PK.views.detail = (_, id) => {
    const book = id && PK.find(id);
    if (!book) {
      root.innerHTML = '<div class="detail-state"><p>Data buku ini tidak ditemukan.</p><a class="detail-btn" href="#/cari">Cari buku</a></div>';
      return;
    }
    PK.addHist(book);
    document.title = `${book.title} – PustakaKita`;
    renderBook(book);
  };
})();
