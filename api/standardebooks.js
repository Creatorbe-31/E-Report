


const STANDARD_EBOOKS_FEED = 'https://standardebooks.org/feeds/atom';

module.exports = async function handler(request, response) {
  if (request.method !== 'GET') {
    response.setHeader('Allow', 'GET');
    return response.status(405).json({ error: 'Method not allowed.' });
  }

  const queryParams = request.query || {};
  const query = String(queryParams.q || '').trim().slice(0, 200);
  const page = Math.max(1, Math.min(1000, Number(queryParams.page) || 1));
  const feed = query ? `${STANDARD_EBOOKS_FEED}/all` : `${STANDARD_EBOOKS_FEED}/new-releases`;
  const params = new URLSearchParams();
  if (query) {
    params.set('query', query);
    params.set('per-page', '12');
    params.set('page', String(page));
  }

  try {
    const queryString = params.toString();
    const url = queryString ? `${feed}?${queryString}` : feed;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 9000);
    try {
      const upstream = await fetch(url, {
        signal: controller.signal,
        headers: { Accept: 'application/atom+xml' }
      });
      const body = await upstream.text();
      response.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=21600');
      response.setHeader('Content-Type', 'application/atom+xml; charset=utf-8');
      return response.status(upstream.status).send(body);
    } finally {
      clearTimeout(timeout);
    }
  } catch (error) {
    console.error('Standard Ebooks proxy request failed.', error);
    return response.status(502).json({ error: 'Standard Ebooks is temporarily unavailable.' });
  }
};
