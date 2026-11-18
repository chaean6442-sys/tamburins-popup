export type DesktopHandDetection = {
  landmarks: Array<{ x: number; y: number; z?: number }>;
  label: "Left" | "Right";
  confidence: number;
};

export type DesktopHandTrack = { x: number; y: number; lastAt: number };

const distance = (a: { x: number; y: number }, b: { x: number; y: number }) =>
  Math.hypot(a.x - b.x, a.y - b.y);

export function handCenter(hand: DesktopHandDetection) {
  const points = [0, 5, 9, 13, 17].map((index) => hand.landmarks[index]);
  return {
    x: points.reduce((sum, point) => sum + point.x, 0) / points.length,
    y: points.reduce((sum, point) => sum + point.y, 0) / points.length,
  };
}

export function assignDesktopHands(
  input: DesktopHandDetection[],
  tracks: [DesktopHandTrack, DesktopHandTrack],
  now: number,
): Array<{ slot: 0 | 1; hand: DesktopHandDetection; center: { x: number; y: number } }> {
  const candidates = input.filter((hand) => hand.landmarks?.length >= 21).map((hand) => ({
    hand,
    center: handCenter(hand),
    width: Math.max(0.035, distance(hand.landmarks[5], hand.landmarks[17])),
  }));
  // MediaPipe can report one physical hand twice with opposite handedness.
  // Both the palm and wrist must overlap before collapsing a pair.
  candidates.sort((a, b) => b.hand.confidence - a.hand.confidence);
  const distinct = candidates.filter((candidate, index, all) =>
    !all.slice(0, index).some((kept) => {
      const width = Math.max(candidate.width, kept.width);
      return distance(candidate.center, kept.center) < width * 1.2 &&
        distance(candidate.hand.landmarks[0], kept.hand.landmarks[0]) < width * 1.25;
    }),
  ).slice(0, 2);
  const hasFreshTrack = tracks.some((track) => track.lastAt > 0 && now - track.lastAt <= 650);
  const cost = (candidate: typeof distinct[number], slot: 0 | 1) => {
    const track = tracks[slot];
    const labelCost = candidate.hand.label === (slot === 0 ? "Left" : "Right") ? 0 : 0.11;
    if (track.lastAt === 0 || now - track.lastAt > 650) return labelCost + (hasFreshTrack ? 0.7 : 0);
    // Continuity matters more than one frame's handedness label, which may flip.
    return distance(candidate.center, track) + labelCost;
  };
  if (distinct.length === 0) return [];
  if (distinct.length === 1) {
    const candidate = distinct[0];
    const slot: 0 | 1 = cost(candidate, 0) <= cost(candidate, 1) ? 0 : 1;
    return [{ slot, hand: candidate.hand, center: candidate.center }];
  }
  const [a, b] = distinct;
  const direct = cost(a, 0) + cost(b, 1);
  const swapped = cost(a, 1) + cost(b, 0);
  return direct <= swapped
    ? [{ slot: 0, hand: a.hand, center: a.center }, { slot: 1, hand: b.hand, center: b.center }]
    : [{ slot: 1, hand: a.hand, center: a.center }, { slot: 0, hand: b.hand, center: b.center }];
}
