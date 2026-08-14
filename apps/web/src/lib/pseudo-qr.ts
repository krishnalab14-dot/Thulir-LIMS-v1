/**
 * Deterministic 21×21 pseudo-QR grid derived from a seed string — a visual
 * PLACEHOLDER for the real public-verification QR (a later stage's concern).
 * Same seed → same grid, every time. Pure helper (no JSX) so it lives outside
 * the component files that render it.
 */

function mulberry32(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function pseudoQrCells(seed: string, size = 21): boolean[] {
  // FNV-1a hash of the seed → seeded PRNG (deterministic across reloads).
  let h = 2166136261 >>> 0;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  const rand = mulberry32(h >>> 0);

  const cells: boolean[] = new Array(size * size);
  for (let i = 0; i < cells.length; i++) {
    cells[i] = rand() > 0.52;
  }

  // Three 7×7 finder patterns (the classic QR corner rings) painted AFTER the
  // random fill so they are always visible — this is what makes the preview
  // read as a QR at a glance.
  const paintFinder = (fx: number, fy: number) => {
    for (let y = 0; y < 7; y++) {
      for (let x = 0; x < 7; x++) {
        const on = x === 0 || y === 0 || x === 6 || y === 6 || (x >= 2 && x <= 4 && y >= 2 && y <= 4);
        cells[(fy + y) * size + (fx + x)] = on;
      }
    }
  };
  paintFinder(0, 0);
  paintFinder(size - 7, 0);
  paintFinder(0, size - 7);

  return cells;
}
