import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

// Load local secrets (ADMIN_TOKEN, SPOTIFY_CLIENT_ID/SECRET, AI_MODEL, ...) before the modules read them.
const envFile = resolve(process.cwd(), '.env');
if (existsSync(envFile)) process.loadEnvFile(envFile);

const { createApp } = await import('./app.ts');
const { ArtistRepository, SEED_PATH } = await import('./db.ts');
const { CopilotAi } = await import('./ai.ts');
const { Enricher } = await import('./enrich.ts');
const { MusicBrainz } = await import('./musicbrainz.ts');
const { SpotifyClient } = await import('./spotify.ts');
const { Wikipedia } = await import('./wiki.ts');

const port = Number(process.env.PORT ?? 3001);
const repo = ArtistRepository.open();
const wiki = new Wikipedia();
const ai = process.env.AI_DISABLED === '1' ? null : CopilotAi.fromEnv(wiki);
const enricher = new Enricher(SpotifyClient.fromEnv(), wiki, ai, new MusicBrainz());
// Admin edits are written back to data/artists.json (the source of the GitHub Pages build).
const exportPath = process.env.EXPORT_SEED === '0' ? undefined : SEED_PATH;

createApp(repo, { enricher, exportPath }).listen(port, () => {
  console.log(`Spotle HU API listening on http://localhost:${port} (${repo.count()} artists)`);
  if (!process.env.ADMIN_TOKEN) console.log('Admin portal disabled: set ADMIN_TOKEN in .env');
});
