import routeOptions from "../src/data/routeOptions.generated.json" with {
  type: "json",
};
import { routes } from "../src/data/routes.js";

const ROUTING_API_BASE_URL =
  process.env.OSRM_BASE_URL || "https://router.project-osrm.org";
const RUN_LIVE_CHECKS = process.argv.includes("--live");
const MAX_ENDPOINT_DISTANCE_METRES = 180;
const MAX_GEOMETRY_GAP_METRES = 600;
const MAX_DISTANCE_DIFFERENCE_RATIO = 0.04;
const ROAD_SAMPLE_LIMIT = 30;

function decodePolyline6(encoded) {
  const coordinates = [];
  const factor = 1e6;
  let index = 0;
  let latitude = 0;
  let longitude = 0;

  function decodeValue() {
    let result = 0;
    let shift = 0;
    let byte;

    do {
      byte = encoded.charCodeAt(index) - 63;
      index += 1;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);

    return result & 1 ? ~(result >> 1) : result >> 1;
  }

  while (index < encoded.length) {
    latitude += decodeValue();
    longitude += decodeValue();
    coordinates.push([latitude / factor, longitude / factor]);
  }

  return coordinates;
}

function distanceMetres(left, right) {
  const earthRadiusMetres = 6_371_000;
  const toRadians = (degrees) => (degrees * Math.PI) / 180;
  const latitudeDelta = toRadians(right[0] - left[0]);
  const longitudeDelta = toRadians(right[1] - left[1]);
  const leftLatitude = toRadians(left[0]);
  const rightLatitude = toRadians(right[0]);
  const haversine =
    Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(leftLatitude) *
      Math.cos(rightLatitude) *
      Math.sin(longitudeDelta / 2) ** 2;

  return (
    2 *
    earthRadiusMetres *
    Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine))
  );
}

function geometryLength(points) {
  return points
    .slice(1)
    .reduce(
      (total, point, index) =>
        total + distanceMetres(points[index], point),
      0,
    );
}

function maximumGap(points) {
  return points
    .slice(1)
    .reduce(
      (largest, point, index) =>
        Math.max(largest, distanceMetres(points[index], point)),
      0,
    );
}

function ordinal(number) {
  const remainder100 = number % 100;

  if (remainder100 >= 11 && remainder100 <= 13) {
    return `${number}th`;
  }

  const suffixes = { 1: "st", 2: "nd", 3: "rd" };
  return `${number}${suffixes[number % 10] || "th"}`;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function samplePoints(points) {
  if (points.length <= ROAD_SAMPLE_LIMIT) return points;

  const samples = [];
  const lastIndex = points.length - 1;

  for (let sampleIndex = 0; sampleIndex < ROAD_SAMPLE_LIMIT; sampleIndex += 1) {
    const pointIndex = Math.round(
      (sampleIndex / (ROAD_SAMPLE_LIMIT - 1)) * lastIndex,
    );
    samples.push(points[pointIndex]);
  }

  return samples;
}

async function verifyRoadMatch(routeId, optionId, points) {
  const samples = samplePoints(points);
  const coordinates = samples
    .map(([latitude, longitude]) => `${longitude},${latitude}`)
    .join(";");
  const query = new URLSearchParams({
    sources: "all",
    destinations: "0",
    annotations: "distance",
  });
  const response = await fetch(
    `${ROUTING_API_BASE_URL}/table/v1/driving/${coordinates}?${query}`,
  );

  const result = await response.json();
  assert(
    response.ok,
    `${routeId} Route ${optionId}: road-snap request returned ${
      response.status
    } (${result.message || result.code || "unknown error"})`,
  );
  assert(
    result.code === "Ok" && result.sources?.length === samples.length,
    `${routeId} Route ${optionId}: road-snap failed with ${
      result.code || "no match"
    }`,
  );
  assert(
    result.sources.every(Boolean),
    `${routeId} Route ${optionId}: at least one geometry sample is not on the routable road network`,
  );

  const maximumRoadDeviation = Math.max(
    ...result.sources.map((tracepoint, index) =>
      distanceMetres(samples[index], [
        tracepoint.location[1],
        tracepoint.location[0],
      ]),
    ),
  );
  assert(
    maximumRoadDeviation <= 25,
    `${routeId} Route ${optionId}: a geometry sample is ${Math.round(
      maximumRoadDeviation,
    )}m from the routable road network`,
  );

  return maximumRoadDeviation;
}

let optionCount = 0;
const liveResults = [];

for (const route of routes) {
  const optionSet = routeOptions[route.id];
  assert(optionSet, `${route.id}: route options are missing`);
  assert(
    optionSet.options?.length === 4,
    `${route.id}: expected four route options`,
  );

  const optionIds = optionSet.options.map((option) => option.id);
  assert(
    new Set(optionIds).size === optionIds.length,
    `${route.id}: route option IDs are not unique`,
  );

  const roadSignatures = optionSet.options.map((option) =>
    option.roads.map((road) => road.toLowerCase()).join("|"),
  );
  assert(
    new Set(roadSignatures).size === roadSignatures.length,
    `${route.id}: two route options use the same road sequence`,
  );

  const shortestDistance = Math.min(
    ...optionSet.options.map((option) => option.distanceMetres),
  );
  const correctOption = optionSet.options.find(
    (option) => option.id === optionSet.correctOptionId,
  );
  assert(correctOption, `${route.id}: correct route option is missing`);
  assert(
    correctOption.distanceMetres === shortestDistance,
    `${route.id}: Route ${optionSet.correctOptionId} is not the shortest`,
  );

  for (const option of optionSet.options) {
    optionCount += 1;
    const points = decodePolyline6(option.geometry);
    assert(
      points.length >= 10,
      `${route.id} Route ${option.id}: geometry is too short`,
    );

    const startDistance = distanceMetres(route.start, points[0]);
    const endDistance = distanceMetres(route.end, points.at(-1));
    assert(
      startDistance <= MAX_ENDPOINT_DISTANCE_METRES,
      `${route.id} Route ${option.id}: starts ${Math.round(
        startDistance,
      )}m from the collection point`,
    );
    assert(
      endDistance <= MAX_ENDPOINT_DISTANCE_METRES,
      `${route.id} Route ${option.id}: ends ${Math.round(
        endDistance,
      )}m from the drop-off point`,
    );

    const measuredLength = geometryLength(points);
    const distanceDifferenceRatio =
      Math.abs(measuredLength - option.distanceMetres) /
      option.distanceMetres;
    assert(
      distanceDifferenceRatio <= MAX_DISTANCE_DIFFERENCE_RATIO,
      `${route.id} Route ${option.id}: geometry length differs from routing distance by ${(
        distanceDifferenceRatio * 100
      ).toFixed(1)}%`,
    );
    const largestGeometryGap = maximumGap(points);
    assert(
      largestGeometryGap <= MAX_GEOMETRY_GAP_METRES,
      `${route.id} Route ${option.id}: geometry contains a ${Math.round(
        largestGeometryGap,
      )}m gap`,
    );

    assert(
      option.roads.length >= 2,
      `${route.id} Route ${option.id}: road sequence is incomplete`,
    );
    assert(
      option.maneuvers?.length >= option.roads.length,
      `${route.id} Route ${option.id}: maneuver data is incomplete`,
    );
    assert(
      option.instructions?.length === option.maneuvers.length + 1,
      `${route.id} Route ${option.id}: spoken directions do not match the maneuver count`,
    );

    const directionText = option.instructions.join(" ").toLowerCase();
    for (const road of option.roads) {
      assert(
        directionText.includes(road.toLowerCase()),
        `${route.id} Route ${option.id}: directions omit ${road}`,
      );
    }
    for (const [maneuverIndex, maneuver] of option.maneuvers.entries()) {
      const instruction =
        option.instructions[maneuverIndex].toLowerCase();
      const maneuverRoad = maneuver.road.toLowerCase();
      assert(
        instruction.includes(maneuverRoad),
        `${route.id} Route ${option.id}: instruction ${
          maneuverIndex + 1
        } does not name ${maneuver.road}`,
      );

      if (maneuverIndex === 0) {
        assert(
          instruction.startsWith(`leave ${route.startName.toLowerCase()}`),
          `${route.id} Route ${option.id}: first instruction does not leave the collection point`,
        );
        continue;
      }

      if (maneuver.maneuverType === "end of road") {
        assert(
          instruction.includes("end of the road"),
          `${route.id} Route ${option.id}: end-of-road maneuver is described incorrectly`,
        );
      }
      if (maneuver.maneuverType === "new name") {
        assert(
          instruction.includes("road becomes"),
          `${route.id} Route ${option.id}: road-name change is described incorrectly`,
        );
      }
      if (maneuver.maneuverType === "merge") {
        assert(
          instruction.includes("merge"),
          `${route.id} Route ${option.id}: merge maneuver is described incorrectly`,
        );
      }
      if (maneuver.maneuverType === "fork") {
        assert(
          instruction.startsWith("keep "),
          `${route.id} Route ${option.id}: fork maneuver is described incorrectly`,
        );
      }
      if (
        maneuver.maneuverType === "on ramp" ||
        maneuver.maneuverType === "off ramp"
      ) {
        assert(
          instruction.includes("slip road"),
          `${route.id} Route ${option.id}: ramp maneuver is described incorrectly`,
        );
      }

      const directionalManeuver = [
        "turn",
        "end of road",
        "fork",
        "merge",
        "on ramp",
        "off ramp",
        "continue",
      ].includes(maneuver.maneuverType);
      if (directionalManeuver && maneuver.modifier?.includes("left")) {
        assert(
          instruction.includes("left"),
          `${route.id} Route ${option.id}: left maneuver is described with the wrong direction`,
        );
      }
      if (directionalManeuver && maneuver.modifier?.includes("right")) {
        assert(
          instruction.includes("right"),
          `${route.id} Route ${option.id}: right maneuver is described with the wrong direction`,
        );
      }
      if (directionalManeuver && maneuver.modifier === "uturn") {
        assert(
          instruction.includes("u-turn"),
          `${route.id} Route ${option.id}: U-turn maneuver is described incorrectly`,
        );
      }
    }
    assert(
      option.instructions.at(-1) ===
        `Continue until you reach ${route.endName}.`,
      `${route.id} Route ${option.id}: directions do not finish at ${route.endName}`,
    );

    for (const maneuver of option.maneuvers) {
      if (
        (maneuver.maneuverType === "roundabout" ||
          maneuver.maneuverType === "rotary") &&
        maneuver.exit
      ) {
        assert(
          directionText.includes(`${ordinal(maneuver.exit)} exit`),
          `${route.id} Route ${option.id}: roundabout exit ${maneuver.exit} is missing`,
        );
      }
    }

    if (RUN_LIVE_CHECKS) {
      const roadDeviation = await verifyRoadMatch(
        route.id,
        option.id,
        points,
      );
      liveResults.push(roadDeviation);
      console.log(
        `✓ ${route.id} Route ${option.id}: maximum sampled road deviation ${roadDeviation.toFixed(
          1,
        )}m`,
      );
    }
  }
}

assert(
  Object.keys(routeOptions).length === routes.length,
  "Generated data contains an unexpected route set",
);

console.log(
  `Verified ${routes.length} assessment maps and ${optionCount} distinct route options${
    RUN_LIVE_CHECKS
      ? `; maximum sampled road deviation ${Math.max(...liveResults).toFixed(
          1,
        )}m`
      : ""
  }.`,
);
