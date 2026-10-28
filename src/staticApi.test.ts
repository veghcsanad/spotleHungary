import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../server/app.ts';
import { ArtistRepository } from '../server/db.ts';
import { staticApi } from './staticApi.ts';

describe('static (GitHub Pages) API', () => {
  const repo = ArtistRepository.open(':memory:');
  const app = createApp(repo, { staticDir: '__none__' });

  it('lists the same artists with the same ids as the seeded server', async () => {
    const server = await request(app).get('/api/artists');
    expect(await staticApi.artists()).toEqual(server.body);
  });

  it('picks the same answers and ranks as the server', async () => {
    for (const id of ['d1', 'p1', 'p42', 'p123456789']) {
      const server = await request(app).get(`/api/puzzles/${id}/answer`);
      expect(await staticApi.answer(id), id).toEqual(server.body);
    }
  });

  it('evaluates guesses like the server', async () => {
    const server = await request(app).post('/api/puzzles/p42/guess').send({ artistId: 5 });
    expect(await staticApi.guess('p42', 5)).toEqual(server.body);
  });

  it('rejects early hints and unknown puzzles', async () => {
    await expect(staticApi.revealHint('p1', 1, 3)).rejects.toThrow();
    await expect(staticApi.puzzle('x1')).rejects.toThrow();
  });
});
