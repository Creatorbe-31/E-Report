(() => {
  let book = null;
  let pdf = null;
  let rendition = null;
  let localUrl = '';
  let localFile = null;
  let page = 1;
  let zoom = 1;
  let textMode = false;
  let wikiNextUrl = '';
  let wikiPreviousUrl = '';
  let textScrollListener = null;
  let textProgressTimer = 0;
  let loadGeneration = 0;
  let renderGeneration = 0;
  let resizeTimer = 0;
  let lastRenderWidth = 0;
  let lastActivityAt = 0;

  const $ = id => document.getElementById(id);
  const progressKey = id => `pk:read:${encodeURIComponent(id)}:progress`;
  const bookmarksKey = id => `pk:read:${encodeURIComponent(id)}:bookmarks`;
  const progress = id => PK.store.get(progressKey(id), {});
  const bookmarks = id => PK.store.get(bookmarksKey(id), []);

  function showMessage(message) {
    const viewport = $('readerViewport');
    if (!viewport) return;
    viewport.replaceChildren(Object.assign(document.createElement('p'), {
      className: 'reader-message',
      textContent: message
    }));
  }

  function saveProgress(data) {
    if (!book) return;
    PK.store.set(progressKey(book.id), { ...data, updatedAt: Date.now() });
    PK.store.set(`pk:b:${book.id}`, book);
    if (Number(data.percent) >= 100 && PK.statuses()[book.id] !== 'complete') {
      PK.setReadingStatus(book, 'complete');
    }
  }

  function checkpointReadingTime(force) {
    if (!book || !lastActivityAt) return;
    const now = Date.now();
    const active = document.body.dataset.view === 'reader' && !document.hidden;
    if (force || active) {
      const seconds = Math.min(30, Math.floor((now - lastActivityAt) / 1000));
      if (seconds > 0) {
        const savedTotals = PK.store.get('pk:reading-time', {});
        const totals = savedTotals && typeof savedTotals === 'object' && !Array.isArray(savedTotals)
          ? savedTotals
          : {};
        totals[book.id] = (Number(totals[book.id]) || 0) + seconds;
        PK.store.set('pk:reading-time', totals);
      }
    }
    lastActivityAt = active ? now : 0;
  }

  function saveNote() {
    if (!book) return;
    let quote = window.getSelection()?.toString().trim() || '';
    if (!quote && rendition) {
      quote = rendition.getContents()
        .map(contents => contents.window?.getSelection()?.toString().trim() || '')
        .find(Boolean) || '';
    }
    const text = window.prompt('Tulis catatan untuk buku ini:', '');
    if (text === null || (!text.trim() && !quote)) return;
    const location = rendition?.currentLocation()?.start?.cfi ||
      (textMode ? $('readerViewport')?.scrollTop : page);
    const notes = PK.store.get('pk:notes', []);
    const savedNotes = Array.isArray(notes) ? notes : [];
    savedNotes.unshift({
      id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      bookId: book.id,
      bookTitle: book.title,
      quote,
      text: text.trim(),
      position: location,
      createdAt: Date.now()
    });
    PK.store.set('pk:notes', savedNotes);
    PK.toast('Catatan disimpan di Perpustakaan Saya');
  }

  function updatePdfControls() {
    const previous = $('readerPrev');
    const next = $('readerNext');
    const info = $('readerPageInfo');
    if (previous) previous.disabled = !pdf || page <= 1;
    if (next) next.disabled = !pdf || page >= pdf.numPages;
    if (info && pdf) info.textContent = `Halaman ${page} / ${pdf.numPages}`;
    const zoomLabel = $('readerZoomLevel');
    if (zoomLabel) zoomLabel.textContent = `${Math.round(zoom * 100)}%`;
  }

  function applyEpubSettings() {
    if (!rendition || !book) return;
    const container = $('readerContainer');
    const theme = container.dataset.readerTheme || 'light';
    const colors = theme === 'dark'
      ? { color: '#f3f4f6', background: '#111827' }
      : theme === 'sepia'
        ? { color: '#433522', background: '#f4ecd8' }
        : { color: '#202735', background: '#ffffff' };
    rendition.themes.default({
      body: {
        'font-family': container.dataset.readerFont || 'Georgia',
        'font-size': `${container.dataset.readerFontSize || 16}px`,
        'line-height': container.dataset.readerLineHeight || '1.7',
        ...colors
      }
    });
  }

  function wikiPageUrl(href, currentUrl) {
    if (!href) return '';
    try {
      const current = new URL(currentUrl);
      const page = new URL(href, current.origin);
      if (page.origin !== current.origin || !page.pathname.startsWith('/wiki/')) return '';
      const title = decodeURIComponent(page.pathname.slice('/wiki/'.length)).replace(/_/g, ' ');
      const params = new URLSearchParams({
        action: 'parse',
        page: title,
        prop: 'text',
        format: 'json',
        origin: '*'
      });
      return `${current.origin}/w/api.php?${params}`;
    } catch {
      return '';
    }
  }

  function sanitizeHtml(html) {
    const parsed = new DOMParser().parseFromString(html, 'text/html');
    const source = parsed.querySelector('.mw-parser-output, article, main') || parsed.body;
    const allowed = new Set([
      'div', 'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'br', 'hr',
      'ul', 'ol', 'li', 'blockquote', 'pre', 'code', 'em', 'strong',
      'i', 'b', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'a'
    ]);
    const copy = node => {
      if (node.nodeType === Node.TEXT_NODE) return document.createTextNode(node.textContent || '');
      if (node.nodeType !== Node.ELEMENT_NODE) return document.createDocumentFragment();
      const tag = node.tagName.toLowerCase();
      if (['script', 'style', 'template', 'iframe', 'object', 'form'].includes(tag)) {
        return document.createDocumentFragment();
      }
      if (!allowed.has(tag)) {
        const fragment = document.createDocumentFragment();
        [...node.childNodes].forEach(child => fragment.append(copy(child)));
        return fragment;
      }
      const element = document.createElement(tag);
      if (tag === 'a') {
        try {
          const href = new URL(node.getAttribute('href') || '', location.href);
          if (href.protocol === 'https:') {
            element.href = href.href;
            element.target = '_blank';
            element.rel = 'noopener noreferrer';
          }
        } catch { /* Discard unsafe or malformed links. */ }
      }
      [...node.childNodes].forEach(child => element.append(copy(child)));
      return element;
    };
    const fragment = document.createDocumentFragment();
    [...source.childNodes].forEach(child => fragment.append(copy(child)));
    return fragment;
  }

  async function renderPdf() {
    if (!pdf) return;
    const viewport = $('readerViewport');
    if (!viewport) return;

    const renderId = ++renderGeneration;
    try {
      lastRenderWidth = viewport.clientWidth;
      const currentPage = await pdf.getPage(page);
      if (renderId !== renderGeneration || !pdf) return;
      const base = currentPage.getViewport({ scale: 1 });
      const scale = Math.max(0.5, Math.min(3, (Math.max(1, viewport.clientWidth) / base.width) * zoom));
      const pageViewport = currentPage.getViewport({ scale });
      const canvas = document.createElement('canvas');
      const context = canvas.getContext('2d');
      if (!context) throw new Error('Canvas tidak tersedia.');
      canvas.width = Math.ceil(pageViewport.width);
      canvas.height = Math.ceil(pageViewport.height);
      viewport.replaceChildren(canvas);
      await currentPage.render({ canvasContext: context, viewport: pageViewport }).promise;
      if (renderId !== renderGeneration || !pdf) return;
      saveProgress({ page, percent: Math.round(page / pdf.numPages * 100) });
      updatePdfControls();
    } catch (error) {
      if (renderId !== renderGeneration) return;
      console.error('Halaman PDF gagal dirender.', error);
      showMessage('Halaman PDF gagal ditampilkan.');
    }
  }

  async function renderText(url, params, generation) {
    const isWikisource = book?.fileType === 'wikisource';
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20000);
    let response;
    try {
      response = await fetch(url, {
        signal: controller.signal,
        headers: {
          Accept: isWikisource ? 'application/json' : book?.fileType === 'html' ? 'text/html' : 'text/plain'
        }
      });
    } finally {
      clearTimeout(timeout);
    }
    if (!response.ok) throw new Error(`Teks buku gagal dimuat (${response.status}).`);
    let text;
    let htmlContent = null;
    if (isWikisource) {
      const data = await response.json();
      const html = data.parse?.text?.['*'];
      if (!html) throw new Error('Teks lengkap tidak tersedia dari Wikisource.');
      const parsed = new DOMParser().parseFromString(html, 'text/html');
      const content = parsed.querySelector('.mw-parser-output') || parsed.body;
      const nextLink = parsed.querySelector('#headernext a, .wst-header-forward-link a, .ws-header-forward-link a, .ws-header-forward a');
      const previousLink = parsed.querySelector('#headerprevious a, #headerprev a, .wst-header-back-link a, .ws-header-back-link a, .ws-header-back a');
      wikiNextUrl = wikiPageUrl(nextLink?.getAttribute('href'), url);
      wikiPreviousUrl = wikiPageUrl(previousLink?.getAttribute('href'), url);
      content.querySelectorAll('script,style,template,nav,.ws-noexport,.noprint,.mw-editsection,.reference,.mw-references-wrap')
        .forEach(element => element.remove());
      text = [...content.querySelectorAll('h1,h2,h3,h4,p,li,blockquote,pre')]
        .filter(element => !element.parentElement.closest('li,blockquote,pre'))
        .map(element => element.textContent.replace(/\s+/g, ' ').trim())
        .filter(Boolean)
        .join('\n\n');
      if (!text) text = content.textContent.replace(/\s+/g, ' ').trim();
      if (text.replace(/[^\p{L}\p{N}]/gu, '').length < 20) {
        throw new Error('Teks bacaan tidak tersedia dari halaman ini.');
      }
      $('readerPrev').disabled = !wikiPreviousUrl;
      $('readerNext').disabled = !wikiNextUrl;
    } else if (book?.fileType === 'html') {
      const html = await response.text();
      const parsed = new DOMParser().parseFromString(html, 'text/html');
      text = (parsed.querySelector('article, main, body') || parsed.body).textContent || '';
      if (text.replace(/[^\p{L}\p{N}]/gu, '').length < 20) {
        throw new Error('Teks HTML tidak tersedia atau terlalu pendek untuk dibaca.');
      }
      htmlContent = sanitizeHtml(html);
    } else {
      text = await response.text();
      if (text.replace(/[^\p{L}\p{N}]/gu, '').length < 20) {
        throw new Error('Teks buku tidak tersedia atau terlalu pendek untuk dibaca.');
      }
    }
    if (generation !== loadGeneration) return;

    const viewport = $('readerViewport');
    const content = document.createElement(htmlContent ? 'div' : 'pre');
    content.className = 'reader-text';
    if (htmlContent) content.append(htmlContent);
    else content.textContent = text.replace(/^\uFEFF/, '');
    viewport.replaceChildren(content);
    textMode = true;

    const updateProgress = () => {
      clearTimeout(textProgressTimer);
      textProgressTimer = setTimeout(() => {
        if (!book || !textMode) return;
        const range = Math.max(1, viewport.scrollHeight - viewport.clientHeight);
        const percent = Math.min(100, Math.round(viewport.scrollTop / range * 100));
        saveProgress({ page: 1, percent, scrollTop: viewport.scrollTop });
        const info = $('readerPageInfo');
        if (info) info.textContent = `Teks penuh · ${percent}%`;
      }, 120);
    };
    if (textScrollListener) viewport.removeEventListener('scroll', textScrollListener);
    textScrollListener = updateProgress;
    viewport.addEventListener('scroll', textScrollListener, { passive: true });

    const saved = progress(book.id);
    viewport.scrollTop = Number(params.get('bookmark')) || Number(saved.scrollTop) || 0;
    const info = $('readerPageInfo');
    if (info) info.textContent = `Teks penuh · ${Number(saved.percent) || 0}%`;
    updateProgress();
  }

  function renderToc(entries) {
    const list = $('readerTocList');
    if (!list) return;
    list.replaceChildren();
    list.classList.remove('reader-message');
    const addEntries = items => items.forEach(item => {
      const button = document.createElement('button');
      button.className = 'reader-toc-link';
      button.type = 'button';
      button.textContent = item.label || 'Bagian tanpa judul';
      button.addEventListener('click', () => {
        if (rendition) rendition.display(item.href);
        $('readerTocPanel').classList.remove('active');
      });
      list.append(button);
      if (item.subitems) addEntries(item.subitems);
    });
    addEntries(entries);
    if (!entries.length) {
      list.textContent = 'Daftar isi tidak tersedia untuk buku ini.';
      list.classList.add('reader-message');
    }
  }

  function setupSettings() {
    const container = $('readerContainer');
    if (!container) return;
    const settings = PK.store.get('pk:reader:settings', {});
    if (settings.theme) container.dataset.readerTheme = settings.theme;
    if (settings.width) container.dataset.readerWidth = settings.width;
    container.dataset.readerFont = settings.font || 'Georgia';
    container.dataset.readerFontSize = String(settings.fontSize || 16);
    container.dataset.readerLineHeight = String(settings.lineHeight || '1.7');

    const persist = () => PK.store.set('pk:reader:settings', {
      theme: container.dataset.readerTheme || 'light',
      width: container.dataset.readerWidth || 'normal',
      font: container.dataset.readerFont,
      fontSize: Number(container.dataset.readerFontSize) || 16,
      lineHeight: container.dataset.readerLineHeight || '1.7'
    });

    document.querySelectorAll('.reader-theme-btn').forEach(button => {
      button.addEventListener('click', () => {
        container.dataset.readerTheme = button.dataset.theme;
        document.querySelectorAll('.reader-theme-btn').forEach(item => item.classList.toggle('active', item === button));
        persist();
        applyEpubSettings();
      });
    });
    const font = $('readerFontFamily');
    if (font) font.addEventListener('change', () => {
      container.dataset.readerFont = font.value;
      persist();
      applyEpubSettings();
    });
    const width = $('readerWidth');
    if (width) width.addEventListener('change', () => {
      container.dataset.readerWidth = width.value;
      persist();
    });
    const lineHeight = $('readerLineHeight');
    if (lineHeight) lineHeight.addEventListener('input', () => {
      container.dataset.readerLineHeight = lineHeight.value;
      const label = $('readerLineHeightVal');
      if (label) label.textContent = lineHeight.value;
      persist();
      applyEpubSettings();
    });
    const fontSize = $('readerFontSizeVal');
    const updateFontSize = amount => {
      const current = Number(container.dataset.readerFontSize) || 16;
      const next = Math.max(12, Math.min(32, current + amount));
      container.dataset.readerFontSize = String(next);
      if (fontSize) fontSize.textContent = `${next}px`;
      persist();
      applyEpubSettings();
    };
    $('readerFontSmaller')?.addEventListener('click', () => updateFontSize(-1));
    $('readerFontLarger')?.addEventListener('click', () => updateFontSize(1));
    $('readerHideToolbar')?.addEventListener('change', event => {
      const toolbar = $('readerToolbar');
      if (toolbar) toolbar.hidden = event.target.checked;
    });

    const themeButton = document.querySelector(`.reader-theme-btn[data-theme="${container.dataset.readerTheme || 'light'}"]`);
    if (themeButton) {
      document.querySelectorAll('.reader-theme-btn').forEach(item => item.classList.toggle('active', item === themeButton));
    }

    if (font && settings.font) font.value = settings.font;
    if (width && settings.width) width.value = settings.width;
    if (lineHeight && settings.lineHeight) {
      lineHeight.value = settings.lineHeight;
      const label = $('readerLineHeightVal');
      if (label) label.textContent = settings.lineHeight;
    }
    if (fontSize) fontSize.textContent = `${settings.fontSize || 16}px`;
  }

  function setupControls() {
    $('readerBack')?.addEventListener('click', () => {
      location.hash = book ? `#/buku/${encodeURIComponent(book.id)}` : '#/';
    });
    $('readerPrev')?.addEventListener('click', () => {
      if (pdf && page > 1) { page -= 1; renderPdf(); }
      else if (rendition) rendition.prev();
      else if (textMode && wikiPreviousUrl) navigateWikisource(wikiPreviousUrl);
    });
    $('readerNext')?.addEventListener('click', () => {
      if (pdf && page < pdf.numPages) { page += 1; renderPdf(); }
      else if (rendition) rendition.next();
      else if (textMode && wikiNextUrl) navigateWikisource(wikiNextUrl);
    });
    $('readerZoomOut')?.addEventListener('click', () => {
      zoom = Math.max(0.5, zoom - 0.1);
      renderPdf();
    });
    $('readerZoomIn')?.addEventListener('click', () => {
      zoom = Math.min(2, zoom + 0.1);
      renderPdf();
    });
    $('readerSettingsBtn')?.addEventListener('click', () => $('readerSettingsPanel').classList.toggle('active'));
    $('readerSettingsClose')?.addEventListener('click', () => $('readerSettingsPanel').classList.remove('active'));
    $('readerTocBtn')?.addEventListener('click', () => $('readerTocPanel').classList.toggle('active'));
    $('readerTocClose')?.addEventListener('click', () => $('readerTocPanel').classList.remove('active'));
    $('readerFullscreenBtn')?.addEventListener('click', async () => {
      try {
        if (document.fullscreenElement) await document.exitFullscreen();
        else await $('readerContainer').requestFullscreen();
      } catch (error) {
        console.error('Mode layar penuh tidak tersedia.', error);
        PK.toast('Mode layar penuh tidak tersedia');
      }
    });
    $('readerModeSingle')?.addEventListener('click', () => {
      rendition?.spread('none');
      $('readerModeSingle').classList.add('active');
      $('readerModeSpread').classList.remove('active');
    });
    $('readerModeSpread')?.addEventListener('click', () => {
      rendition?.spread('always');
      $('readerModeSpread').classList.add('active');
      $('readerModeSingle').classList.remove('active');
    });
    $('readerBookmarkBtn')?.addEventListener('click', () => {
      if (!book) return;
      const position = rendition?.currentLocation()?.start?.cfi ||
        (textMode ? $('readerViewport').scrollTop : page);
      const saved = bookmarks(book.id);
      if (saved.some(item => item.position === position)) {
        PK.toast('Bookmark ini sudah tersimpan');
        return;
      }
      PK.store.set(bookmarksKey(book.id), [...saved, { position, page }]);
      PK.toast('Bookmark disimpan');
    });
    $('readerNoteBtn')?.addEventListener('click', saveNote);
    document.addEventListener('keydown', event => {
      if (document.body.dataset.view !== 'reader' ||
          event.target.closest('input, textarea, select, [contenteditable="true"]')) return;
      if (event.key === 'ArrowRight' || event.key === 'PageDown') {
        event.preventDefault();
        $('readerNext')?.click();
      } else if (event.key === 'ArrowLeft' || event.key === 'PageUp') {
        event.preventDefault();
        $('readerPrev')?.click();
      } else if (event.key === 'Escape') {
        $('readerTocPanel')?.classList.remove('active');
        $('readerSettingsPanel')?.classList.remove('active');
      }
    });
  }

  async function navigateWikisource(url) {
    const generation = ++loadGeneration;
    $('readerPrev').disabled = true;
    $('readerNext').disabled = true;
    showMessage('Memuat halaman berikutnya…');
    try {
      await renderText(url, new URLSearchParams(), generation);
    } catch (error) {
      if (generation !== loadGeneration) return;
      console.error('Halaman Wikisource gagal dimuat.', error);
      showMessage('Halaman berikutnya gagal dimuat. Periksa koneksi atau buka halaman sumber.');
    }
  }

  setupControls();
  setupSettings();
  setInterval(() => checkpointReadingTime(false), 15000);
  addEventListener('hashchange', () => checkpointReadingTime(true));
  addEventListener('pagehide', () => checkpointReadingTime(true));
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) checkpointReadingTime(true);
    else if (book && document.body.dataset.view === 'reader') lastActivityAt = Date.now();
  });

  addEventListener('resize', () => {
    const viewport = $('readerViewport');
    if (!pdf || !viewport || viewport.clientWidth === lastRenderWidth) return;
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      if (pdf && viewport.clientWidth !== lastRenderWidth) renderPdf();
    }, 120);
  });

  PK.views.reader = async (params, id) => {
    const generation = ++loadGeneration;
    const previousPdf = pdf;
    const previousRendition = rendition;
    pdf = null;
    rendition = null;
    renderGeneration += 1;
    if (previousRendition) previousRendition.destroy();
    if (previousPdf) await previousPdf.destroy();
    if (generation !== loadGeneration) return;
    if (localUrl) URL.revokeObjectURL(localUrl);
    localUrl = '';
    localFile = null;
    book = id ? PK.find(id) : null;
    page = 1;
    zoom = 1;
    textMode = false;
    wikiNextUrl = '';
    wikiPreviousUrl = '';
    if (textScrollListener) {
      $('readerViewport')?.removeEventListener('scroll', textScrollListener);
      textScrollListener = null;
    }
    clearTimeout(textProgressTimer);
    const title = $('readerBookTitle');
    if (title) title.textContent = book ? book.title : 'Membaca Buku';
    const sourceNote = $('readerSourceNote');
    if (sourceNote) {
      sourceNote.replaceChildren();
      sourceNote.hidden = true;
      if (book?.sources?.length || book?.rights) {
        const link = book.infoUrl ? document.createElement('a') : null;
        if (link) {
          link.href = book.infoUrl;
          link.target = '_blank';
          link.rel = 'noopener noreferrer';
          link.textContent = book.sources?.join(', ') || 'sumber asli';
        }
        sourceNote.append(
          'Sumber dan hak cipta: ',
          book.rights || 'Periksa lisensi pada halaman sumber.',
          link ? ' ' : '',
          ...(link ? [link] : [])
        );
        sourceNote.hidden = false;
      }
    }
    const pageInfo = $('readerPageInfo');
    if (pageInfo) pageInfo.textContent = 'Halaman - / -';
    $('readerTocPanel')?.classList.remove('active');
    $('readerSettingsPanel')?.classList.remove('active');
    renderToc([]);
    const viewport = $('readerViewport');
    if (!viewport) return;
    viewport.replaceChildren();
    if (!book) {
      location.hash = '#/';
      return;
    }
    let url = book.readUrl || '';
    let extension = book.fileType || '';
    if (book.localFile && typeof PK.getUploadedFile === 'function') {
      try {
        const file = await PK.getUploadedFile(book.id);
        if (generation !== loadGeneration) return;
        if (!file) throw new Error('Berkas lokal tidak ditemukan.');
        localFile = file;
        extension = file.name.toLowerCase().split('.').pop();
        localUrl = URL.createObjectURL(file);
        url = localUrl;
      } catch (error) {
        console.error('Berkas buku milik pengguna gagal dibuka.', error);
        showMessage('File buku tidak ditemukan. Periksa kembali koleksi unggahan Anda.');
        return;
      }
    }
    if (!url) {
      showMessage('Tidak ada tautan baca untuk buku ini.');
      return;
    }
    lastActivityAt = Date.now();
    PK.addHist(book);
    if (!['reading', 'complete'].includes(PK.statuses()[book.id])) {
      PK.setReadingStatus(book, 'reading');
    }
    $('readerPrev').disabled = true;
    $('readerNext').disabled = true;

    let pathname;
    try { pathname = new URL(url, location.href).pathname.toLowerCase(); }
    catch {
      showMessage('Tautan baca buku ini tidak valid.');
      return;
    }

    if ((extension === 'pdf' || pathname.endsWith('.pdf')) && typeof pdfjsLib !== 'undefined') {
      try {
        const loadedPdf = await pdfjsLib.getDocument(url).promise;
        if (generation !== loadGeneration) {
          await loadedPdf.destroy();
          return;
        }
        pdf = loadedPdf;
        const bookmarkPage = Number(params.get('bookmark')) || 0;
        page = Math.max(1, Math.min(pdf.numPages, bookmarkPage || Number(progress(book.id).page) || 1));
        lastRenderWidth = viewport.clientWidth;
        await renderPdf();
      } catch (error) {
        if (generation !== loadGeneration) return;
        console.error('PDF gagal dimuat.', error);
        showMessage('PDF gagal dimuat. Buka halaman sumber untuk membaca buku ini.');
      }
    } else if ((extension === 'epub' || pathname.endsWith('.epub')) && typeof ePub === 'function') {
      try {
        const epubSource = localFile ? await localFile.arrayBuffer() : url;
        if (generation !== loadGeneration) return;
        const epubBook = ePub(epubSource, { openAs: 'epub' });
        rendition = epubBook.renderTo(viewport, { width: '100%', height: '70vh' });
        applyEpubSettings();
        rendition.on('relocated', location => {
          const percentage = Math.ceil((location.start.percentage || 0) * 100);
          saveProgress({ page: Math.max(1, percentage), percent: percentage, cfi: location.start.cfi });
          const info = $('readerPageInfo');
          if (info) info.textContent = `${percentage}%`;
        });
        const saved = progress(book.id);
        await rendition.display(params.get('bookmark') || saved.cfi);
        if (generation !== loadGeneration) return;
        $('readerPrev').disabled = false;
        $('readerNext').disabled = false;
        const navigation = await epubBook.loaded.navigation;
        renderToc(navigation.toc || []);
      } catch (error) {
        if (generation !== loadGeneration) return;
        console.error('EPUB gagal dimuat.', error);
        showMessage('EPUB gagal dimuat. Buka halaman sumber untuk membaca buku ini.');
      }
    } else if (
      extension === 'wikisource' || extension === 'txt' || extension === 'text' ||
      extension === 'html' || pathname.endsWith('.txt') || pathname.endsWith('.html') || pathname.endsWith('.htm')
    ) {
      try {
        await renderText(url, params, generation);
      } catch (error) {
        if (generation !== loadGeneration) return;
        console.error('Teks buku gagal dimuat.', error);
        showMessage('Teks buku gagal dimuat. Periksa koneksi atau buka halaman sumber resmi.');
      }
    } else {
      showMessage('Format ini tidak didukung. Reader menerima file PDF atau EPUB.');
    }
  };
})();
