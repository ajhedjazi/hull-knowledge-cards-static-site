import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { routes } from "../src/data/routes.js";

const ROUTING_API_BASE_URL = "https://router.project-osrm.org";
const LATITUDE_KM = 111;
const LONGITUDE_KM = 66;
const SNAP_RADIUS_METRES = 250;
const CORRECT_SLOTS = [1, 3, 0, 2, 1, 3, 0, 2];
const MANUAL_VIA_POINTS = {
  "hri-to-the-deep": [
    [
      [53.7488, -0.3505],
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
    radiuses: points.map(() => SNAP_RADIUS_METRES).join(";"),
  });

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

function roadNames(candidate) {
  const names = [];

  for (const step of routeSteps(candidate)) {
    const name = step.name?.trim();

    if (
      name &&
      step.distance >= 35 &&
      names[names.length - 1] !== name
    ) {
      names.push(name);
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

function modelInstructions(candidate, route) {
  const steps = routeSteps(candidate);
  const instructions = [];
  let previousRoad = "";

  for (const step of steps) {
    const type = step.maneuver?.type;
    const modifier = step.maneuver?.modifier;
    const name = step.name?.trim();

    if (type === "arrive") continue;
    if (!name || step.distance < 35 || name === previousRoad) continue;

    if (!instructions.length) {
      instructions.push(`Leave ${route.startName} and join ${name}.`);
    } else if (type === "roundabout" || type === "rotary") {
      const exit = step.maneuver?.exit;
      instructions.push(
        `At the roundabout, take${exit ? ` exit ${exit}` : " the appropriate exit"} onto ${name}.`,
      );
    } else if (type === "end of road") {
      instructions.push(
        `At the end of the road, ${turnPhrase(modifier)} onto ${name}.`,
      );
    } else if (type === "fork") {
      instructions.push(`Keep ${modifier || "ahead"} onto ${name}.`);
    } else if (type === "on ramp" || type === "off ramp") {
      instructions.push(
        `Take the ${modifier || ""} slip road onto ${name}.`.replace(
          /\s+/g,
          " ",
        ),
      );
    } else if (type === "turn") {
      instructions.push(
        `${turnPhrase(modifier)[0].toUpperCase()}${turnPhrase(modifier).slice(1)} onto ${name}.`,
      );
    } else {
      instructions.push(`Continue onto ${name}.`);
    }

    previousRoad = name;
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
  const maximumUsefulDistance = orderedCandidates[0].distance * 1.7;
  const directGeometries = new Set(
    directCandidates.map((candidate) => candidate.geometry),
  );
  const selectedCandidates = [];
  const selectedGeometries = new Set();
  const selectedRoadSignatures = new Set();

  for (const candidate of orderedCandidates) {
    const roads = roadNames(candidate);
    const signature = roads.join("|");
    const hasRepeatedRoad = new Set(roads).size !== roads.length;

    if (
      candidate.distance <= maximumUsefulDistance &&
      signature &&
      !selectedRoadSignatures.has(signature) &&
      (!hasRepeatedRoad || directGeometries.has(candidate.geometry))
    ) {
      selectedCandidates.push(candidate);
      selectedGeometries.add(candidate.geometry);
      selectedRoadSignatures.add(signature);
    }

    if (selectedCandidates.length === 4) break;
  }

  for (const candidate of orderedCandidates) {
    if (
      selectedCandidates.length < 4 &&
      candidate.distance <= maximumUsefulDistance &&
      !selectedGeometries.has(candidate.geometry)
    ) {
      selectedCandidates.push(candidate);
      selectedGeometries.add(candidate.geometry);
    }
  }

  for (const candidate of orderedCandidates) {
    if (
      selectedCandidates.length < 4 &&
      !selectedGeometries.has(candidate.geometry)
    ) {
      selectedCandidates.push(candidate);
      selectedGeometries.add(candidate.geometry);
    }
  }

  const shortestCandidates = selectedCandidates
    .sort((left, right) => left.distance - right.distance)
    .slice(0, 4);

  if (shortestCandidates.length < 4) {
    throw new Error(`Only found ${shortestCandidates.length} routes for ${route.id}`);
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
