import {
  COLLECTIONS,
  COLLECTION_RULES,
  COMBINATION_BONUSES,
  CollectionId,
  ObjectId,
} from "../data/experience";

export function scoreCollections(selected: ObjectId[]) {
  const scores = Object.keys(COLLECTIONS).reduce(
    (all, name) => ({ ...all, [name]: 0 }),
    {} as Record<CollectionId, number>,
  );

  selected.forEach((id) => {
    Object.entries(COLLECTION_RULES[id]).forEach(([name, points]) => {
      scores[name as CollectionId] += points ?? 0;
    });
  });

  const selectedSet = new Set(selected);
  const appliedBonuses = COMBINATION_BONUSES.filter((bonus) =>
    bonus.objects.every((id) => selectedSet.has(id)),
  );
  appliedBonuses.forEach((bonus) => {
    scores[bonus.collection] += bonus.points;
  });

  const winner = (Object.entries(scores) as [CollectionId, number][])
    .sort((a, b) => b[1] - a[1])[0][0];

  return { scores, winner, appliedBonuses };
}
