const GENERIC_ROAD_WORDS = new Set([
  "a",
  "the",
  "road",
  "street",
  "avenue",
  "lane",
  "way",
  "drive",
  "close",
  "place",
]);

const SPOKEN_ROAD_ALIASES = {
  a63: ["a 63", "a sixty three", "a six three"],
  a1033: ["a 1033", "a ten thirty three", "a one zero three three"],
  a1105: ["a 1105", "a eleven oh five", "a one one zero five"],
  ferensway: ["ferens way", "ferrens way"],
  "st peter street": ["saint peter street", "st peters street"],
  "st johns grove": ["saint johns grove", "st johns grove"],
};

export function normaliseSpeech(value) {
  return value
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[’']/g, "")
    .replace(/\bsaint\b/g, "st")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function editDistance(left, right) {
  const previous = Array.from(
    { length: right.length + 1 },
    (_, index) => index,
  );

  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    const current = [leftIndex];

    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      current[rightIndex] = Math.min(
        current[rightIndex - 1] + 1,
        previous[rightIndex] + 1,
        previous[rightIndex - 1] +
          (left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1),
      );
    }

    previous.splice(0, previous.length, ...current);
  }

  return previous[right.length];
}

function tokenMatches(spokenToken, roadToken) {
  if (spokenToken === roadToken) return true;
  if (roadToken.length <= 3) return false;

  const tolerance = roadToken.length >= 8 ? 2 : 1;
  return editDistance(spokenToken, roadToken) <= tolerance;
}

function roadAliases(road) {
  const normalisedRoad = normaliseSpeech(road);
  return [
    normalisedRoad,
    ...(SPOKEN_ROAD_ALIASES[normalisedRoad] || []),
  ].map(normaliseSpeech);
}

function findRoadPosition(transcript, road) {
  const normalisedTranscript = normaliseSpeech(transcript);
  const transcriptTokens = normalisedTranscript.split(" ").filter(Boolean);
  const transcriptTokenOffsets = [];
  let transcriptOffset = 0;

  for (const token of transcriptTokens) {
    transcriptTokenOffsets.push(transcriptOffset);
    transcriptOffset += token.length + 1;
  }

  for (const alias of roadAliases(road)) {
    const exactPosition = normalisedTranscript.indexOf(alias);
    if (exactPosition >= 0) return exactPosition;
  }

  const importantTokens = normaliseSpeech(road)
    .split(" ")
    .filter((token) => !GENERIC_ROAD_WORDS.has(token));

  if (!importantTokens.length) return -1;

  for (
    let startIndex = 0;
    startIndex < transcriptTokens.length;
    startIndex += 1
  ) {
    let transcriptIndex = startIndex;
    let matched = true;

    for (const roadToken of importantTokens) {
      let tokenPosition = -1;
      const maximumIndex = Math.min(
        transcriptTokens.length,
        transcriptIndex + 4,
      );

      for (
        let candidateIndex = transcriptIndex;
        candidateIndex < maximumIndex;
        candidateIndex += 1
      ) {
        if (tokenMatches(transcriptTokens[candidateIndex], roadToken)) {
          tokenPosition = candidateIndex;
          break;
        }
      }

      if (tokenPosition < 0) {
        matched = false;
        break;
      }

      transcriptIndex = tokenPosition + 1;
    }

    if (matched) return transcriptTokenOffsets[startIndex];
  }

  return -1;
}

function longestIncreasingSequence(values) {
  const lengths = values.map(() => 1);

  for (let current = 0; current < values.length; current += 1) {
    for (let previous = 0; previous < current; previous += 1) {
      if (values[previous] < values[current]) {
        lengths[current] = Math.max(
          lengths[current],
          lengths[previous] + 1,
        );
      }
    }
  }

  return lengths.length ? Math.max(...lengths) : 0;
}

function countMatches(value, pattern) {
  return value.match(pattern)?.length || 0;
}

function expectedDirectionCounts(maneuvers) {
  const counts = {
    left: 0,
    right: 0,
    roundabout: 0,
    endOfRoad: 0,
  };

  for (const maneuver of maneuvers.slice(1)) {
    if (
      maneuver.maneuverType === "roundabout" ||
      maneuver.maneuverType === "rotary" ||
      maneuver.maneuverType === "roundabout turn"
    ) {
      counts.roundabout += 1;
      continue;
    }

    if (maneuver.maneuverType === "end of road") {
      counts.endOfRoad += 1;
    }

    if (
      [
        "turn",
        "end of road",
        "fork",
        "merge",
        "on ramp",
        "off ramp",
        "continue",
      ].includes(maneuver.maneuverType)
    ) {
      if (maneuver.modifier?.includes("left")) counts.left += 1;
      if (maneuver.modifier?.includes("right")) counts.right += 1;
    }
  }

  return counts;
}

function spokenDirectionCounts(transcript) {
  const normalised = normaliseSpeech(transcript);

  return {
    left: countMatches(normalised, /\b(left|bear left|keep left)\b/g),
    right: countMatches(normalised, /\b(right|bear right|keep right)\b/g),
    roundabout: countMatches(normalised, /\broundabout\b/g),
    endOfRoad: countMatches(
      normalised,
      /\b(end of (the )?road|until (the )?road ends)\b/g,
    ),
  };
}

function routeDestinationMentioned(transcript, destination) {
  const normalisedTranscript = normaliseSpeech(transcript);
  const normalisedDestination = normaliseSpeech(destination);

  if (normalisedTranscript.includes(normalisedDestination)) return true;

  const importantDestinationTokens = normalisedDestination
    .split(" ")
    .filter((token) => !GENERIC_ROAD_WORDS.has(token));

  return importantDestinationTokens.every((token) =>
    normalisedTranscript.split(" ").some((spokenToken) =>
      tokenMatches(spokenToken, token),
    ),
  );
}

export function scoreRouteAnswer(transcript, option, destination) {
  const roadMatches = option.roads.map((road) => ({
    road,
    position: findRoadPosition(transcript, road),
  }));
  const matchedRoads = roadMatches.filter((match) => match.position >= 0);
  const missedRoads = roadMatches
    .filter((match) => match.position < 0)
    .map((match) => match.road);
  const roadCoverage = option.roads.length
    ? matchedRoads.length / option.roads.length
    : 0;
  const matchedPositions = matchedRoads.map((match) => match.position);
  const orderCoverage = matchedPositions.length
    ? longestIncreasingSequence(matchedPositions) / matchedPositions.length
    : 0;

  const expectedDirections = expectedDirectionCounts(option.maneuvers || []);
  const spokenDirections = spokenDirectionCounts(transcript);
  const expectedDirectionTotal = Object.values(expectedDirections).reduce(
    (total, count) => total + count,
    0,
  );
  const matchedDirectionTotal = Object.keys(expectedDirections).reduce(
    (total, key) =>
      total + Math.min(expectedDirections[key], spokenDirections[key]),
    0,
  );
  const directionCoverage = expectedDirectionTotal
    ? matchedDirectionTotal / expectedDirectionTotal
    : 1;
  const destinationMentioned = routeDestinationMentioned(
    transcript,
    destination,
  );
  const usedJunctionCount =
    /\b(first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|\d+(st|nd|rd|th))\b/.test(
      normaliseSpeech(transcript),
    );

  const total = Math.round(
    roadCoverage * 55 +
      orderCoverage * 15 +
      directionCoverage * 20 +
      (destinationMentioned ? 10 : 0),
  );
  const feedback = [];

  if (missedRoads.length) {
    feedback.push(
      `Roads not heard: ${missedRoads.slice(0, 4).join(", ")}${
        missedRoads.length > 4 ? ` and ${missedRoads.length - 4} more` : ""
      }.`,
    );
  }
  if (matchedRoads.length > 1 && orderCoverage < 1) {
    feedback.push("Some road names were said out of route order.");
  }
  if (spokenDirections.left < expectedDirections.left) {
    feedback.push(
      `Add ${expectedDirections.left - spokenDirections.left} more left-turn cue${
        expectedDirections.left - spokenDirections.left === 1 ? "" : "s"
      }.`,
    );
  }
  if (spokenDirections.right < expectedDirections.right) {
    feedback.push(
      `Add ${
        expectedDirections.right - spokenDirections.right
      } more right-turn cue${
        expectedDirections.right - spokenDirections.right === 1 ? "" : "s"
      }.`,
    );
  }
  if (
    expectedDirections.endOfRoad &&
    spokenDirections.endOfRoad < expectedDirections.endOfRoad
  ) {
    feedback.push('Use “at the end of the road” where the route requires it.');
  }
  if (!destinationMentioned) {
    feedback.push(`Finish by naming ${destination}.`);
  }
  if (!usedJunctionCount) {
    feedback.push(
      "No numbered junction was heard; add one where you can verify it on the map.",
    );
  }
  if (!feedback.length) {
    feedback.push(
      "Strong coverage of the route, turn language and destination.",
    );
  }

  return {
    total,
    label:
      total >= 85
        ? "Strong verbal route"
        : total >= 70
          ? "Nearly there"
          : "Needs another run",
    matchedRoads: matchedRoads.map((match) => match.road),
    missedRoads,
    roadCoverage: Math.round(roadCoverage * 100),
    orderCoverage: Math.round(orderCoverage * 100),
    directionCoverage: Math.round(directionCoverage * 100),
    destinationMentioned,
    usedJunctionCount,
    feedback,
  };
}
