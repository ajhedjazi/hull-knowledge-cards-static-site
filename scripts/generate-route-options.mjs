import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { routes } from "../src/data/routes.js";

const ROUTING_API_BASE_URL =
  process.env.OSRM_BASE_URL || "https://router.project-osrm.org";
const LATITUDE_KM = 111;
const LONGITUDE_KM = 66;
const SNAP_RADIUS_METRES = 150;
const CORRECT_SLOTS = [1, 3, 0, 2, 1, 3, 0, 2];
const MANUAL_VIA_POINTS = {
  "hri-to-the-deep": [
    [
      [53.748623, -0.347013],
      [53.7484, -0.341],
      [53.7448, -0.3325],
    ],
  ],
  "costello-to-mkm": [
    [
      [53.74987, -0.39511],
      [53.75078, -0.37297],
      [53.7472, -0.37457],
    ],
    [
      [53.754, -0.394],
      [53.7508, -0.373],
      [53.7472, -0.3746],
    ],
    [
      [53.75266, -0.40795],
      [53.755, -0.39],
      [53.7508, -0.373],
      [53.7472, -0.3746],
    ],
  ],
  "hull-minster-to-pearson-park": [
    [[53.7558251, -0.3589098]],
  ],
  "the-deep-to-east-park": [
    [
      [53.750258, -0.328837],
      [53.753806, -0.319714],
    ],
  ],
  "mkm-to-hull-minster": [
    [[53.742278, -0.351135]],
    [
      [53.74204, -0.353872],
      [53.742278, -0.351135],
    ],
  ],
};
const ALLOWED_REPEAT_ROADS = {
  "hull-minster-to-pearson-park": ["Princes Avenue"],
};
const ALLOWED_UTURN_ROADS = {
  "mkm-to-hull-minster": ["Anlaby Road"],
};
const outputPath = fileURLToPath(
  new URL("../src/data/routeOptions.generated.json", import.meta.url),
);

function interpolate(start, end, progress) {
  return start + (end - start) * progress;
}

function detourPoints(route, offsetKm, positions = [0.5]) {
  const [startLatitude, startLongitude] = route.start;
  const [endLatitude, endLongitude] = route.end;
  const horizontalKm =
    (endLongitude - startLongitude) * LONGITUDE_KM;
  const verticalKm = (endLatitude - startLatitude) * LATITUDE_KM;
  const routeLengthKm = Math.hypot(horizontalKm, verticalKm);
  const perpendicularHorizontal = -verticalKm / routeLengthKm;
  const perpendicularVertical = horizontalKm / routeLengthKm;

  const detours = positions.map((position) => [
    interpolate(startLatitude, endLatitude, position) +
      (perpendicularVertical * offsetKm) / LATITUDE_KM,
    interpolate(startLongitude, endLongitude, position) +
      (perpendicularHorizontal * offsetKm) / LONGITUDE_KM,
  ]);

  return [route.start, ...detours, route.end];
}

function buildRouteUrl(points, alternatives = 0) {
  const coordinates = points
    .map(([latitude, longitude]) => `${longitude},${latitude}`)
    .join(";");
  const query = new URLSearchParams({
    alternatives: String(alternatives),
    steps: "true",
    geometries: "polyline6",
    overview: "full",
    annotations: "nodes",
    continue_straight: "true",
    radiuses: points.map(() => SNAP_RADIUS_METRES).join(";"),
  });

  if (points.length > 2) {
    query.set("waypoints", `0;${points.length - 1}`);
  }

  return `${ROUTING_API_BASE_URL}/route/v1/driving/${coordinates}?${query}`;
}

async function requestRoutes(points, alternatives = 0) {
  const response = await fetch(buildRouteUrl(points, alternatives));

  if (!response.ok) {
    throw new Error(`Routing request failed with ${response.status}`);
  }

  const result = await response.json();

  if (result.code !== "Ok" || !result.routes?.length) {
    throw new Error(`Routing request returned ${result.code || "no route"}`);
  }

  return result.routes;
}

function routeSteps(candidate) {
  return candidate.legs.flatMap((leg) => leg.steps);
}

function roadName(step) {
  return (step.name || step.ref || "").replace(/\s+/g, " ").trim();
}

function meaningfulSteps(candidate) {
  const steps = [];
  let previousRoad = "";

  for (const step of routeSteps(candidate)) {
    const name = roadName(step);
    const type = step.maneuver?.type;

    if (!name || type === "arrive" || type === "notification") continue;
    if (name === previousRoad && type !== "roundabout" && type !== "rotary") {
      continue;
    }

    steps.push({
      road: name,
      distanceMetres: Math.round(step.distance),
      maneuverType: type || "continue",
      modifier: step.maneuver?.modifier || "straight",
      exit: step.maneuver?.exit || null,
    });
    previousRoad = name;
  }

  return steps;
}

function roadNames(candidate) {
  const names = [];

  for (const step of meaningfulSteps(candidate)) {
    if (names[names.length - 1] !== step.road) {
      names.push(step.road);
    }
  }

  return names;
}

function turnPhrase(modifier) {
  const phrases = {
    left: "turn left",
    right: "turn right",
    "slight left": "bear left",
    "slight right": "bear right",
    "sharp left": "turn sharply left",
    "sharp right": "turn sharply right",
    straight: "continue straight",
    uturn: "make a U-turn",
  };

  return phrases[modifier] || "continue";
}

function ordinal(number) {
  const remainder100 = number % 100;

  if (remainder100 >= 11 && remainder100 <= 13) {
    return `${number}th`;
  }

  const suffixes = { 1: "st", 2: "nd", 3: "rd" };
  return `${number}${suffixes[number % 10] || "th"}`;
}

function capitalise(value) {
  return `${value[0].toUpperCase()}${value.slice(1)}`;
}

function directionSide(modifier) {
  if (modifier?.includes("left")) return "left";
  if (modifier?.includes("right")) return "right";
  return "";
}

function modelInstructions(candidate, route) {
  const steps = meaningfulSteps(candidate);
  const instructions = [];

  for (const [stepIndex, step] of steps.entries()) {
    const type = step.maneuverType;
    const modifier = step.modifier;
    const name = step.road;

    if (stepIndex === 0) {
      instructions.push(`Leave ${route.startName} and follow ${name}.`);
    } else if (
      type === "roundabout" ||
      type === "rotary" ||
      type === "roundabout turn"
    ) {
      instructions.push(
        `At the roundabout, take ${
          step.exit ? `the ${ordinal(step.exit)} exit` : "the appropriate exit"
        } onto ${name}.`,
      );
    } else if (type === "end of road") {
      instructions.push(
        `At the end of the road, ${turnPhrase(modifier)} onto ${name}.`,
      );
    } else if (type === "fork") {
      const side = directionSide(modifier);
      instructions.push(
        `Keep ${side || "ahead"} and continue onto ${name}.`,
      );
    } else if (type === "on ramp" || type === "off ramp") {
      const side = directionSide(modifier);
      instructions.push(
        `Take the ${side ? `${side} ` : ""}slip road onto ${name}.`.replace(
          /\s+/g,
          " ",
        ),
      );
    } else if (type === "merge") {
      const side = directionSide(modifier);
      instructions.push(
        side
          ? `Bear ${side} and merge onto ${name}.`
          : `Merge onto ${name}.`,
      );
    } else if (type === "new name") {
      instructions.push(`Continue as the road becomes ${name}.`);
    } else if (type === "turn") {
      instructions.push(`${capitalise(turnPhrase(modifier))} onto ${name}.`);
    } else if (
      type === "continue" &&
      modifier &&
      modifier !== "straight"
    ) {
      instructions.push(`${capitalise(turnPhrase(modifier))} onto ${name}.`);
    } else {
      instructions.push(`Continue onto ${name}.`);
    }
  }

  instructions.push(`Continue until you reach ${route.endName}.`);
  return instructions;
}

function compactCandidate(candidate, route) {
  return {
    geometry: candidate.geometry,
    distanceMetres: Math.round(candidate.distance),
    durationSeconds: Math.round(candidate.duration),
    roads: roadNames(candidate),
    maneuvers: meaningfulSteps(candidate),
    instructions: modelInstructions(candidate, route),
  };
}

async function candidatesForRoute(route) {
  const directCandidates = await requestRoutes([route.start, route.end], 3);
  const candidateGroups = [directCandidates];
  const detours = [
    [0.24, [0.5]],
    [-0.24, [0.5]],
    [0.4, [0.5]],
    [-0.4, [0.5]],
    [0.6, [0.5]],
    [-0.6, [0.5]],
    [0.85, [0.5]],
    [-0.85, [0.5]],
    [1.1, [0.5]],
    [-1.1, [0.5]],
    [1.4, [0.5]],
    [-1.4, [0.5]],
    [0.55, [0.35, 0.7]],
    [-0.55, [0.35, 0.7]],
    [0.9, [0.35, 0.7]],
    [-0.9, [0.35, 0.7]],
    [1.2, [0.3, 0.72]],
    [-1.2, [0.3, 0.72]],
    [1.6, [0.3, 0.72]],
    [-1.6, [0.3, 0.72]],
  ];

  for (const [offsetKm, positions] of detours) {
    try {
      candidateGroups.push(
        await requestRoutes(detourPoints(route, offsetKm, positions)),
      );
    } catch {
      // Some generated points can land over the Humber or outside the road
      // network. They are exploratory only, so skip them.
    }
  }

  for (const viaPoints of MANUAL_VIA_POINTS[route.id] || []) {
    candidateGroups.push(
      await requestRoutes([route.start, ...viaPoints, route.end]),
    );
  }

  const candidatesByGeometry = new Map();

  for (const candidate of candidateGroups.flat()) {
    candidatesByGeometry.set(candidate.geometry, candidate);
  }

  const orderedCandidates = [...candidatesByGeometry.values()].sort(
    (left, right) => left.distance - right.distance,
  );
  const maximumUsefulDistance = orderedCandidates[0].distance * 2;
  const selectedCandidates = [];
  const selectedRoadSignatures = new Set();
  const allowedRepeatedRoads = new Set();
  const allowedUTurnRoads = new Set();

  for (const road of ALLOWED_REPEAT_ROADS[route.id] || []) {
    allowedRepeatedRoads.add(road.toLowerCase());
  }

  for (const road of ALLOWED_UTURN_ROADS[route.id] || []) {
    allowedUTurnRoads.add(road.toLowerCase());
  }

  for (const candidate of directCandidates) {
    const directRoads = roadNames(candidate).map((road) => road.toLowerCase());
    const roadCounts = new Map();

    for (const road of directRoads) {
      roadCounts.set(road, (roadCounts.get(road) || 0) + 1);
    }

    for (const [road, count] of roadCounts) {
      if (count > 1) allowedRepeatedRoads.add(road);
    }

    for (const step of routeSteps(candidate)) {
      if (step.maneuver?.modifier === "uturn") {
        allowedUTurnRoads.add(roadName(step).toLowerCase());
      }
    }
  }

  for (const candidate of orderedCandidates) {
    const roads = roadNames(candidate);
    const normalisedRoads = roads.map((road) => road.toLowerCase());
    const signature = normalisedRoads.join("|");
    const roadCounts = new Map();

    for (const road of normalisedRoads) {
      roadCounts.set(road, (roadCounts.get(road) || 0) + 1);
    }

    const hasUnexplainedRepeatedRoad = [...roadCounts].some(
      ([road, count]) => count > 1 && !allowedRepeatedRoads.has(road),
    );
    const hasUnexplainedUTurn = routeSteps(candidate).some(
      (step) =>
        step.maneuver?.modifier === "uturn" &&
        !allowedUTurnRoads.has(roadName(step).toLowerCase()),
    );

    if (
      candidate.distance <= maximumUsefulDistance &&
      signature &&
      !selectedRoadSignatures.has(signature) &&
      !hasUnexplainedRepeatedRoad &&
      !hasUnexplainedUTurn
    ) {
      selectedCandidates.push(candidate);
      selectedRoadSignatures.add(signature);
    }

    if (selectedCandidates.length === 4) break;
  }

  const shortestCandidates = selectedCandidates
    .sort((left, right) => left.distance - right.distance)
    .slice(0, 4);

  if (shortestCandidates.length < 4) {
    const discoveredSignatures = orderedCandidates
      .map(
        (candidate) => {
          const candidateRoads = roadNames(candidate).map((road) =>
            road.toLowerCase(),
          );
          const repeats =
            new Set(candidateRoads).size !== candidateRoads.length;
          const uturn = routeSteps(candidate).some(
            (step) => step.maneuver?.modifier === "uturn",
          );
          const uturnDetails = routeSteps(candidate)
            .filter((step) => step.maneuver?.modifier === "uturn")
            .map(
              (step) =>
                `${roadName(step) || "(unnamed)"}:${Math.round(step.distance)}m`,
            )
            .join(",");
          return `${(candidate.distance / 1000).toFixed(
            2,
          )} km · repeat=${repeats} uturn=${uturn}${
            uturnDetails ? `(${uturnDetails})` : ""
          } · ${roadNames(
            candidate,
          ).join(" → ")}`;
        },
      )
      .filter(Boolean);
    throw new Error(
      `Only found ${shortestCandidates.length} distinct sensible routes for ${
        route.id
      }:\n${discoveredSignatures.join("\n")}`,
    );
  }

  return shortestCandidates;
}

const routeOptions = {};

for (const [routeIndex, route] of routes.entries()) {
  const candidates = await candidatesForRoute(route);
  const correctCandidate = candidates[0];
  const correctSlot = CORRECT_SLOTS[routeIndex];
  const arranged = Array(4);
  arranged[correctSlot] = correctCandidate;

  let alternativeIndex = 1;

  for (let slot = 0; slot < arranged.length; slot += 1) {
    if (!arranged[slot]) {
      arranged[slot] = candidates[alternativeIndex];
      alternativeIndex += 1;
    }
  }

  const options = arranged.map((candidate, optionIndex) => ({
    id: String.fromCharCode(65 + optionIndex),
    ...compactCandidate(candidate, route),
  }));

  routeOptions[route.id] = {
    correctOptionId: String.fromCharCode(65 + correctSlot),
    options,
  };

  console.log(
    route.id,
    options.map((option) => `${option.id}: ${(option.distanceMetres / 1000).toFixed(2)} km`),
    `correct: ${routeOptions[route.id].correctOptionId}`,
  );
}

await writeFile(outputPath, `${JSON.stringify(routeOptions, null, 2)}\n`);
