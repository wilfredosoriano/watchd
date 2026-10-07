import { tmdb, genres, slim } from './_tmdb.js';

// POST /api/chat  { messages:[{role:'user'|'assistant', content}], library:[{title,type,year,status,rating}] }
// Returns { reply, picks:[{id,type,title,year,poster,rating,why}] }
// Every pick is checked against titles TMDB actually returned during this request.

const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
const MODEL = process.env.GROQ_MODEL || 'openai/gpt-oss-120b';

const SYSTEM = `You are the picks assistant inside Watchd, a movie and series tracker.
Rules:
- Only talk about movies and TV series. If the user asks about anything else, reply briefly that you can only help with movies and series, and return no picks.
- Never recommend a title from memory. Always use the tools first, and only recommend titles that appear in tool results, using the exact id and type from those results.
- Use the user's library to personalize: lean on what they finished and rated highly, and do not recommend titles already in their library unless they ask.
- Keep the reply short and friendly: one to three sentences. Do not list titles in the reply text; the app shows the picks as cards.
- Give 3 to 6 picks when the user wants recommendations. Each "why" is one short sentence.
When you are done, answer with ONLY this JSON and nothing else:
{"reply":"...","picks":[{"id":123,"type":"movie","why":"..."}]}`;

const TOOLS = [
  { type: 'function', function: {
    name: 'search_titles',
    description: 'Search TMDB for movies or series by name. Use it to look up a title the user mentions.',
    parameters: { type: 'object', properties: {
      query: { type: 'string' },
      type: { type: 'string', enum: ['movie', 'tv', 'any'] } }, required: ['query'] } } },
  { type: 'function', function: {
    name: 'similar_titles',
    description: 'Get TMDB recommendations similar to a specific title. Needs the TMDB id and type from a previous result.',
    parameters: { type: 'object', properties: {
      id: { type: 'integer' }, type: { type: 'string', enum: ['movie', 'tv'] } }, required: ['id', 'type'] } } },
  { type: 'function', function: {
    name: 'discover_titles',
    description: 'Find movies or series by genre, year range, language and minimum rating.',
    parameters: { type: 'object', properties: {
      type: { type: 'string', enum: ['movie', 'tv'] },
      genres: { type: 'array', items: { type: 'string' }, description: 'Genre names like Comedy, Drama, Science Fiction, Animation' },
      year_from: { type: 'integer' }, year_to: { type: 'integer' },
      min_rating: { type: 'number', description: '0 to 10' },
      language: { type: 'string', description: 'ISO 639-1 original language, like en, ko, ja, tl' },
      sort: { type: 'string', enum: ['popular', 'top_rated', 'newest'] } }, required: ['type'] } } },
  { type: 'function', function: {
    name: 'trending_titles',
    description: 'Get what is trending this week on TMDB.',
    parameters: { type: 'object', properties: { type: { type: 'string', enum: ['movie', 'tv', 'all'] } } } } },
];

async function runTool(name, a, seen) {
  let list = [];
  if (name === 'search_titles') {
    const t = a.type === 'movie' || a.type === 'tv' ? a.type : 'multi';
    const d = await tmdb(`/search/${t}`, { query: String(a.query || '').slice(0, 100), include_adult: 'false' });
    list = (d.results || []).map(x => slim(x, t === 'multi' ? undefined : t));
  } else if (name === 'similar_titles') {
    const d = await tmdb(`/${a.type}/${parseInt(a.id, 10)}/recommendations`);
    list = (d.results || []).map(x => slim(x, a.type));
  } else if (name === 'discover_titles') {
    const type = a.type === 'tv' ? 'tv' : 'movie';
    const g = (await genres())[type];
    const ids = (a.genres || []).map(n => g.find(x => x.name.toLowerCase() === String(n).toLowerCase())?.id).filter(Boolean);
    const dateKey = type === 'movie' ? 'primary_release_date' : 'first_air_date';
    const sort = a.sort === 'top_rated' ? 'vote_average.desc' : a.sort === 'newest' ? `${dateKey}.desc` : 'popularity.desc';
    const d = await tmdb(`/discover/${type}`, {
      with_genres: ids.join(','), sort_by: sort, include_adult: 'false',
      'vote_count.gte': a.sort === 'top_rated' ? 300 : 50,
      'vote_average.gte': a.min_rating, with_original_language: a.language,
      [`${dateKey}.gte`]: a.year_from ? `${a.year_from}-01-01` : undefined,
      [`${dateKey}.lte`]: a.year_to ? `${a.year_to}-12-31` : undefined,
    });
    list = (d.results || []).map(x => slim(x, type));
  } else if (name === 'trending_titles') {
    const t = ['movie', 'tv'].includes(a.type) ? a.type : 'all';
    const d = await tmdb(`/trending/${t}/week`);
    list = (d.results || []).map(x => slim(x, t === 'all' ? undefined : t));
  } else {
    return { error: 'Unknown tool' };
  }
  list = list.filter(Boolean).slice(0, 10);
  for (const x of list) seen.set(`${x.type}:${x.id}`, x);
  return list.map(({ poster, votes, ...rest }) => rest);
}

async function groq(body) {
  const r = await fetch(GROQ_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${process.env.GROQ_API_KEY}` },
    // gpt-oss models reason before answering; keep that short and leave room for the reply.
    body: JSON.stringify({ model: MODEL, temperature: 0.5, max_tokens: 4000, ...(/gpt-oss/.test(MODEL) ? { reasoning_effort: 'low' } : {}), ...body }),
  });
  if (!r.ok) throw Object.assign(new Error(`Groq error ${r.status}: ${(await r.text()).slice(0, 200)}`), { status: 502 });
  return r.json();
}

// Best-effort limit per IP. Each Vercel instance keeps its own count, so treat it as a brake, not a wall.
const LIMIT = 20, WINDOW = 60 * 60 * 1000, hits = new Map();
function limited(ip) {
  const now = Date.now(), list = (hits.get(ip) || []).filter(t => now - t < WINDOW);
  if (list.length >= LIMIT) { hits.set(ip, list); return Math.ceil((WINDOW - (now - list[0])) / 60000); }
  list.push(now); hits.set(ip, list);
  if (hits.size > 5000) for (const [k, v] of hits) if (!v.length || now - v[v.length - 1] > WINDOW) hits.delete(k);
  return 0;
}

function parseFinal(text) {
  if (!text) return null;
  const clean = text.replace(/```json|```/g, '').trim();
  const start = clean.indexOf('{'), end = clean.lastIndexOf('}');
  if (start < 0 || end < start) return null;
  try { return JSON.parse(clean.slice(start, end + 1)); } catch { return null; }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Use POST' });
  if (!process.env.GROQ_API_KEY) return res.status(500).json({ error: 'GROQ_API_KEY missing on the server' });
  // Only this app's own pages may call Ask from a browser.
  const origin = req.headers.origin;
  if (origin) { try { if (new URL(origin).host !== req.headers.host) return res.status(403).json({ error: 'Not allowed' }); } catch { return res.status(403).json({ error: 'Not allowed' }); } }
  const ip = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket?.remoteAddress || 'unknown';
  const wait = limited(ip);
  if (wait) { res.setHeader('Retry-After', String(wait * 60)); return res.status(429).json({ error: `You've reached the limit of ${LIMIT} questions an hour. Try again in ${wait} minute${wait === 1 ? '' : 's'}.` }); }
  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
    const history = (Array.isArray(body.messages) ? body.messages : [])
      .filter(m => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
      .slice(-10).map(m => ({ role: m.role, content: m.content.slice(0, 1500) }));
    if (!history.length || history[history.length - 1].role !== 'user') return res.status(400).json({ error: 'Send a message first' });
    const library = (Array.isArray(body.library) ? body.library : []).slice(0, 150)
      .map(x => `${x.title} (${x.year || '?'}, ${x.type === 'tv' ? 'series' : 'movie'}, ${x.status}${x.rating ? `, rated ${x.rating}/5` : ''})`).join('\n');

    const hidden = (Array.isArray(body.hidden) ? body.hidden : []).slice(0, 100)
      .filter(x => x && (x.type === 'movie' || x.type === 'tv') && Number.isInteger(+x.id));
    const hiddenKeys = new Set(hidden.map(x => `${x.type}:${+x.id}`));

    const messages = [
      { role: 'system', content: SYSTEM },
      { role: 'system', content: `User's library:\n${library || '(empty)'}` },
      ...(hidden.length ? [{ role: 'system', content: `The user marked these as not interested. Never pick them, and lean away from titles very like them:\n${hidden.map(x => `${String(x.title || '').slice(0, 100)} (${x.type} id ${+x.id})`).join('\n')}` }] : []),
      ...history,
    ];
    const seen = new Map();
    let final = null;

    for (let round = 0; round < 5; round++) {
      const d = await groq({ messages, tools: TOOLS, tool_choice: 'auto' });
      const msg = d.choices?.[0]?.message;
      if (!msg) break;
      if (msg.tool_calls?.length) {
        messages.push({ role: 'assistant', content: msg.content || '', tool_calls: msg.tool_calls });
        for (const call of msg.tool_calls) {
          let out;
          try { out = await runTool(call.function.name, JSON.parse(call.function.arguments || '{}'), seen); }
          catch (e) { out = { error: e.message }; }
          messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(out) });
        }
        continue;
      }
      final = parseFinal(msg.content);
      if (!final) {
        // Ask once more for clean JSON, no tools.
        messages.push({ role: 'assistant', content: msg.content || '' });
        messages.push({ role: 'user', content: 'Reformat your last answer as the required JSON only.' });
        const d2 = await groq({ messages, response_format: { type: 'json_object' } });
        final = parseFinal(d2.choices?.[0]?.message?.content) || { reply: msg.content || '', picks: [] };
      }
      break;
    }
    if (!final) final = { reply: 'I could not finish that search. Try asking in a different way.', picks: [] };

    // Ground every pick in real TMDB data from this request.
    const picks = [];
    for (const p of Array.isArray(final.picks) ? final.picks : []) {
      const hit = seen.get(`${p.type}:${parseInt(p.id, 10)}`);
      if (hit && !hiddenKeys.has(`${hit.type}:${hit.id}`) && !picks.some(x => x.id === hit.id && x.type === hit.type)) {
        picks.push({ id: hit.id, type: hit.type, title: hit.title, year: hit.year, poster: hit.poster, rating: hit.rating, why: String(p.why || '').slice(0, 200) });
      }
    }
    res.status(200).json({ reply: String(final.reply || '').slice(0, 800), picks: picks.slice(0, 6) });
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
}
