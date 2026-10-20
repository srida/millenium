// Import audio par lien YouTube : seule la FORME du lien est testable ici
// (le réseau de la CI n'atteint pas YouTube). C'est elle qui garantit que
// yt-dlp, qui lit des centaines de sites, ne reçoit jamais autre chose.
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const { isYoutubeUrl } = require('../../../youtube-audio.js');

describe('isYoutubeUrl', () => {
  it('accepte les formes de lien YouTube', () => {
    for (const u of [
      'https://www.youtube.com/watch?v=jNQXAC9IVRw',
      'https://youtu.be/jNQXAC9IVRw?si=abc',
      'https://m.youtube.com/watch?v=jNQXAC9IVRw',
      'https://music.youtube.com/watch?v=jNQXAC9IVRw',
      '  https://youtube.com/watch?v=x  ',
    ]) expect(isYoutubeUrl(u), u).toBe(true);
  });

  it('refuse tout le reste', () => {
    for (const u of [
      '', null, 'youtube.com/watch?v=x', 'file:///etc/passwd',
      'https://vimeo.com/123', 'https://youtube.com.evil.example/x',
      'https://evil.example/?u=https://youtube.com', '--exec=id',
    ]) expect(isYoutubeUrl(u), String(u)).toBe(false);
  });
});
