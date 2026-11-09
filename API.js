const API = (() => {
  function toCard(book) {
    const sources = book.sources || [book.source].filter(Boolean);
    const readUrl = book.readUrl || '';
    const previewUrl = book.previewUrl || '';
    let access;

    switch (book.accessType) {
      case 'full':
      case 'user':
        access = book.accessType === 'user' ? 'File milik Anda' : 'Teks lengkap · gratis';
        break;
      case 'external-full':
        access = 'Baca di sumber resmi';
        break;
      case 'preview':
        access = 'Pratinjau resmi';
        break;
      case 'metadata':
        access = 'Cek pinjam / baca di sumber asli';
        break;
      default:
        access = 'Metadata saja · tidak bisa dibaca di sini';
    }

    const rawLanguage = book.language || book.lang || '';
    const language = ({ ind: 'id', eng: 'en', indonesia: 'id', english: 'en' })[String(rawLanguage).toLowerCase()] ||
      String(rawLanguage).toLowerCase().slice(0, 2);
    return {
      id: book.id || book.identifier || `book:${Date.now()}:${Math.random().toString(36).slice(2)}`,
      source: sources.join(' + ') || book.source || 'Katalog buku',
      sources,
      title: book.title || 'Tanpa judul',
      author: Array.isArray(book.authors) && book.authors.length
        ? book.authors.join(', ')
        : book.author || 'Penulis tidak diketahui',
      year: Number.parseInt(book.publishedDate || book.year, 10) || null,
      publisher: book.publisher || '',
      isbn: book.isbn13 || book.isbn10 || (Array.isArray(book.isbn) ? book.isbn[0] : book.isbn) || '',
      pages: book.pageCount || book.pages || null,
      desc: book.description || book.desc || '',
      cover: book.cover || book.thumbnail || '',
      lang: language,
      subjects: book.categories || book.subjects || [],
      access,
      accessType: book.accessType || 'external',
      readUrl,
      fileType: book.readFormat || '',
      previewUrl,
      externalReadUrl: book.externalReadUrl || '',
      infoUrl: book.infoLink || '',
      localFile: book.localFile || false,
      rights: book.rights || '',
      addedDate: book.addedDate || '',
      sourceIds: book.sourceIds || []
    };
  }

  async function search(options = {}) {
    if (typeof BookAgent === 'undefined') throw new Error('BookAgent belum dimuat.');
    const result = await BookAgent.search(options.q || options.query || '', {
      ...options,
      lang: options.lang || ''
    });
    if (result.failed === result.total && result.total > 0) {
      throw new Error('Semua katalog buku tidak dapat dijangkau.');
    }
    return {
      books: result.books.map(toCard).filter(book =>
        book.title && book.title !== 'Tanpa judul'
      ),
      failed: result.failed,
      failedSources: result.failedSources || [],
      total: result.total,
      pagination: result.pagination
    };
  }

  async function suggest(query) {
    if (typeof BookAgent === 'undefined') return [];
    return (await BookAgent.suggestions(query)).map(toCard);
  }

  async function popularBooks() {
    if (typeof BookAgent === 'undefined') throw new Error('BookAgent belum dimuat.');
    const result = await BookAgent.popularBooks();
    if (result.failed === result.total) throw new Error('Katalog buku tidak dapat dimuat.');
    return result.books.map(toCard)
      .filter(book =>
        book.title && book.title !== 'Tanpa judul'
      );
  }

  async function newestBooks() {
    if (typeof BookAgent === 'undefined') throw new Error('BookAgent belum dimuat.');
    return (await BookAgent.newestBooks()).map(toCard)
      .filter(book => book.title && book.title !== 'Tanpa judul');
  }

  function standardEbooksSearchUrl(query = '') {
    const url = new URL('https://standardebooks.org/ebooks');
    if (query) url.searchParams.set('query', query);
    url.searchParams.set('per-page', '12');
    url.searchParams.set('page', '1');
    return url.href;
  }

  async function catalogBooks(query) {
    const result = await search({ q: query });
    return result.books;
  }

  async function readableBooks(query) {
    const result = await search({ q: query });
    return result.books.filter(book => ['full', 'user'].includes(book.accessType) && book.readUrl);
  }

  return {
    search,
    suggest,
    popularBooks,
    newestBooks,
    standardEbooksSearchUrl,
    catalogBooks,
    readableBooks,
    toCard
  };
})();
