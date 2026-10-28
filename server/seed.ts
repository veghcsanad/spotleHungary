import { ArtistRepository, SEED_PATH } from './db.ts';

// Resets the database to the contents of data/artists.json (or the path given as argument).
const path = process.argv[2] ?? SEED_PATH;
const repo = ArtistRepository.open();
console.log(`Seeded ${repo.seedFromFile(path)} artists from ${path}`);
