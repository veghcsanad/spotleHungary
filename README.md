# Spotle HU

A [Spotle](https://spotle.io/)-style daily guessing game for **Hungarian music artists**.
Guess the artist of the day in 10 tries. After each guess you see how close you are:

| Category | 🟩 Correct | 🟨 Close | Arrow |
|---|---|---|---|
| Debütálás (debut year) | same year | within 5 years | ↑/↓ |
| Tagok (members, 1 = solo) | same | ±1 member | ↑/↓ |
| Népszerűség (popularity rank by monthly listeners) | same | within 10 places | ↑/↓ |
| Nem (gender: male / female / mixed) | same | – | – |
| Műfaj (genre) | same | related genre family | – |
| Származás (origin city) | same city | same region | – |

If either artist has no data for a category, the tile shows a dashed **"?"** (⬜ in the share text) instead of a
colour, since the comparison can't be made.

Every artist has up to three hints of different types (song, album, collaboration, initials…). After
7 guesses the player may reveal **one** of them, choosing by hint type; all three are shown once the game ends.
There is a daily
mode (new artist every midnight, Budapest time, with streak statistics) and an unlimited practice mode.
Thresholds and genre families live in [`shared/game.ts`](shared/game.ts).

## Tech stack

- **Client:** React 18 + Vite + TypeScript (`src/`), UI in Hungarian, game state & stats in `localStorage`.
- **API:** Express + TypeScript (`server/`). Guesses are evaluated server-side, so the answer is not shipped to the browser.
- **Database:** SQLite via Node's built-in `node:sqlite` (`data/spotle.db`, created automatically on first start and seeded from [`data/artists.json`](data/artists.json)).

Requires **Node.js 22.13+** (for `node:sqlite`; an "experimental" warning is printed, which is expected).

## Getting started

```bash
npm install
npm run dev        # API on :3001, Vite dev server on http://localhost:5173
```

Other scripts:

```bash
npm test           # unit + API tests (vitest)
npm run build      # typecheck + production build into dist/
npm start          # serve API + built client on http://localhost:3001 (PORT env to change)
npm run db:seed    # reset the database from data/artists.json (or: npm run db:seed -- path/to/file.json)
npm run build:pages # static build for GitHub Pages (no server needed, see below)
```

## GitHub Pages

GitHub Pages only serves static files, so it can't run the Express API (and the repository's `index.html`
is the unbuilt Vite entry point – serving it directly gives a blank page). `npm run build:pages` builds
in `pages` mode: the game logic runs in the browser ([`src/staticApi.ts`](src/staticApi.ts), bundled with
`data/artists.json`) and assets are served from `/spotleHungary/` (override with `VITE_BASE`).

[`.github/workflows/deploy.yml`](.github/workflows/deploy.yml) tests, builds and deploys on every push to
`main`. In the repository settings set **Pages → Build and deployment → Source** to **GitHub Actions**.
Note that in the static build the artist data (including answers) is visible to anyone who inspects
the page; the admin API is not available.

## Artist data

> `data/artists.json` contains **413 Hungarian artists**. The artist pool comes from the
> Hungarian Spotify charts on [kworb.net](https://kworb.net/spotify/country/hu_daily.html) (daily chart + all-time
> daily/weekly totals), plus retro/"oldies" acts from the
> [103 népszerű retro magyar dal](http://reginagyslagerek.network.hu/blog/regi-nagy-slagerek-blogja/103-nepszeru-retro-magyar-dal)
> list, the [zeneszoveg.hu](https://www.zeneszoveg.hu/toplist.php) performer toplist and a hand-made list of
> well-known retro-radio acts (jeje.hu's list is behind a bot check). Oldies were matched to Spotify profiles with
> the Spotify Web API search (checking that the profile's tracks are Hungarian). `monthlyListeners` and `imageUrl`
> come from the artists' Spotify profiles. Attributes were compiled from Hungarian Wikipedia, Wikidata and
> MusicBrainz, and hints deliberately avoid each artist's biggest hits/albums. Attributes that couldn't be verified
> are `null` (shown as "?" tiles); medium/low-confidence entries are worth a manual check.

Each entry:

```jsonc
{
  "name": "Tankcsapda",
  "debutYear": 1989,
  "members": 3,
  "gender": "male",              // male | female | mixed
  "genre": "Rock",
  "city": "Debrecen",
  "region": "Észak-Alföld",      // see REGIONS in shared/types.ts
  "monthlyListeners": 330000,    // popularity rank is computed from this
  "imageUrl": null,
  "hint1Type": "song",
  "hint1": "Mennyország Tourist",
  "hint2Type": "member",
  "hint2": "Lukács László",
  "hint3Type": "initials",
  "hint3": null                  // initials may be left null – derived from the name
}
```

Hint types (labels in `HINT_TYPES`, [`shared/types.ts`](shared/types.ts)): `song` (Dal), `album`,
`collab` (Közös munka), `initials` (Kezdőbetűk), `member` (Tag / alapító), `lyric` (Dalszöveg-részlet),
`award` (Díj), `trivia` (Érdekesség). Unknown types are allowed and shown with their raw name. A hint
slot may be empty (both fields `null`); a value always needs a type. Databases from the earlier
`topSong` schema are migrated automatically (the song becomes hint 1).

`debutYear`, `members`, `gender`, `genre`, `city` and `region` may be `null` when unknown (schema v3; older
databases are migrated automatically). Extra retro genres: Beat, Diszkó, Sanzon, Kabaré.

Valid regions: Közép-Magyarország, Közép-Dunántúl, Nyugat-Dunántúl, Dél-Dunántúl, Észak-Magyarország,
Észak-Alföld, Dél-Alföld, Határon túl, Külföld.

After editing the JSON run `npm run db:seed`. Note: the daily answer order is a deterministic shuffle of the
artist pool, so changing the pool changes which artist belongs to which day.

Schema v4 adds an optional `spotifyId` (the artist's Spotify ID, used by the admin portal to refresh data).

### Admin portal

A local web UI for browsing, editing, deleting and adding artists, with optional AI-assisted filling of
selected rows. It is **not** part of the GitHub Pages build.

1. Create a `.env` file in the repository root (it is git-ignored):

   | Variable | |
   |---|---|
   | `ADMIN_TOKEN` | required – password of the portal / admin API |
   | `SPOTIFY_CLIENT_ID`, `SPOTIFY_CLIENT_SECRET` | optional – [Spotify app](https://developer.spotify.com/dashboard) credentials for search and release dates |
   | `AI_MODEL` | optional – Copilot model name (default: Copilot's default) |
   | `COPILOT_GITHUB_TOKEN` | optional – GitHub token for Copilot; otherwise the logged-in Copilot CLI user is used |
   | `AI_DISABLED=1` | turn the AI off |
   | `EXPORT_SEED=0` | don't write changes back to `data/artists.json` |

2. AI filling uses GitHub Copilot through [`@github/copilot-sdk`](https://github.com/github/copilot-sdk) (needs a
   Copilot subscription). Log in once with `npx @github/copilot login`.
3. Run `npm run dev` and open <http://localhost:5173/admin> (or `npm run build && npm start` →
   <http://localhost:3001/admin>).

Every change is written to the database **and** to `data/artists.json`, so commit and push the JSON to
update the GitHub Pages version.

How the "fill" proposals work (nothing is saved until you accept them in the review panel):

- **Spotify ID** – looked up on Wikidata (P1902) and MusicBrainz first (limited to Hungarian/neighbouring
  countries), falling back to Spotify search.
- **Monthly listeners and image** – read from the public Spotify artist page.
- **Debut year** – the year of the oldest release on Spotify, only used when the year is missing or the
  Spotify year is *earlier* (reissues and compilations make Spotify's oldest release unreliable for oldies).
- **Other attributes and hints** – Spotify's API does not expose the artist biography, so the AI reads the
  Hungarian/English Wikipedia articles (and Spotify releases/top tracks). Each hint must cite a verbatim quote
  from these sources; hints whose quote or title can't be found there are dropped and shown as warnings.

Spotify apps in development mode have a low rate limit. When Spotify answers with a long `Retry-After`
(it can be ~24 hours), the portal shows ⏳ and skips Spotify-API-based data until then; listeners and images
still work.

### Admin API

Like the original [spotle-backend](https://github.com/alexski/spotle-backend), artists can be managed over
REST. Set `ADMIN_TOKEN` and send `Authorization: Bearer <token>`:

| Method | Path | |
|---|---|---|
| GET | `/api/admin/artists` | list all (with rank) |
| GET | `/api/admin/artists/:id` | get one |
| POST | `/api/admin/artists` | create |
| PUT | `/api/admin/artists/:id` | update |
| DELETE | `/api/admin/artists/:id` | delete |
| POST | `/api/admin/reseed` | reload from `data/artists.json` |
| GET | `/api/admin/meta` | regions, genres, hint types, Spotify/AI status |
| GET | `/api/admin/spotify/search?q=` | search Spotify artists |
| POST | `/api/admin/propose` | `{ artistId?, name?, spotifyId?, ai? }` → suggested values (not saved) |

### Public game API

`GET /api/artists` (id + name for autocomplete), `GET /api/puzzles/daily`, `GET /api/puzzles/practice`,
`POST /api/puzzles/:id/guess` `{ "artistId": 1 }`, `GET /api/puzzles/:id/hints` (available hint
types, no values), `GET /api/puzzles/:id/hints/:slot?guesses=n` (reveals one hint; `403` below 7 guesses),
`GET /api/puzzles/:id/answer`. Puzzle ids are `d<n>` (daily #n) or `p<seed>` (practice). The API is
stateless, so the "only one hint" rule is enforced by the client.
