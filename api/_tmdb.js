// Shared TMDB helper. Files starting with "_" are not exposed as routes on Vercel.
const BASE = 'https://api.themoviedb.org/3';

export const ALLOWED = /^\/(search\/(multi|movie|tv)|(movie|tv)\/\d+(\/(videos|similar|recommendations|watch\/providers))?|collection\/\d+|person\/\d+|find\/tt\d+|trending\/(all|movie|tv)\/(day|week)|discover\/(movie|tv)|genre\/(movie|tv)\/list)$/;

export async function tmdb(path, params = {}) {
  if (!ALLOWED.test(path)) throw Object.assign(new Error('Path not allowed'), { status: 400 });
  const url = new URL(BASE + path);
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, v);
  const headers = { accept: 'application/json' };
  if (process.env.TMDB_READ_TOKEN) headers.authorization = `Bearer ${process.env.TMDB_READ_TOKEN}`;
  else if (process.env.TMDB_API_KEY) url.searchParams.set('api_key', process.env.TMDB_API_KEY);
  else throw Object.assign(new Error('TMDB key missing on the server'), { status: 500 });
  const r = await fetch(url, { headers });
  if (!r.ok) throw Object.assign(new Error(`TMDB error ${r.status}`), { status: r.status });
  return r.json();
}

let genreCache = null;
export async function genres() {
  if (genreCache) return genreCache;
  const [m, t] = await Promise.all([tmdb('/genre/movie/list'), tmdb('/genre/tv/list')]);
  genreCache = { movie: m.genres || [], tv: t.genres || [] };
  return genreCache;
}

// Compact a TMDB result for the AI and for the app.
export function slim(x, forcedType) {
  const type = forcedType || x.media_type;
  if (type !== 'movie' && type !== 'tv') return null;
  const date = x.release_date || x.first_air_date || '';
  return {
    id: x.id,
    type,
    title: x.title || x.name || '',
    year: date.slice(0, 4),
    rating: x.vote_average ? Math.round(x.vote_average * 10) / 10 : null,
    votes: x.vote_count || 0,
    poster: x.poster_path || null,
    overview: (x.overview || '').slice(0, 220),
  };
}
