const GOOGLE_BOOKS_API = 'https://www.googleapis.com/books/v1/volumes';

module.exports = async function handler(request, response) {
  if (request.method !== 'GET') {
    response.setHeader('Allow', 'GET');
    return response.status(405).json({ error: 'Method not allowed.' });
  }

  const queryParams = request.query || {};
  const query = String(queryParams.q || '').trim().slice(0, 300);
  const apiKey = process.env.GOOGLE_BOOKS_API_KEY;
  if (!apiKey) {
    return response.status(503).json({ error: 'Set GOOGLE_BOOKS_API_KEY in the Vercel environment.' });
  }
  const startIndex = Math.max(0, Math.min(1000, Number(queryParams.startIndex) || 0));
  const language = /^[a-z]{2}$/i.test(queryParams.lang || '') ? queryParams.lang : '';
  const params = new URLSearchParams({
    q: query || 'subject:fiction',
    maxResults: '12',
    startIndex: String(startIndex),
    printType: 'books'
  });
  if (language) params.set('langRestrict', language.toLowerCase());
  params.set('key', apiKey);

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 9000);
    try {
      const upstream = await fetch(`${GOOGLE_BOOKS_API}?${params}`, {
        signal: controller.signal,
        headers: { Accept: 'application/json' }
      });
      if (!upstream.ok) {
        response.setHeader('Cache-Control', 'no-store');
        return response.status(upstream.status).json({ error: 'Google Books request failed.' });
      }
      const body = await upstream.text();
      response.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=21600');
      response.setHeader('Content-Type', 'application/json; charset=utf-8');
      return response.status(upstream.status).send(body);
    } finally {
      clearTimeout(timeout);
    }
  } catch (error) {
    console.error('Google Books proxy request failed.', error);
    return response.status(502).json({ error: 'Google Books is temporarily unavailable.' });
  }
};
