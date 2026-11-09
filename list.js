(() => {
  const $ = id => document.getElementById(id);
  function make(grid, state, clear, key, isFav, emptyTitle, emptyDesc) {
    const render = () => {
      const l = isFav ? Object.values(PK.favs ? PK.favs() : {}) : (PK.hist ? PK.hist() : []);
      const gridEl = $(grid);
      if (gridEl) gridEl.innerHTML = l.map(PK.card).join('');
      const clearEl = $(clear);
      if (clearEl) clearEl.hidden = !l.length;
      const countEl = document.getElementById(isFav ? 'favCount' : null);
      if (countEl && isFav) countEl.textContent = l.length ? `${l.length} buku` : '';
      const stateEl = $(state);
      if (stateEl) {
        if (l.length) {
          stateEl.innerHTML = '';
        } else {
          stateEl.innerHTML = `<div class="list-empty"><div class="list-empty-icon">
            <svg width="64" height="64" viewBox="0 0 64 64" fill="none"><circle cx="32" cy="32" r="28" stroke="#EAE8E3" stroke-width="2"/><path d="M32 20L35.09 28.26L44 29.27L37.5 35.14L39.18 44L32 39.27L24.82 44L26.5 35.14L20 29.27L28.91 28.26L32 20Z" stroke="#C5A46D" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
          </div><p class="list-empty-title">${emptyTitle}</p><p class="list-empty-desc">${emptyDesc}</p><a class="detail-btn detail-btn-primary" href="#/cari">Jelajahi Buku</a></div>`;
        }
      }
      setTimeout(() => {
        document.querySelectorAll('#' + grid + ' .card-fav').forEach(btn => {
          const favId = btn.dataset.fav;
          if (PK.favs) {
            const f = PK.favs();
            if (f[favId]) btn.classList.add('active');
          }
        });
      }, 50);
    };
    const clearEl = $(clear);
    if (clearEl) {
      clearEl.onclick = () => { if (confirm('Hapus semua data di halaman ini?')) { if (PK.store) PK.store.set(key, isFav ? {} : []); render(); } };
    }
    return render;
  }
  PK.views.favorites = make('favGrid', 'favState', 'clearFav', 'pk:fav', true, 'Belum ada buku favorit', 'Mulai tambahkan buku ke favorit untuk mengumpulkannya di sini.');
  PK.views.history = make('histGrid', 'histState', 'clearHist', 'pk:hist', false, 'Belum ada riwayat buku', 'Buku yang kamu kunjungi akan muncul di sini.');
})();