// Small seeded PRNG (mulberry32) so a schedule can be reproduced from its seed.
export type Rng = () => number;

export const createRng = (seed: number): Rng => {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

export const randomSeed = (): number => (Math.random() * 0xffffffff) >>> 0;

export const randInt = (rng: Rng, n: number): number => Math.floor(rng() * n);

export const shuffleInPlace = <T>(rng: Rng, arr: T[]): T[] => {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
};
