import routeOptions from "../src/data/routeOptions.generated.json" with {
  type: "json",
};
import { routes } from "../src/data/routes.js";
import { scoreRouteAnswer } from "../src/routeSpeechScore.js";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

let testedAnswers = 0;

for (const route of routes) {
  const optionSet = routeOptions[route.id];

  for (const option of optionSet.options) {
    const modelAnswer = option.instructions.join(" ");
    const modelScore = scoreRouteAnswer(
      modelAnswer,
      option,
      route.endName,
    );
    assert(
      modelScore.total >= 95,
      `${route.id} Route ${option.id}: model answer scored only ${modelScore.total}%`,
    );

    const incompleteAnswer = option.instructions
      .slice(0, Math.max(1, Math.floor(option.instructions.length / 3)))
      .join(" ");
    const incompleteScore = scoreRouteAnswer(
      incompleteAnswer,
      option,
      route.endName,
    );
    assert(
      incompleteScore.total < modelScore.total,
      `${route.id} Route ${option.id}: incomplete answer was not scored lower`,
    );

    testedAnswers += 2;
  }
}

const sampleRoute = routes[0];
const sampleOption = routeOptions[sampleRoute.id].options[0];
const unrelatedScore = scoreRouteAnswer(
  "Turn left, then carry on until I arrive.",
  sampleOption,
  sampleRoute.endName,
);
assert(
  unrelatedScore.total < 45,
  `Unrelated answer scored too highly at ${unrelatedScore.total}%`,
);

console.log(
  `Verified ${testedAnswers + 1} spoken-answer scoring scenarios across all routes.`,
);
