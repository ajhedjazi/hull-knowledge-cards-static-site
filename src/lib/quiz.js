export function shuffle(items) {
  const result = [...items];

  for (let index = result.length - 1; index > 0; index -= 1) {
    const randomIndex = Math.floor(Math.random() * (index + 1));
    [result[index], result[randomIndex]] = [result[randomIndex], result[index]];
  }

  return result;
}

export function normaliseAnswer(value) {
  return value
    .toLowerCase()
    .replace(/[’']/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

export function buildQuestion(card, cards, optionCount = 4) {
  const sameCategory = cards
    .filter(
      (candidate) =>
        candidate.category === card.category &&
        normaliseAnswer(candidate.location) !== normaliseAnswer(card.location),
    )
    .map((candidate) => candidate.location);

  const otherLocations = cards
    .filter(
      (candidate) =>
        normaliseAnswer(candidate.location) !== normaliseAnswer(card.location),
    )
    .map((candidate) => candidate.location);

  const distractors = Array.from(
    new Set([...shuffle(sameCategory), ...shuffle(otherLocations)]),
  );

  return {
    card,
    options: shuffle([
      card.location,
      ...distractors.slice(0, Math.max(0, optionCount - 1)),
    ]),
  };
}

export function buildQuiz(sourceCards, allCards, questionCount) {
  return shuffle(sourceCards)
    .slice(0, Math.min(questionCount, sourceCards.length))
    .map((card) => buildQuestion(card, allCards));
}
