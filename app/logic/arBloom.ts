export type BloomInstance = {
  id: string;
  index: number;
  anchorIndex: number;
  revealAt: number;
  size: number;
};

// Spread the selected GLBs across the visible surface. Opening the palm
// reveals more copies instead of scaling the completed MUSE itself.
export function planBloomInstances(ids: string[], anchorCount: number): BloomInstance[] {
  if (!ids.length || anchorCount < 1) return [];
  const total = Math.max(ids.length, 7);
  return Array.from({ length: total }, (_, index) => ({
    id: ids[index % ids.length],
    index,
    anchorIndex: index % anchorCount,
    revealAt: index * .9 / total,
    size: .58 + (index % 3) * .08,
  }));
}
