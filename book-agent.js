const BookAgent = (() => {
  const TTL = 6 * 60 * 60 * 1000;
  const memory = new Map();
  const normalize = value => String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
  const safeUrl = value => {
    try {
      const url = new URL(value);
      return url.protocol === 'https:' ? url.href : '';
    } catch {
      return '';
    }
  };
  const safeGoogleImage = value => {
    try {
      const url = new URL(value);
      if (url.protocol === 'http:' &&
          ['books.google.com', 'books.googleusercontent.com'].includes(url.hostname)) {
        url.protocol = 'https:';
      }
      return safeUrl(url.href);
    } catch {
      return '';
    }
  };
  const cleanText = value => String(value || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
  const gutenbergLanguages = {
    ara: 'ar', dan: 'da', deu: 'de', eng: 'en', spa: 'es', fin: 'fi', fre: 'fr',
    fra: 'fr', ita: 'it', jpn: 'ja', nld: 'nl', nor: 'no', pol: 'pl', por: 'pt',
    rus: 'ru', swe: 'sv', tur: 'tr', zho: 'zh', ind: 'id'
  };

  function cached(key) {
    const value = memory.get(key);
    if (value && Date.now() - value.time < TTL) return value.data;
    try {
      const saved = JSON.parse(localStorage.getItem(`pk:catalog:v9:${key}`));
      if (saved && Date.now() - saved.time < TTL) {
        memory.set(key, saved);
        return saved.data;
      }
    } catch (error) {
      console.warn('Cache katalog lokal tidak dapat dibaca.', error);
    }
    return null;
  }

  function save(key, data) {
    const value = { time: Date.now(), data };
    memory.set(key, value);
    try {
      localStorage.setItem(`pk:catalog:v9:${key}`, JSON.stringify(value));
    } catch (error) {
      console.warn('Cache katalog lokal tidak dapat disimpan.', error);
    }
    return data;
  }

  async function fetchResponse(url, accept = 'application/json', signal) {
    let lastError;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      if (signal?.aborted) throw new DOMException('Request dibatalkan.', 'AbortError');
      const controller = new AbortController();
      const abort = () => controller.abort();
      signal?.addEventListener('abort', abort, { once: true });
      const timeout = setTimeout(() => controller.abort(), 12000);
      try {
        const response = await fetch(url, {
          signal: controller.signal,
          headers: { Accept: accept }
        });
        if (response.status === 429 || response.status >= 500) {
          if (attempt === 0) {
            await new Promise(resolve => setTimeout(resolve, 600));
            continue;
          }
        }
        if (!response.ok) throw new Error(`Sumber buku merespons ${response.status}.`);
        return response;
      } catch (error) {
        lastError = error;
        if (signal?.aborted || attempt === 1 ||
            (error.name !== 'AbortError' && error.name !== 'TypeError')) throw error;
        await new Promise(resolve => setTimeout(resolve, 400));
      } finally {
        clearTimeout(timeout);
        signal?.removeEventListener('abort', abort);
      }
    }
    throw lastError || new Error('Sumber buku tidak dapat dijangkau.');
  }

  function wikisourceUrl(lang, title) {
    const endpoint = `https://${lang}.wikisource.org/w/api.php`;
    const params = new URLSearchParams({
      action: 'parse',
      page: title,
      prop: 'text',
      format: 'json',
      origin: '*'
    });
    return `${endpoint}?${params}`;
  }

  async function wikisource(query, lang, page, random = false, signal) {
    const key = `wiki:${lang}:${normalize(query)}:${page}:${random}`;
    const hit = cached(key);
    if (hit) return hit;
    const endpoint = `https://${lang}.wikisource.org/w/api.php`;
    const params = new URLSearchParams({
      action: 'query',
      format: 'json',
      origin: '*',
      generator: random ? 'random' : 'search',
      ...(random
        ? { grnnamespace: '0', grnlimit: '12' }
        : {
            gsrsearch: query,
            gsrnamespace: '0',
            gsrlimit: '12',
            gsroffset: String((page - 1) * 12)
          }),
      prop: 'extracts|pageimages|info',
      exintro: '1',
      explaintext: '1',
      exchars: '700',
      piprop: 'thumbnail',
      pithumbsize: '320',
      inprop: 'url'
    });
    const data = await (await fetchResponse(`${endpoint}?${params}`, 'application/json', signal)).json();
    const pages = Object.values(data.query?.pages || {})
      .sort((a, b) => (a.index || 0) - (b.index || 0));
    const books = pages.filter(item =>
      item.title && cleanText(item.extract).replace(/[^\p{L}\p{N}]/gu, '').length >= 30
    ).map(item => {
      const title = item.title.replace(/_/g, ' ');
      const pageUrl = safeUrl(item.fullurl) ||
        `https://${lang}.wikisource.org/wiki/${encodeURIComponent(title.replace(/ /g, '_'))}`;
      let pageTitle = new URL(pageUrl).pathname.slice('/wiki/'.length);
      try { pageTitle = decodeURIComponent(pageTitle); } catch { /* Keep the source path intact. */ }
      pageTitle = pageTitle.replace(/_/g, ' ');
      return {
        id: `wikisource:${lang}:${pageTitle}`,
        source: 'Wikisource',
        title,
        author: '',
        description: cleanText(item.extract),
        cover: safeUrl(item.thumbnail?.source),
        language: lang,
        categories: [],
        accessType: 'full',
        readFormat: 'wikisource',
        readUrl: wikisourceUrl(lang, pageTitle),
        infoLink: pageUrl,
        rights: 'Lisensi tercantum pada halaman karya; status hak cipta dapat berbeda menurut negara.'
      };
    });
    return save(key, { books, hasNext: Boolean(data.continue) });
  }

  async function gutenberg(query, lang, page, signal) {
    const key = `gutenberg:${normalize(query)}:${lang}:${page}`;
    const hit = cached(key);
    if (hit) return hit;
    const params = new URLSearchParams({ page: String(page), sort: 'popular' });
    if (query) params.set('search', query);
    const gutenbergLanguage = /^[a-z]{2}$/i.test(lang)
      ? lang.toLowerCase()
      : gutenbergLanguages[lang] || '';
    if (gutenbergLanguage) params.set('languages', gutenbergLanguage);
    const data = await (await fetchResponse(`https://gutendex.com/books/?${params}`, 'application/json', signal)).json();
    const books = (data.results || []).filter(item =>
      item.title && item.copyright === false
    ).map(item => {
      const formats = item.formats || {};
      const pdfEntry = Object.entries(formats).find(([type, url]) =>
        /^application\/pdf\b/i.test(type) && safeUrl(url)
      );
      const textEntry = Object.entries(formats).find(([type, url]) =>
        /^text\/plain\b/i.test(type) && safeUrl(url)
      );
      const epubEntry = Object.entries(formats).find(([type, url]) =>
        /application\/epub\+zip/i.test(type) && safeUrl(url)
      );
      const selected = epubEntry || pdfEntry || textEntry;
      if (!selected) return null;
      const [, downloadUrl] = selected;
      const infoLink = `https://www.gutenberg.org/ebooks/${item.id}`;
      return {
        id: `gutenberg:${item.id}`,
        source: 'Project Gutenberg',
        title: item.title,
        authors: (item.authors || []).map(author => author.name).filter(Boolean),
        description: '',
        cover: safeUrl(formats['image/jpeg']),
        language: (item.languages || [])[0] || '',
        year: null,
        categories: item.subjects || [],
        accessType: epubEntry ? 'free-epub' : pdfEntry ? 'free-pdf' : 'full',
        readFormat: epubEntry ? 'epub' : pdfEntry ? 'pdf' : 'txt',
        readUrl: downloadUrl,
        downloadUrl,
        formats: Object.keys(formats).filter(type => /epub|pdf/i.test(type)),
        externalReadUrl: infoLink,
        infoLink,
        rights: 'Domain publik di Amerika Serikat menurut Gutendex; periksa aturan hak cipta di negara Anda.',
        publisher: 'Project Gutenberg'
      };
    }).filter(Boolean);
    return save(key, { books, hasNext: Boolean(data.next) });
  }

  async function openLibrary(query, lang, page, signal) {
    const key = `openlibrary:${normalize(query)}:${lang}:${page}`;
    const hit = cached(key);
    if (hit) return hit;
    const openLibraryLanguages = { id: 'ind', en: 'eng' };
    const searchQuery = [query || 'fiction', openLibraryLanguages[lang] && `language:${openLibraryLanguages[lang]}`]
      .filter(Boolean).join(' ');
    const params = new URLSearchParams({
      q: searchQuery,
      page: String(page),
      limit: '12',
      fields: 'key,title,author_name,first_publish_year,cover_i,edition_count,language,subject,publisher,isbn,number_of_pages_median,ebook_access,ia,availability,has_fulltext,public_scan_b'
    });
    if (/^[a-z]{2}$/i.test(lang)) params.set('language', lang.toLowerCase());
    const data = await (await fetchResponse(`https://openlibrary.org/search.json?${params}`, 'application/json', signal)).json();
    const books = (data.docs || []).filter(item => item.title && item.key).map(item => {
      const sourceId = String(item.key).replace(/^\/+/, '');
      const archiveId = Array.isArray(item.ia) ? item.ia[0] : '';
      const availability = item.availability || {};
      const accessType = item.ebook_access === 'public' && archiveId
        ? 'external-full'
        : item.ebook_access === 'borrowable' || availability.available_to_borrow === true
          ? 'borrow'
          : availability.is_previewable === true && archiveId
            ? 'preview'
            : 'metadata';
      const archiveUrl = archiveId ? `https://archive.org/details/${encodeURIComponent(archiveId)}` : '';
      return {
        id: `openlibrary:${sourceId}`,
        source: 'Open Library',
        sourceId,
        title: item.title,
        authors: item.author_name || [],
        description: '',
        cover: item.cover_i ? `https://covers.openlibrary.org/b/id/${item.cover_i}-M.jpg` : '',
        language: (item.language || [])[0] || '',
        categories: item.subject || [],
        year: item.first_publish_year || null,
        publisher: (item.publisher || [])[0] || '',
        isbn: (item.isbn || [])[0] || '',
        pages: item.number_of_pages_median || null,
        accessType,
        infoLink: `https://openlibrary.org/${sourceId}`,
        previewUrl: accessType === 'preview' ? archiveUrl : '',
        externalReadUrl: accessType === 'external-full' ? archiveUrl : '',
        rights: accessType === 'external-full'
          ? 'Open Library menandai akses publik; periksa lisensi item Internet Archive.'
          : accessType === 'borrow'
            ? 'Peminjaman diperlukan melalui Open Library.'
            : 'Status baca dan lisensi perlu diperiksa pada halaman edisi Open Library.'
      };
    });
    const start = Number(data.start) || 0;
    const total = Number(data.numFound) || 0;
    return save(key, { books, hasNext: start + books.length < total });
  }

  async function googleBooks(query, lang, page, signal) {
    const key = `googlebooks:${normalize(query)}:${lang}:${page}`;
    const hit = cached(key);
    if (hit) return hit;
    const params = new URLSearchParams({
      q: query || 'subject:fiction',
      startIndex: String((page - 1) * 12)
    });
    if (/^[a-z]{2}$/i.test(lang)) params.set('lang', lang.toLowerCase());
    const endpoint = new URL('./api/googlebooks', location.href);
    endpoint.search = params.toString();
    let response;
    try {
      response = await fetchResponse(endpoint.href, 'application/json', signal);
    } catch (proxyError) {
      const publicEndpoint = new URL('https://www.googleapis.com/books/v1/volumes');
      publicEndpoint.search = params.toString();
      try {
        response = await fetchResponse(publicEndpoint.href, 'application/json', signal);
      } catch {
        throw proxyError;
      }
    }
    const data = await response.json();
    const books = (data.items || []).map(item => {
      const volume = item.volumeInfo || {};
      const access = item.accessInfo || {};
      const sale = item.saleInfo || {};
      const buyUrl = safeUrl(sale.buyLink || '');
      const priceInfo = sale.retailPrice || sale.listPrice || null;
      const epub = access.epub || {};
      const pdf = access.pdf || {};
      const free = sale.saleability === 'FREE';
      const epubUrl = free && epub.isAvailable ? safeUrl(epub.downloadLink) : '';
      const pdfUrl = free && pdf.isAvailable ? safeUrl(pdf.downloadLink) : '';
      const downloadUrl = epubUrl || pdfUrl;
      const previewUrl = safeUrl(access.webReaderLink || volume.previewLink || '');
      let accessType = 'metadata';
      let readFormat = '';
      if (epubUrl) {
        accessType = 'free-epub';
        readFormat = 'epub';
      } else if (pdfUrl) {
        accessType = 'free-pdf';
        readFormat = 'pdf';
      } else if (sale.saleability === 'FOR_SALE') {
        accessType = 'paid-purchase';
      } else if (access.viewability === 'ALL_PAGES' && previewUrl) {
        accessType = 'external-full';
      } else if (previewUrl && access.viewability !== 'NO_PAGES') {
        accessType = 'preview';
      }
      return {
        id: `googlebooks:${item.id}`,
        source: 'Google Books',
        sourceId: item.id,
        title: volume.title || '',
        authors: volume.authors || [],
        description: cleanText(volume.description).slice(0, 2000),
        cover: safeGoogleImage(volume.imageLinks?.thumbnail || volume.imageLinks?.smallThumbnail || ''),
        language: volume.language || '',
        categories: volume.categories || [],
        year: volume.publishedDate || null,
        publisher: volume.publisher || '',
        isbn: (volume.industryIdentifiers || []).map(identifier => identifier.identifier).find(Boolean) || '',
        pages: volume.pageCount || null,
        accessType,
        readFormat,
        readUrl: downloadUrl,
        downloadUrl,
        formats: [epubUrl && 'EPUB', pdfUrl && 'PDF'].filter(Boolean),
        price: priceInfo && Number.isFinite(Number(priceInfo.amount))
          ? Number(priceInfo.amount)
          : null,
        currency: typeof priceInfo?.currencyCode === 'string' ? priceInfo.currencyCode : '',
        buyUrl,
        previewUrl: accessType === 'preview' ? previewUrl : '',
        externalReadUrl: accessType === 'external-full'
          ? previewUrl
          : downloadUrl ? safeUrl(volume.infoLink || '') : '',
        infoLink: safeUrl(volume.infoLink || ''),
        rights: free ? 'Gratis menurut metadata Google Books; periksa ketentuan pada sumber.' : ''
      };
    }).filter(book => book.title);
    const start = Number(data.startIndex) || 0;
    const total = Number(data.totalItems) || 0;
    return save(key, { books, hasNext: start + books.length < total });
  }

  async function standardEbooks(query, page, signal) {
    const key = `standardebooks:${normalize(query)}:${page}`;
    const hit = cached(key);
    if (hit) return hit;
    const params = new URLSearchParams({ q: query, page: String(page) });
    const endpoint = new URL('./api/standardebooks', location.href);
    endpoint.search = params.toString();
    const xml = await (await fetchResponse(endpoint.href, 'application/atom+xml', signal)).text();
    const feed = new DOMParser().parseFromString(xml, 'application/xml');
    if (feed.querySelector('parsererror')) throw new Error('Feed Standard Ebooks tidak valid.');
    const atom = 'http://www.w3.org/2005/Atom';
    const media = 'http://search.yahoo.com/mrss/';
    const entries = [...feed.getElementsByTagNameNS(atom, 'entry')];
    const books = entries.map(entry => {
      const links = [...entry.getElementsByTagNameNS(atom, 'link')];
      const epubLink = links.find(link =>
        link.getAttribute('rel') === 'enclosure' && /application\/epub\+zip/i.test(link.getAttribute('type') || '')
      );
      const pageLink = links.find(link => link.getAttribute('rel') === 'alternate');
      const title = entry.getElementsByTagNameNS(atom, 'title')[0]?.textContent?.trim() || '';
      const author = entry.getElementsByTagNameNS(atom, 'author')[0]?.getElementsByTagNameNS(atom, 'name')[0]?.textContent?.trim() || '';
      const summary = entry.getElementsByTagNameNS(atom, 'summary')[0]?.textContent || '';
      const rights = entry.getElementsByTagNameNS(atom, 'rights')[0]?.textContent?.trim() || '';
      const published = entry.getElementsByTagNameNS(atom, 'published')[0]?.textContent || '';
      const idUrl = entry.getElementsByTagNameNS(atom, 'id')[0]?.textContent?.trim() || '';
      const cover = entry.getElementsByTagNameNS(media, 'thumbnail')[0]?.getAttribute('url') || '';
      const categories = [...entry.getElementsByTagNameNS(atom, 'category')]
        .map(category => category.getAttribute('term')).filter(Boolean);
      const downloadUrl = safeUrl(epubLink?.getAttribute('href') || '');
      const infoUrl = safeUrl(pageLink?.getAttribute('href') || idUrl);
      return {
        id: `standardebooks:${idUrl.split('/').pop() || normalize(title)}`,
        source: 'Standard Ebooks',
        sourceId: idUrl,
        title,
        authors: author ? [author] : [],
        description: cleanText(summary),
        cover: safeUrl(cover),
        language: 'en',
        categories,
        year: null,
        publisher: 'Standard Ebooks',
        addedDate: published,
        accessType: downloadUrl ? 'free-epub' : 'metadata',
        readFormat: downloadUrl ? 'epub' : '',
        readUrl: downloadUrl,
        downloadUrl,
        formats: downloadUrl ? ['EPUB'] : [],
        externalReadUrl: infoUrl,
        infoLink: infoUrl,
        rights
      };
    }).filter(book => book.title);
    const hasNext = [...feed.getElementsByTagNameNS(atom, 'link')]
      .some(link => link.getAttribute('rel') === 'next');
    return save(key, { books, hasNext });
  }

  async function internetArchive(query, lang, page, newest = false, signal) {
    const key = `archive:${normalize(query)}:${lang}:${page}:${newest}`;
    const hit = cached(key);
    if (hit) return hit;
    const term = query
      ? `(${query.replace(/[():"]/g, ' ')} AND mediatype:texts)`
      : 'mediatype:texts';
    const params = new URLSearchParams();
    const archiveLanguage = ({ id: 'ind', en: 'eng' })[lang] || (lang.length === 3 ? lang : '');
    params.set('q', `${term}${archiveLanguage ? ` AND language:${archiveLanguage}` : ''}`);
    ['identifier', 'title', 'creator', 'description', 'year', 'language', 'publisher', 'subject', 'licenseurl', 'addeddate', 'downloads']
      .forEach(field => params.append('fl[]', field));
    params.set('rows', '12');
    params.set('page', String(page));
    params.set('output', 'json');
    params.set('sort[]', newest ? 'addeddate desc' : 'downloads desc');
    const data = await (await fetchResponse(`https://archive.org/advancedsearch.php?${params}`, 'application/json', signal)).json();
    const docs = data.response?.docs || [];
    const books = docs.filter(item => item.identifier && item.title).map(item => {
      const authors = Array.isArray(item.creator) ? item.creator : [item.creator].filter(Boolean);
      const subjects = Array.isArray(item.subject) ? item.subject : [item.subject].filter(Boolean);
      return {
        id: `archive:${item.identifier}`,
        source: 'Internet Archive',
        title: item.title,
        authors,
        description: cleanText(item.description).slice(0, 1200),
        cover: `https://archive.org/services/img/${encodeURIComponent(item.identifier)}`,
        language: Array.isArray(item.language) ? item.language[0] : item.language || '',
        year: item.year,
        categories: subjects,
        accessType: 'metadata',
        infoLink: `https://archive.org/details/${encodeURIComponent(item.identifier)}`,
        rights: item.licenseurl || 'Ketersediaan dan hak baca perlu diperiksa di halaman item Internet Archive.',
        publisher: item.publisher || '',
        addedDate: item.addeddate || ''
      };
    });
    const start = Number(data.response?.start) || 0;
    const total = Number(data.response?.numFound) || 0;
    return save(key, { books, hasNext: start + docs.length < total });
  }

  function deduplicate(books) {
    const result = [];
    const keys = new Map();
    books.forEach(book => {
      const title = normalize(book.title);
      const author = normalize((book.authors || [book.author || '']).join(' '));
      if (!title || title === 'untitled') return;
      const matches = keys.get(title) || [];
      const previous = matches.find(existing => {
        const existingAuthor = normalize((existing.authors || [existing.author || '']).join(' '));
        const sameAuthor = !author || !existingAuthor || author === existingAuthor;
        const sameIsbn = !book.isbn || !existing.isbn || book.isbn === existing.isbn;
        const paidConflict = ['paid-purchase', 'paid-subscription'].includes(book.accessType) !==
          ['paid-purchase', 'paid-subscription'].includes(existing.accessType) &&
          book.accessType !== 'metadata' && existing.accessType !== 'metadata';
        return sameAuthor && sameIsbn && !paidConflict;
      });
      if (previous) {
        previous.sources = [...new Set([...previous.sources, book.source])];
        previous.sourceIds.push({ source: book.source, id: book.id, infoUrl: book.infoLink || '' });
        if (!(previous.authors || []).length && !previous.author) {
          previous.authors = book.authors || [];
          previous.author = book.author || '';
        }
        ['cover', 'description', 'year', 'publisher', 'isbn'].forEach(field => {
          if (!previous[field] && book[field]) previous[field] = book[field];
        });
        if (!previous.price && book.price) previous.price = book.price;
        if (!previous.currency && book.currency) previous.currency = book.currency;
        if (!previous.buyUrl && book.buyUrl) previous.buyUrl = book.buyUrl;
        const accessRank = {
          metadata: 0, borrow: 1, preview: 2, 'paid-purchase': 2, 'paid-subscription': 2, 'external-full': 3,
          'free-epub': 4, 'free-pdf': 4, full: 4, user: 5
        };
        if ((accessRank[book.accessType] || 0) > (accessRank[previous.accessType] || 0)) {
          ['accessType', 'readUrl', 'readFormat', 'downloadUrl', 'previewUrl',
            'externalReadUrl', 'infoLink', 'rights', 'formats'].forEach(field => {
            if (book[field]) previous[field] = book[field];
          });
        }
        return;
      }
      const copy = {
        ...book,
        sources: [book.source],
        sourceIds: [{ source: book.source, id: book.id, infoUrl: book.infoLink || '' }]
      };
      keys.set(title, [...matches, copy]);
      result.push(copy);
    });
    return result;
  }

  async function searchWikisource(query, lang, page, signal) {
    const languages = lang ? [lang] : ['en', 'id'];
    const results = await Promise.allSettled(languages.map(language =>
      wikisource(query, language, page, !query, signal)
    ));
    const fulfilled = results.filter(result => result.status === 'fulfilled').map(result => result.value);
    if (!fulfilled.length) throw new Error('Wikisource tidak dapat dijangkau.');
    return {
      books: fulfilled.flatMap(result => result.books || []),
      hasNext: fulfilled.some(result => result.hasNext)
    };
  }

  async function search(query, options = {}) {
    const q = String(query || '').trim();
    const page = Math.max(1, Number(options.page) || 1);
    const lang = options.lang || '';
    const signal = options.signal;
    const adapters = [
      { id: 'openlibrary', source: 'Open Library', run: () => openLibrary(q, lang, page, signal) },
      { id: 'googlebooks', source: 'Google Books', run: () => googleBooks(q, lang, page, signal) },
      { id: 'gutenberg', source: 'Project Gutenberg', run: () => gutenberg(q, lang, page, signal) },
      { id: 'archive', source: 'Internet Archive', run: () => internetArchive(q, lang, page, false, signal) },
      {
        id: 'wikisource',
        source: 'Wikisource',
        run: () => searchWikisource(q, lang, page, signal),
        supportsLanguage: !lang || lang === 'en' || lang === 'id'
      },
      {
        id: 'standardebooks',
        source: 'Standard Ebooks',
        run: () => standardEbooks(q, page, signal),
        supportsLanguage: !lang || lang === 'en'
      }
    ];
    const tasks = adapters.filter(adapter =>
      (!options.source || options.source === adapter.id) &&
      adapter.supportsLanguage !== false
    );
    if (!tasks.length) {
      return {
        books: [],
        failed: 0,
        failedSources: [],
        total: 0,
        pagination: { page, has_next: false }
      };
    }
    const results = await Promise.allSettled(tasks.map(task => task.run()));
    const available = [];
    const failedSources = [];
    results.forEach((result, index) => {
      if (result.status === 'fulfilled') {
        available.push({ source: tasks[index].source, result: result.value });
      }
      else {
        failedSources.push(tasks[index].source);
        if (result.reason?.name !== 'AbortError') {
          console.warn(`Katalog ${tasks[index].source} gagal dimuat.`, result.reason);
        }
      }
    });
    if (!available.length && failedSources.length === tasks.length && !signal?.aborted) {
      throw new Error('Semua sumber katalog tidak dapat dijangkau.');
    }
    return {
      books: deduplicate(available.flatMap(item => item.result.books || [])),
      failed: failedSources.length,
      failedSources,
      total: tasks.length,
      pagination: {
        page,
        has_next: available.some(item => item.result.hasNext)
      }
    };
  }

  async function suggestions(query) {
    const result = await search(query, { page: 1 });
    return result.books.filter(book => book.readUrl).slice(0, 5);
  }

  async function popularBooks() {
    const result = await search('', { page: 1 });
    result.books.sort((a, b) => Number(Boolean(b.readUrl)) - Number(Boolean(a.readUrl)));
    return result;
  }

  async function newestBooks() {
    const results = await Promise.allSettled([
      internetArchive('', '', 1, true),
      standardEbooks('', 1)
    ]);
    const available = results.filter(result => result.status === 'fulfilled').map(result => result.value);
    if (!available.length) throw new Error('Katalog buku terbaru tidak dapat dimuat.');
    return deduplicate(available.flatMap(result => result.books || []));
  }

  return { search, suggestions, popularBooks, newestBooks };
})();
