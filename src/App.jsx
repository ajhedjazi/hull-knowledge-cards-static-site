import { useEffect, useMemo, useRef, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { routes } from "./data/routes";
import { venues } from "./data/venues";
import "./App.css";

const ALL_CATEGORIES = "All categories";
const CARD_PROGRESS_KEY = "hull-knowledge-progress-v1";
const ROUTE_PROGRESS_KEY = "hull-route-progress-v1";
const ROUTING_API_BASE_URL = (
  import.meta.env.VITE_ROUTING_API_URL || "https://router.project-osrm.org"
).replace(/\/$/, "");
const ROAD_SNAP_RADIUS_METRES = 120;
const EMPTY_CHECKLIST = {
  streetNames: false,
  endOfRoad: false,
  junctionCounts: false,
};

function shuffle(items) {
  const result = [...items];

  for (let index = result.length - 1; index > 0; index -= 1) {
    const randomIndex = Math.floor(Math.random() * (index + 1));
    [result[index], result[randomIndex]] = [result[randomIndex], result[index]];
  }

  return result;
}

function normalise(value) {
  return value
    .toLowerCase()
    .replace(/[’']/g, "")
    .replace(
      /\b(the|road|street|avenue|lane|way|drive|close)\b/g,
      (word) => word,
    )
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function readSavedProgress(key) {
  if (typeof window === "undefined") return {};

  try {
    return JSON.parse(window.localStorage.getItem(key) || "{}");
  } catch {
    return {};
  }
}

function buildRoadRouteUrl(points) {
  const coordinates = points
    .map(([latitude, longitude]) => `${longitude},${latitude}`)
    .join(";");
  const query = new URLSearchParams({
    alternatives: "false",
    steps: "false",
    geometries: "geojson",
    overview: "full",
    radiuses: points.map(() => ROAD_SNAP_RADIUS_METRES).join(";"),
  });

  return `${ROUTING_API_BASE_URL}/route/v1/driving/${coordinates}?${query}`;
}

export default function App() {
  const [mode, setMode] = useState("study");
  const [category, setCategory] = useState(ALL_CATEGORIES);
  const [search, setSearch] = useState("");
  const [deck, setDeck] = useState(venues);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [progress, setProgress] = useState(() =>
    readSavedProgress(CARD_PROGRESS_KEY),
  );

  const [testDeck, setTestDeck] = useState([]);
  const [testIndex, setTestIndex] = useState(0);
  const [answer, setAnswer] = useState("");
  const [feedback, setFeedback] = useState("idle");
  const [testAnswers, setTestAnswers] = useState([]);
  const [showSummary, setShowSummary] = useState(false);

  const [routeIndex, setRouteIndex] = useState(0);
  const [routeRevealed, setRouteRevealed] = useState(false);
  const [routeChecklist, setRouteChecklist] = useState(EMPTY_CHECKLIST);
  const [routeProgress, setRouteProgress] = useState(() =>
    readSavedProgress(ROUTE_PROGRESS_KEY),
  );

  const categories = useMemo(
    () => [
      ALL_CATEGORIES,
      ...Array.from(new Set(venues.map((card) => card.category))),
    ],
    [],
  );

  const filteredDeck = useMemo(() => {
    const query = search.trim().toLowerCase();

    return venues.filter((card) => {
      const matchesCategory =
        category === ALL_CATEGORIES || card.category === category;
      const matchesSearch =
        !query ||
        `${card.venue} ${card.location}`.toLowerCase().includes(query);

      return matchesCategory && matchesSearch;
    });
  }, [category, search]);

  useEffect(() => {
    setDeck(filteredDeck);
    setCurrentIndex(0);
    setFlipped(false);
  }, [filteredDeck]);

  useEffect(() => {
    try {
      window.localStorage.setItem(CARD_PROGRESS_KEY, JSON.stringify(progress));
    } catch {
      // Progress remains available for this session if storage is unavailable.
    }
  }, [progress]);

  useEffect(() => {
    try {
      window.localStorage.setItem(
        ROUTE_PROGRESS_KEY,
        JSON.stringify(routeProgress),
      );
    } catch {
      // Route progress remains available for this session.
    }
  }, [routeProgress]);

  useEffect(() => {
    const handleKeyDown = (event) => {
      if (
        mode !== "study" ||
        !deck.length ||
        ["INPUT", "TEXTAREA", "SELECT"].includes(event.target?.tagName)
      ) {
        return;
      }

      if (event.code === "Space") {
        event.preventDefault();
        setFlipped((value) => !value);
      }

      if (event.key === "ArrowRight") nextCard();
      if (event.key === "ArrowLeft") previousCard();
      if (event.key.toLowerCase() === "c") markCard("known");
      if (event.key.toLowerCase() === "x") markCard("learning");
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [mode, deck, currentIndex]);

  const current = deck[currentIndex];
  const currentRoute = routes[routeIndex];
  const knownCount = Object.values(progress).filter(
    (value) => value === "known",
  ).length;
  const learningCount = Object.values(progress).filter(
    (value) => value === "learning",
  ).length;

  function cardKey(card) {
    return `${card.venue}|${card.location}`;
  }

  function nextCard() {
    if (!deck.length) return;
    setCurrentIndex((value) => (value + 1) % deck.length);
    setFlipped(false);
  }

  function previousCard() {
    if (!deck.length) return;
    setCurrentIndex((value) => (value - 1 + deck.length) % deck.length);
    setFlipped(false);
  }

  function markCard(status) {
    if (!current) return;

    setProgress((value) => ({
      ...value,
      [cardKey(current)]: status,
    }));
    nextCard();
  }

  function randomiseDeck() {
    setDeck(shuffle(filteredDeck));
    setCurrentIndex(0);
    setFlipped(false);
  }

  function resetProgress() {
    setProgress({});

    try {
      window.localStorage.removeItem(CARD_PROGRESS_KEY);
    } catch {
      // No action is needed if storage is unavailable.
    }
  }

  function startTest() {
    const source =
      category === ALL_CATEGORIES
        ? venues
        : venues.filter((card) => card.category === category);

    const nextTest = shuffle(source)
      .slice(0, Math.min(30, source.length))
      .map((card) => {
        const sameCategory = venues
          .filter(
            (candidate) =>
              candidate.category === card.category &&
              normalise(candidate.location) !== normalise(card.location),
          )
          .map((candidate) => candidate.location);
        const allOtherLocations = venues
          .filter(
            (candidate) =>
              normalise(candidate.location) !== normalise(card.location),
          )
          .map((candidate) => candidate.location);
        const distractors = Array.from(
          new Set([...shuffle(sameCategory), ...shuffle(allOtherLocations)]),
        );

        return {
          card,
          options: shuffle([card.location, ...distractors.slice(0, 2)]),
        };
      });

    setTestDeck(nextTest);
    setTestIndex(0);
    setAnswer("");
    setFeedback("idle");
    setTestAnswers([]);
    setShowSummary(false);
    setMode("test");
  }

  function chooseAnswer(value) {
    const question = testDeck[testIndex];
    if (!question || feedback !== "idle") return;

    setAnswer(value);
    setFeedback(
      normalise(value) === normalise(question.card.location)
        ? "correct"
        : "wrong",
    );
  }

  function continueTest() {
    const question = testDeck[testIndex];
    if (!question || feedback === "idle") return;

    const answers = [
      ...testAnswers,
      {
        card: question.card,
        given: answer,
        correct: feedback === "correct",
      },
    ];

    setTestAnswers(answers);

    if (testIndex + 1 >= testDeck.length) {
      setShowSummary(true);
      return;
    }

    setTestIndex((value) => value + 1);
    setAnswer("");
    setFeedback("idle");
  }

  function openRouteTest() {
    setMode("route");
    setRouteRevealed(false);
    setRouteChecklist(EMPTY_CHECKLIST);
  }

  function toggleRouteCheck(item) {
    setRouteChecklist((value) => ({
      ...value,
      [item]: !value[item],
    }));
  }

  function assessRoute(status) {
    setRouteProgress((value) => ({
      ...value,
      [currentRoute.id]: status,
    }));
    setRouteIndex((value) => (value + 1) % routes.length);
    setRouteRevealed(false);
    setRouteChecklist(EMPTY_CHECKLIST);
  }

  async function shareSite() {
    const shareData = {
      title: "Hull Knowledge Cards",
      text: "Practise Hull taxi knowledge venues, tests and verbal routes.",
      url: window.location.href,
    };

    try {
      if (navigator.share) {
        await navigator.share(shareData);
      } else {
        await navigator.clipboard.writeText(window.location.href);
      }
    } catch {
      // Cancelling the share sheet does not require an error message.
    }
  }

  return (
    <div className="app-shell">
      <header className="hero">
        <div>
          <p className="eyebrow">Hull taxi knowledge test</p>
          <h1>Hull Knowledge Cards</h1>
          <p className="subtitle">
            Learn all {venues.length} official venues, one tap at a time.
          </p>
        </div>
        <button
          className="ghost share"
          onClick={shareSite}
          aria-label="Share this site"
          type="button"
        >
          Share
        </button>
      </header>

      <nav className="mode-tabs" aria-label="Study modes">
        <button
          className={mode === "study" ? "active" : ""}
          onClick={() => setMode("study")}
          aria-pressed={mode === "study"}
          type="button"
        >
          Flashcards
        </button>
        <button
          className={mode === "test" ? "active" : ""}
          onClick={startTest}
          aria-pressed={mode === "test"}
          type="button"
        >
          30-card test
        </button>
        <button
          className={mode === "route" ? "active" : ""}
          onClick={openRouteTest}
          aria-pressed={mode === "route"}
          type="button"
        >
          Route Test
        </button>
      </nav>

      <main>
        {mode !== "route" && (
          <section className="controls">
            <label>
              <span>Category</span>
              <select
                value={category}
                onChange={(event) => setCategory(event.target.value)}
              >
                {categories.map((item) => (
                  <option key={item}>{item}</option>
                ))}
              </select>
            </label>

            {mode === "study" && (
              <label className="search-box">
                <span>Search</span>
                <input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Venue or road"
                />
              </label>
            )}
          </section>
        )}

        {mode === "study" && (
          <Flashcards
            deck={deck}
            current={current}
            index={currentIndex}
            flipped={flipped}
            progress={progress}
            cardKey={cardKey}
            setFlipped={setFlipped}
            nextCard={nextCard}
            previousCard={previousCard}
            markCard={markCard}
            randomiseDeck={randomiseDeck}
            knownCount={knownCount}
            learningCount={learningCount}
            resetProgress={resetProgress}
          />
        )}

        {mode === "test" && (
          <TestPanel
            testDeck={testDeck}
            testIndex={testIndex}
            answer={answer}
            feedback={feedback}
            chooseAnswer={chooseAnswer}
            continueTest={continueTest}
            showSummary={showSummary}
            testAnswers={testAnswers}
            startTest={startTest}
          />
        )}

        {mode === "route" && (
          <RouteTest
            route={currentRoute}
            routeIndex={routeIndex}
            routeCount={routes.length}
            revealed={routeRevealed}
            setRevealed={setRouteRevealed}
            checklist={routeChecklist}
            toggleCheck={toggleRouteCheck}
            progressStatus={routeProgress[currentRoute.id]}
            assessRoute={assessRoute}
          />
        )}
      </main>

      <footer>
        <p>
          Based on Hull City Council’s taxi driver application pack. Progress is
          stored only on this device. Route models are for revision; always
          check current road restrictions.
        </p>
      </footer>
    </div>
  );
}

function Flashcards({
  deck,
  current,
  index,
  flipped,
  progress,
  cardKey,
  setFlipped,
  nextCard,
  previousCard,
  markCard,
  randomiseDeck,
  knownCount,
  learningCount,
  resetProgress,
}) {
  if (!current) {
    return <div className="empty">No cards match your search.</div>;
  }

  const status = progress[cardKey(current)];
  const mapUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
    `${current.venue}, ${current.location}, Hull, UK`,
  )}`;

  return (
    <>
      <section className="stats-row">
        <span>
          <strong>{knownCount}</strong> known
        </span>
        <span>
          <strong>{learningCount}</strong> learning
        </span>
        <span>
          <strong>{venues.length - knownCount - learningCount}</strong> unmarked
        </span>
      </section>

      <section className="study-stage">
        <div className="card-topline">
          <span>{current.category}</span>
          <span>
            {index + 1} / {deck.length}
          </span>
        </div>

        <div
          className={`flashcard ${flipped ? "is-flipped" : ""}`}
          onClick={() => setFlipped((value) => !value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              setFlipped((value) => !value);
            }
          }}
          role="button"
          tabIndex="0"
          aria-label="Flip flashcard"
        >
          <span className="card-inner">
            <span className="card-face card-front">
              <small>Where is…</small>
              <strong>{current.venue}</strong>
              <em>Tap to reveal</em>
            </span>
            <span className="card-face card-back">
              <small>{current.venue}</small>
              <strong>{current.location}</strong>
              <a
                href={mapUrl}
                target="_blank"
                rel="noreferrer"
                onClick={(event) => event.stopPropagation()}
              >
                Open in Maps ↗
              </a>
            </span>
          </span>
        </div>

        <div className="status-line" aria-live="polite">
          {status === "known" && "Marked as known"}
          {status === "learning" && "Marked for more practice"}
        </div>

        <div className="nav-buttons">
          <button
            className="ghost icon"
            onClick={previousCard}
            aria-label="Previous card"
            type="button"
          >
            ←
          </button>
          <button
            className="learning"
            onClick={() => markCard("learning")}
            type="button"
          >
            Needs work
          </button>
          <button
            className="known"
            onClick={() => markCard("known")}
            type="button"
          >
            Got it
          </button>
          <button
            className="ghost icon"
            onClick={nextCard}
            aria-label="Next card"
            type="button"
          >
            →
          </button>
        </div>

        <div className="secondary-actions">
          <button className="text-button" onClick={randomiseDeck} type="button">
            Shuffle cards
          </button>
          <button
            className="text-button danger-text"
            onClick={resetProgress}
            type="button"
          >
            Reset progress
          </button>
        </div>
        <p className="shortcuts">
          Keyboard: space to flip · ←/→ to move · C = got it · X = needs work
        </p>
      </section>
    </>
  );
}

function TestPanel({
  testDeck,
  testIndex,
  answer,
  feedback,
  chooseAnswer,
  continueTest,
  showSummary,
  testAnswers,
  startTest,
}) {
  const question = testDeck[testIndex];

  if (!question) {
    return <div className="empty">Choose “30-card test” to begin.</div>;
  }

  if (showSummary) {
    const correctCount = testAnswers.filter((item) => item.correct).length;
    const percentage = Math.round((correctCount / testDeck.length) * 100);

    return (
      <section className="test-panel summary-panel">
        <p className="eyebrow">Test complete</p>
        <h2>
          {correctCount} / {testDeck.length}
        </h2>
        <div className="score-ring">
          <span>{percentage}%</span>
        </div>
        <p className={percentage >= 80 ? "pass-message" : "retry-message"}>
          {percentage >= 80
            ? "Pass — you reached the 80% target."
            : "Not quite — you need 24 out of 30 to pass."}
        </p>
        <button className="primary" onClick={startTest} type="button">
          Try another 30
        </button>

        <details open={percentage < 80}>
          <summary>Review answers</summary>
          <div className="review-list">
            {testAnswers.map((item, itemIndex) => (
              <div
                className={`review-item ${
                  item.correct ? "correct" : "incorrect"
                }`}
                key={`${item.card.venue}-${itemIndex}`}
              >
                <strong>
                  {itemIndex + 1}. {item.card.venue}
                </strong>
                <span>Your answer: {item.given || "Not answered"}</span>
                {!item.correct && (
                  <span>Correct answer: {item.card.location}</span>
                )}
              </div>
            ))}
          </div>
        </details>
      </section>
    );
  }

  return (
    <section className="test-panel">
      <div className="card-topline">
        <span>{question.card.category}</span>
        <span>
          {testIndex + 1} / {testDeck.length}
        </span>
      </div>

      <div className="test-question multiple-choice-question">
        <small>Which location is correct for…</small>
        <h2>{question.card.venue}</h2>
      </div>

      <div
        className="choice-list"
        role="radiogroup"
        aria-label={`Choose the location for ${question.card.venue}`}
      >
        {question.options.map((option, optionIndex) => {
          const isCorrect =
            normalise(option) === normalise(question.card.location);
          const isSelected = normalise(option) === normalise(answer);

          return (
            <button
              type="button"
              className={`choice-button ${
                feedback === "idle"
                  ? ""
                  : isCorrect
                    ? "choice-correct"
                    : isSelected
                      ? "choice-wrong"
                      : "choice-muted"
              }`}
              onClick={() => chooseAnswer(option)}
              disabled={feedback !== "idle"}
              aria-pressed={isSelected}
              key={`${option}-${optionIndex}`}
            >
              <span className="choice-letter">
                {String.fromCharCode(65 + optionIndex)}
              </span>
              <span>{option}</span>
              {feedback !== "idle" && isCorrect && (
                <strong aria-label="Correct answer">✓</strong>
              )}
              {feedback === "wrong" && isSelected && (
                <strong aria-label="Incorrect answer">×</strong>
              )}
            </button>
          );
        })}
      </div>

      {feedback !== "idle" && (
        <div
          className={`feedback choice-feedback ${feedback}`}
          aria-live="polite"
        >
          <div>
            <strong>
              {feedback === "correct" ? "Correct!" : "Not quite."}
            </strong>
            {feedback === "wrong" && (
              <span>The correct answer is {question.card.location}.</span>
            )}
          </div>
          <button className="primary" onClick={continueTest} type="button">
            {testIndex + 1 === testDeck.length
              ? "See results"
              : "Next question"}
          </button>
        </div>
      )}

      <div
        className="test-progress"
        aria-label={`Question ${testIndex + 1} of ${testDeck.length}`}
      >
        <span
          style={{ width: `${((testIndex + 1) / testDeck.length) * 100}%` }}
        />
      </div>
      <p className="test-target">Pass target: 24 out of 30</p>
    </section>
  );
}

function RouteTest({
  route,
  routeIndex,
  routeCount,
  revealed,
  setRevealed,
  checklist,
  toggleCheck,
  progressStatus,
  assessRoute,
}) {
  const [plannedPoints, setPlannedPoints] = useState([]);
  const [planLocked, setPlanLocked] = useState(false);
  const [routingStatus, setRoutingStatus] = useState("idle");
  const [routingAttempt, setRoutingAttempt] = useState(0);

  useEffect(() => {
    setPlannedPoints([]);
    setPlanLocked(false);
    setRoutingStatus("idle");
    setRoutingAttempt(0);
  }, [route.id]);

  const isRouting = routingStatus === "routing";
  const routingFailed = routingStatus === "error";
  const routeIsReady = routingStatus === "ready";

  function addPlannedPoint(point) {
    setRoutingStatus("routing");
    setPlannedPoints((points) => [...points, point]);
  }

  function undoPlannedPoint() {
    const nextPoints = plannedPoints.slice(0, -1);
    setPlannedPoints(nextPoints);
    setRoutingStatus(nextPoints.length ? "routing" : "idle");
  }

  function resetPlan() {
    setPlannedPoints([]);
    setPlanLocked(false);
    setRoutingStatus("idle");
  }

  function retryRoadSnap() {
    setRoutingStatus("routing");
    setRoutingAttempt((attempt) => attempt + 1);
  }

  function finishPlan() {
    setRoutingStatus("routing");
    setPlanLocked(true);
  }

  function editPlan() {
    setRoutingStatus("routing");
    setPlanLocked(false);
  }

  const checklistItems = [
    { id: "streetNames", label: "Mentioned street names" },
    {
      id: "endOfRoad",
      label: "Said “end of the road” where applicable",
    },
    {
      id: "junctionCounts",
      label: "Counted exact junctions (e.g. 3rd left)",
    },
  ];

  return (
    <section className="route-panel">
      <div className="route-topline">
        <span className="route-badge">
          Assessment map {routeIndex + 1} of {routeCount}
        </span>
        {progressStatus && (
          <span className={`route-status ${progressStatus}`}>
            {progressStatus === "known"
              ? "Previously: got it"
              : "Needs practice"}
          </span>
        )}
      </div>

      <div className="assessment-brief">
        <div>
          <small>{route.area}</small>
          <strong>Plan the shortest sensible driving route</strong>
        </div>
        <span>{route.estimatedMinutes}</span>
      </div>

      <div className="route-points">
        <article className="route-point start-point">
          <span className="route-marker triangle" aria-hidden="true">
            ▲
          </span>
          <div>
            <small>Start · Collection Point</small>
            <h2>{route.startName}</h2>
            <p>{route.startLocation}</p>
          </div>
        </article>

        <div className="route-connector" aria-hidden="true">
          <span>→</span>
        </div>

        <article className="route-point finish-point">
          <span className="route-marker circle" aria-hidden="true">
            ●
          </span>
          <div>
            <small>Finish · Drop-off Point</small>
            <h2>{route.endName}</h2>
            <p>{route.endLocation}</p>
          </div>
        </article>
      </div>

      <div className="assessment-map-shell">
        <AssessmentMap
          route={route}
          plannedPoints={plannedPoints}
          onAddPoint={addPlannedPoint}
          onRoutingStateChange={setRoutingStatus}
          routingAttempt={routingAttempt}
          planningDisabled={isRouting}
          locked={planLocked}
          revealed={revealed}
        />
        <div className="map-legend" aria-label="Map key">
          <span>
            <i className="legend-triangle">▲</i> Collection
          </span>
          <span>
            <i className="legend-circle">●</i> Drop-off
          </span>
          {plannedPoints.length > 0 && (
            <span>
              <i className="legend-line planned" /> Your plan
            </span>
          )}
          {revealed && (
            <span>
              <i className="legend-line model" /> Model route
            </span>
          )}
        </div>
      </div>

      {(!planLocked || !routeIsReady) && (
        <div
          className={`planning-panel ${routingFailed ? "has-error" : ""}`}
          aria-live="polite"
        >
          <div>
            <small>Map planning</small>
            <strong>
              {isRouting
                ? "Snapping that section to the roads…"
                : routingFailed
                  ? "Road snapping could not connect"
                  : "Build your route one short section at a time"}
            </strong>
            <p>
              {isRouting
                ? "The amber line will appear when the road-following section is ready."
                : routingFailed
                  ? "Retry, or undo the last point and tap a nearby road or junction."
                  : "Tap a nearby road or junction. Each short section will follow the road and only join the ● drop-off when you press “Finish planning”."}
            </p>
          </div>
          <div className="planning-actions">
            {planLocked ? (
              <button className="ghost" type="button" onClick={editPlan}>
                Edit my route
              </button>
            ) : (
              <>
                <button
                  className="ghost"
                  type="button"
                  disabled={!plannedPoints.length || isRouting}
                  onClick={undoPlannedPoint}
                >
                  Undo point
                </button>
                <button
                  className="text-button danger-text"
                  type="button"
                  disabled={!plannedPoints.length || isRouting}
                  onClick={resetPlan}
                >
                  Reset line
                </button>
              </>
            )}
            {routingFailed ? (
              <button
                className="primary"
                type="button"
                onClick={retryRoadSnap}
              >
                Retry road snapping
              </button>
            ) : (
              !planLocked && (
                <button
                  className="primary"
                  type="button"
                  disabled={!plannedPoints.length || !routeIsReady}
                  onClick={finishPlan}
                >
                  Finish planning
                </button>
              )
            )}
          </div>
        </div>
      )}

      <aside className="examiner-tip">
        <span className="tip-icon" aria-hidden="true">
          !
        </span>
        <div>
          <strong>Ruth’s Golden Rule</strong>
          <p>
            Always state junction counts (e.g. 3rd left) and “until the end of
            the road” rather than just “turn left”.
          </p>
        </div>
      </aside>

      {planLocked && routeIsReady && !revealed && (
        <div className="speak-prompt">
          <span className="speak-icon" aria-hidden="true">
            ◉
          </span>
          <div>
            <small>Your turn</small>
            <h2>Now describe your planned route out loud</h2>
            <p>
              Imagine the course leader is listening. Name each road, count
              junctions and say exactly where the road ends.
            </p>
          </div>
          <button
            className="edit-plan"
            onClick={editPlan}
            type="button"
          >
            Edit my route
          </button>
          <button
            className="primary reveal-route"
            onClick={() => setRevealed(true)}
            type="button"
          >
            Reveal Model Answer
          </button>
        </div>
      )}

      {revealed && (
        <div className="route-answer" aria-live="polite">
          <div className="key-roads">
            <small>Key roads</small>
            <strong>{route.keyRoads}</strong>
          </div>

          <div className="model-script">
            <p className="eyebrow">Model verbal script</p>
            <ol>
              {route.modelScript.map((step, stepIndex) => (
                <li key={step}>
                  <span>{stepIndex + 1}</span>
                  <p>{step}</p>
                </li>
              ))}
            </ol>
          </div>

          <fieldset className="self-check">
            <legend>Self-assessment checklist</legend>
            {checklistItems.map((item) => (
              <label key={item.id}>
                <input
                  type="checkbox"
                  checked={checklist[item.id]}
                  onChange={() => toggleCheck(item.id)}
                />
                <span>{item.label}</span>
              </label>
            ))}
          </fieldset>

          <div className="route-assessment">
            <button
              className="learning"
              onClick={() => assessRoute("learning")}
              type="button"
            >
              Needs practice
            </button>
            <button
              className="known"
              onClick={() => assessRoute("known")}
              type="button"
            >
              Got it
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

function AssessmentMap({
  route,
  plannedPoints,
  onAddPoint,
  onRoutingStateChange,
  routingAttempt,
  planningDisabled,
  locked,
  revealed,
}) {
  const mapElementRef = useRef(null);
  const mapRef = useRef(null);
  const planLayerRef = useRef(null);
  const modelLayerRef = useRef(null);
  const [roadPath, setRoadPath] = useState([]);
  const lockedRef = useRef(locked);
  const planningDisabledRef = useRef(planningDisabled);
  const onAddPointRef = useRef(onAddPoint);
  const onRoutingStateChangeRef = useRef(onRoutingStateChange);

  useEffect(() => {
    lockedRef.current = locked;
    planningDisabledRef.current = planningDisabled;
    onAddPointRef.current = onAddPoint;
    onRoutingStateChangeRef.current = onRoutingStateChange;
  }, [locked, onAddPoint, onRoutingStateChange, planningDisabled]);

  useEffect(() => {
    if (!mapElementRef.current) return undefined;

    const map = L.map(mapElementRef.current, {
      scrollWheelZoom: false,
      zoomControl: true,
    });
    mapRef.current = map;

    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      maxZoom: 19,
    }).addTo(map);

    const markerIcon = (symbol, markerClass) =>
      L.divIcon({
        className: "assessment-map-marker",
        html: `<span class="${markerClass}">${symbol}</span>`,
        iconAnchor: [18, 30],
        iconSize: [36, 36],
      });

    L.marker(route.start, {
      icon: markerIcon("▲", "map-triangle"),
      keyboard: false,
    })
      .addTo(map)
      .bindTooltip(route.startName, {
        direction: "top",
        offset: [0, -28],
        permanent: true,
      });

    L.marker(route.end, {
      icon: markerIcon("●", "map-circle"),
      keyboard: false,
    })
      .addTo(map)
      .bindTooltip(route.endName, {
        direction: "top",
        offset: [0, -28],
        permanent: true,
      });

    const bounds = L.latLngBounds([route.start, route.end]);
    map.fitBounds(bounds, {
      padding: [48, 48],
      maxZoom: 14,
    });

    const handleMapClick = (event) => {
      if (!lockedRef.current && !planningDisabledRef.current) {
        planningDisabledRef.current = true;
        onAddPointRef.current([event.latlng.lat, event.latlng.lng]);
      }
    };

    map.on("click", handleMapClick);

    return () => {
      map.off("click", handleMapClick);
      map.remove();
      mapRef.current = null;
      planLayerRef.current = null;
      modelLayerRef.current = null;
    };
  }, [route]);

  useEffect(() => {
    if (!plannedPoints.length) {
      setRoadPath([]);
      onRoutingStateChangeRef.current("idle");
      return undefined;
    }

    const controller = new AbortController();
    const routePoints = [
      route.start,
      ...plannedPoints,
      ...(locked ? [route.end] : []),
    ];

    setRoadPath([]);
    onRoutingStateChangeRef.current("routing");

    async function snapRouteToRoads() {
      try {
        const response = await fetch(buildRoadRouteUrl(routePoints), {
          signal: controller.signal,
        });

        if (!response.ok) {
          throw new Error(`Road routing returned ${response.status}`);
        }

        const result = await response.json();
        const coordinates = result.routes?.[0]?.geometry?.coordinates;

        if (result.code !== "Ok" || !Array.isArray(coordinates)) {
          throw new Error("No road-following route was returned");
        }

        const nextRoadPath = coordinates.map(([longitude, latitude]) => [
          latitude,
          longitude,
        ]);

        setRoadPath(nextRoadPath);
        onRoutingStateChangeRef.current("ready");
      } catch (error) {
        if (error.name === "AbortError") return;

        setRoadPath([]);
        onRoutingStateChangeRef.current("error");
      }
    }

    snapRouteToRoads();

    return () => controller.abort();
  }, [locked, plannedPoints, route, routingAttempt]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    if (planLayerRef.current) {
      planLayerRef.current.remove();
      planLayerRef.current = null;
    }

    if (roadPath.length) {
      planLayerRef.current = L.polyline(roadPath, {
        color: "#c77c10",
        dashArray: "9 8",
        lineCap: "round",
        opacity: 0.95,
        weight: 6,
      }).addTo(map);
    }
  }, [roadPath]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    if (modelLayerRef.current) {
      modelLayerRef.current.remove();
      modelLayerRef.current = null;
    }

    if (revealed) {
      modelLayerRef.current = L.polyline(route.modelPath, {
        color: "#0b675d",
        lineCap: "round",
        opacity: 0.9,
        weight: 7,
      }).addTo(map);
    }
  }, [revealed, route]);

  return (
    <div
      className={`assessment-map ${locked ? "is-locked" : ""} ${
        planningDisabled ? "is-busy" : ""
      }`}
      ref={mapElementRef}
      role="application"
      aria-label={`Route planning map from ${route.startName} to ${route.endName}`}
    />
  );
}
