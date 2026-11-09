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
  const cleanText = value => String(value || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();

  function cached(key) {
    const value = memory.get(key);
    if (value && Date.now() - value.time < TTL) return value.data;
    try {
      const saved = JSON.parse(localStorage.getItem(`pk:catalog:v8:${key}`));
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
      localStorage.setItem(`pk:catalog:v8:${key}`, JSON.stringify(value));
    } catch (error) {
      console.warn('Cache katalog lokal tidak dapat disimpan.', error);
    }
    return data;
  }

  async function fetchResponse(url, accept = 'application/json') {
    let lastError;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const controller = new AbortController();
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
        if (attempt === 1 || (error.name !== 'AbortError' && error.name !== 'TypeError')) throw error;
        await new Promise(resolve => setTimeout(resolve, 400));
      } finally {
        clearTimeout(timeout);
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

  async function wikisource(query, lang, page, random = false) {
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
    const data = await (await fetchResponse(`${endpoint}?${params}`)).json();
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

  async function gutenberg(query, lang, page) {
    const key = `gutenberg:${normalize(query)}:${lang}:${page}`;
    const hit = cached(key);
    if (hit) return hit;
    const params = new URLSearchParams({ page: String(page), sort: 'popular' });
    if (query) params.set('search', query);
    if (lang) params.set('languages', lang);
    const data = await (await fetchResponse(`https://gutendex.com/books/?${params}`)).json();
    const books = (data.results || []).filter(item =>
      item.title && item.copyright === false
    ).map(item => {
      const formats = item.formats || {};
      const textEntry = Object.entries(formats).find(([type, url]) =>
        /^text\/plain\b/i.test(type) && safeUrl(url)
      );
      const epubEntry = Object.entries(formats).find(([type, url]) =>
        /application\/epub\+zip/i.test(type) && safeUrl(url)
      );
      const selected = epubEntry || textEntry;
      if (!selected) return null;
      const [, readUrl] = selected;
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
        accessType: 'full',
        readFormat: epubEntry ? 'epub' : 'txt',
        readUrl,
        infoLink: `https://www.gutenberg.org/ebooks/${item.id}`,
        rights: 'Domain publik di Amerika Serikat menurut Gutendex; periksa aturan hak cipta di negara Anda.',
        publisher: 'Project Gutenberg'
      };
    }).filter(Boolean);
    return save(key, { books, hasNext: Boolean(data.next) });
  }

  async function internetArchive(query, lang, page, newest = false) {
    const key = `archive:${normalize(query)}:${lang}:${page}:${newest}`;
    const hit = cached(key);
    if (hit) return hit;
    const term = query
      ? `(${query.replace(/[():"]/g, ' ')} AND mediatype:texts)`
      : 'mediatype:texts';
    const params = new URLSearchParams();
    params.set('q', `${term}${lang ? ` AND language:${lang === 'id' ? 'ind' : 'eng'}` : ''}`);
    ['identifier', 'title', 'creator', 'description', 'year', 'language', 'publisher', 'subject', 'licenseurl', 'addeddate', 'downloads']
      .forEach(field => params.append('fl[]', field));
    params.set('rows', '12');
    params.set('page', String(page));
    params.set('output', 'json');
    params.set('sort[]', newest ? 'addeddate desc' : 'downloads desc');
    const data = await (await fetchResponse(`https://archive.org/advancedsearch.php?${params}`)).json();
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
        return !author || !existingAuthor || author === existingAuthor;
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
        if (!previous.readUrl && book.readUrl) {
          Object.assign(previous, {
            accessType: book.accessType,
            readUrl: book.readUrl,
            readFormat: book.readFormat,
            infoLink: book.infoLink,
            rights: book.rights
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

  async function search(query, options = {}) {
    const q = String(query || '').trim();
    const page = Math.max(1, Number(options.page) || 1);
    const lang = options.lang || '';
    const sources = [];
    const labeledTasks = [
      ...(lang === 'en' || !lang ? [{ source: 'Wikisource (Inggris)', run: () => wikisource(q, 'en', page, !q) }] : []),
      ...(lang === 'id' || !lang ? [{ source: 'Wikisource (Indonesia)', run: () => wikisource(q, 'id', page, !q) }] : [])
    ];
    if (lang !== 'id') {
      labeledTasks.push({ source: 'Project Gutenberg', run: () => gutenberg(q, lang, page) });
    }
    labeledTasks.push({ source: 'Internet Archive', run: () => internetArchive(q, lang, page) });
    const results = await Promise.allSettled(labeledTasks.map(task => task.run()));
    const failedSources = [];
    results.forEach((result, index) => {
      if (result.status === 'fulfilled') sources.push(result.value);
      else {
        failedSources.push(labeledTasks[index].source);
        console.warn('Sumber katalog gagal dimuat.', result.reason);
      }
    });
    if (results.every(result => result.status === 'rejected')) {
      throw new Error('Semua sumber katalog tidak dapat dijangkau.');
    }
    return {
      books: deduplicate(sources.flatMap(result => result.books || [])),
      failed: failedSources.length,
      failedSources,
      total: labeledTasks.length,
      pagination: {
        page,
        has_next: sources.some(result => result.hasNext)
      }
    };
  }

  async function suggestions(query) {
    const result = await search(query, { page: 1 });
    return result.books.filter(book => book.readUrl).slice(0, 5);
  }

  async function popularBooks() {
    const results = await Promise.allSettled([
      wikisource('', 'id', 1, true),
      wikisource('', 'en', 1, true),
      gutenberg('', '', 1)
    ]);
    const available = results.filter(result => result.status === 'fulfilled').map(result => result.value);
    if (!available.length) throw new Error('Katalog populer tidak dapat dimuat.');
    return {
      books: deduplicate(available.flatMap(result => result.books || []))
        .sort((a, b) => Number(Boolean(b.readUrl)) - Number(Boolean(a.readUrl))),
      failed: results.length - available.length,
      total: results.length,
      failedSources: []
    };
  }

  async function newestBooks() {
    const result = await internetArchive('', '', 1, true);
    return result.books;
  }

  return { search, suggestions, popularBooks, newestBooks };
})();
