import { createApp } from './app.ts';
import { ArtistRepository } from './db.ts';

const port = Number(process.env.PORT ?? 3001);
const repo = ArtistRepository.open();
createApp(repo).listen(port, () => {
  console.log(`Spotle HU API listening on http://localhost:${port} (${repo.count()} artists)`);
});
