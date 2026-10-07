import { tmdb } from './_tmdb.js';

// GET /api/tmdb?path=/movie/603&append_to_response=videos
export default async function handler(req, res) {
  try {
    const { path, ...params } = req.query || {};
    if (typeof path !== 'string') return res.status(400).json({ error: 'Missing path' });
    params.language = params.language || 'en-US';
    const EXTRAS = ['videos', 'credits', 'recommendations', 'similar', 'watch/providers', 'combined_credits'];
    if (params.append_to_response && !String(params.append_to_response).split(',').every(x => EXTRAS.includes(x))) delete params.append_to_response;
    const data = await tmdb(path, params);
    res.setHeader('Cache-Control', 'public, s-maxage=3600, stale-while-revalidate=86400');
    res.status(200).json(data);
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
}
