import { cursorGiveBack } from './keyword-cursor';

/**
 * Walk a campaign's rotation for `runs` runs and record which rotation positions were ever
 * PUBLISHED. Each run takes `perPost` slots from the cursor; pacing skips every slot at an
 * index in `skippedSlots` (it skips by position: the first slot takes the free booking).
 */
function publishedPositions(opts: {
  rotationLength: number; perPost: number; runs: number; skippedSlots: number[]; giveBack: boolean;
}): Set<number> {
  const published = new Set<number>();
  let cursor = 0;
  for (let run = 0; run < opts.runs; run++) {
    const base = cursor;
    cursor += opts.perPost; // the pre-run advance
    let skipped = 0;
    for (let i = 0; i < opts.perPost; i++) {
      if (opts.skippedSlots.includes(i)) { skipped++; continue; }
      published.add((base + i) % opts.rotationLength);
    }
    if (opts.giveBack) cursor -= cursorGiveBack(opts.perPost, skipped);
  }
  return published;
}

describe('handing back the keyword slots a run skipped', () => {
  describe('the arithmetic', () => {
    it('gives back every skipped slot', () => {
      expect(cursorGiveBack(2, 1)).toBe(1);
      expect(cursorGiveBack(3, 2)).toBe(2);
    });

    it('gives back nothing when nothing was skipped', () => {
      expect(cursorGiveBack(2, 0)).toBe(0);
    });

    it('never gives back more than the run advanced', () => {
      expect(cursorGiveBack(2, 5)).toBe(2);
    });

    it.each([
      ['negative', -1, 1],
      ['NaN', NaN, 1],
      ['fractional', 2.7, 1],
    ])('survives a %s input', (_label, perPost, skipped) => {
      expect(Number.isInteger(cursorGiveBack(perPost as number, skipped))).toBe(true);
      expect(cursorGiveBack(perPost as number, skipped)).toBeGreaterThanOrEqual(0);
    });
  });

  describe('the starvation it prevents', () => {
    // posts_per_run 1 plus a seasonal window's extra post = 2 slots; pacing always skips
    // the second. This is the US Pinterest campaign's actual run note.
    const overflowByOne = { perPost: 2, skippedSlots: [1], runs: 200 };

    it('WITHOUT the give-back, half an even-length rotation is never published', () => {
      const seen = publishedPositions({ ...overflowByOne, rotationLength: 20, giveBack: false });
      expect(seen.size).toBe(10);
      // Every odd position — whatever keyword sits there — is permanently silent.
      for (let p = 1; p < 20; p += 2) expect(seen.has(p)).toBe(false);
    });

    it('WITH the give-back, every position gets its turn', () => {
      const seen = publishedPositions({ ...overflowByOne, rotationLength: 20, giveBack: true });
      expect(seen.size).toBe(20);
    });

    it('covers an odd-length rotation too, where the old walk only got lucky', () => {
      const seen = publishedPositions({ ...overflowByOne, rotationLength: 21, giveBack: true });
      expect(seen.size).toBe(21);
    });

    it('changes nothing for a campaign whose runs never overflow', () => {
      const opts = { rotationLength: 20, perPost: 2, skippedSlots: [] as number[], runs: 50 };
      expect(publishedPositions({ ...opts, giveBack: true }))
        .toEqual(publishedPositions({ ...opts, giveBack: false }));
    });

    it('holds when a run overflows by more than one', () => {
      const seen = publishedPositions({
        rotationLength: 24, perPost: 3, skippedSlots: [1, 2], runs: 200, giveBack: true,
      });
      expect(seen.size).toBe(24);
    });
  });
});
