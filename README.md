# Watchd

Track movies and series, rate them, watch trailers, get AI picks grounded in TMDB, and share lists.

## What's in here

| File | What it does |
|---|---|
| `index.html` | The whole app (phone layout, Phase 1) |
| `api/tmdb.js` | Server proxy to TMDB, so your TMDB key never reaches the phone. Only allows the endpoints the app uses. |
| `api/chat.js` | The Ask feature. Groq picks titles using TMDB tools; every pick is checked against real TMDB results before it reaches the app. |
| `api/_tmdb.js` | Shared TMDB helper (not a public route) |
| `sw.js` | Offline support: app shell and posters are cached |
| `vercel.json` | Forwards `/__/auth/*` to Firebase so Google sign-in runs on the app's own domain |
| `manifest.webmanifest`, `icon.svg`, `icon-192.png`, `icon-512.png`, `apple-touch-icon.png` | PWA install and icons |
| `og-image.svg`, `og-image.png` | Share preview card (1200×630) |

## 1. Get your keys

- **TMDB:** themoviedb.org → Settings → API. Copy the **API Read Access Token** (the long one).
- **Groq:** console.groq.com → API Keys → Create.

## 2. Deploy to Vercel

1. Push this folder to a GitHub repo and import it in Vercel (no build settings needed).
2. In Vercel → Project → Settings → Environment Variables, add:
   - `TMDB_READ_TOKEN` = your TMDB read access token
   - `GROQ_API_KEY` = your Groq key
   - `GROQ_MODEL` (optional) = defaults to `openai/gpt-oss-120b`. Check console.groq.com/docs/models for a current model that supports tool use, and set it here if that one has been retired.
3. Redeploy.

## 3. Replace the placeholder domain

`index.html` uses `https://watchd-stat.vercel.app/` in the `og:url`, `og:image` and `twitter:image` tags, and `og-image.png` shows `watchd-stat.vercel.app`. If you move to another domain, update these. To re-render the image, edit the text in `og-image.svg` and run:

```
npx @resvg/resvg-js-cli --font-dirs <folder with Onest-400.ttf and Onest-700.ttf> og-image.svg og-image.png
```

After deploying, paste your link into the Facebook Sharing Debugger (developers.facebook.com/tools/debug) and press **Scrape again** if Messenger shows an old preview.

## 4. Google sign-in (Firebase)

Sign-in is connected to the Firebase project `watchd-ddc0f` (config in the `FB` object near the top of the script in `index.html`). Signed-in users get their library and Not interested list synced to `users/{uid}`, live across devices. Without signing in, everything stays on the device.

How it's wired:

- On the live site, sign-in runs through the app's own domain. `vercel.json` forwards `/__/auth/*` to `watchd-ddc0f.firebaseapp.com`, and the app sets `authDomain` to the current host. This is what makes sign-in work in browsers that block third-party storage, including iPhone Home Screen apps. On localhost it uses the firebaseapp.com domain directly.
- Home Screen apps sign in with a redirect instead of a popup. Browsers fall back to a redirect if the popup is blocked.

Firebase console settings this depends on:

- Authentication → Sign-in method: **Google** enabled.
- Authentication → Settings → Authorized domains: your Vercel domain (`watchd-stat.vercel.app`).
- Google Cloud → APIs & Services → Credentials → *Web client (auto created by Google Service)*: authorized JavaScript origin `https://watchd-stat.vercel.app` and redirect URI `https://watchd-stat.vercel.app/__/auth/handler`.
- Firestore rules:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{db}/documents {
    match /users/{uid} {
      allow read, write: if request.auth != null && request.auth.uid == uid;
    }
  }
}
```

If you move to a new domain, add it in all three places above.

## Importing from Letterboxd or IMDb

Settings → Backup → **Import from Letterboxd or IMDb** takes the CSV files from either export (pick several at once):

- **Letterboxd:** Settings → Data → Export your data, unzip it, then pick `ratings.csv`, `watched.csv`, `diary.csv` and `watchlist.csv`. Films are matched on TMDB by name and year. Watchlist titles go to Planning, everything else to Finished.
- **IMDb:** Your Ratings → ⋯ → Export, and your Watchlist → ⋯ → Export. Titles are matched exactly by IMDb ID (`/find`), and series come in as series. Episodes are skipped.

Ratings are converted to 5 stars. A title already in the library keeps its status and rating, except that Planning moves to Finished and a missing rating is filled in. Titles that couldn't be matched are listed at the end.

## How sharing works

**Library → Share** creates a link with the list's TMDB IDs packed into it, so no server or account is needed. Whoever opens the link sees the posters and can **Save all to my library** (added to Planning) or export the list as a Watchd list file (.json, which can be opened again in Watchd) or a spreadsheet (.csv). Ratings and history are never shared.

## Before you go public

- `api/chat.js` allows 20 questions per hour per IP and rejects browser requests from other sites. The count lives in each serverless instance's memory, so it's a brake rather than a hard wall. For a hard limit, add a rate-limit rule in Vercel → Firewall for `/api/chat`.
- Where to watch uses JustWatch data through TMDB, and the JustWatch credit on the detail page must stay.
- TMDB's terms require the attribution line, which is already in Settings.
