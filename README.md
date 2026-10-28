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
```

## Artist data

> `data/artists.json` contains **379 Hungarian artists** (snapshot of 2026-10-28). The artist pool comes from the
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

### Public game API

`GET /api/artists` (id + name for autocomplete), `GET /api/puzzles/daily`, `GET /api/puzzles/practice`,
`POST /api/puzzles/:id/guess` `{ "artistId": 1 }`, `GET /api/puzzles/:id/hints` (available hint
types, no values), `GET /api/puzzles/:id/hints/:slot?guesses=n` (reveals one hint; `403` below 7 guesses),
`GET /api/puzzles/:id/answer`. Puzzle ids are `d<n>` (daily #n) or `p<seed>` (practice). The API is
stateless, so the "only one hint" rule is enforced by the client.
