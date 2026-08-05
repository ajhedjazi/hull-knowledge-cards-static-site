import { useEffect, useMemo, useState } from "react";
import { venues } from "./data/venues";
import { buildQuiz, normaliseAnswer, shuffle } from "./lib/quiz";
import { submitFeedback, trackEvent } from "./lib/analytics";

const ALL_CATEGORIES = "All categories";
const CARD_PROGRESS_KEY = "hull-knowledge-progress-v1";
const MOCK_QUESTION_COUNT = 30;

function readSavedProgress() {
  if (typeof window === "undefined") return {};
  try {
    return JSON.parse(window.localStorage.getItem(CARD_PROGRESS_KEY) || "{}");
  } catch {
    return {};
  }
}

function cardKey(card) {
  return `${card.venue}|${card.location}`;
}

function formatAccessDate(value) {
  if (!value) return "";
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(value));
}

export default function RevisionApp({ onHome, accessExpiresAt }) {
  const [mode, setMode] = useState("study");
  const [category, setCategory] = useState(ALL_CATEGORIES);
  const [search, setSearch] = useState("");
  const [deck, setDeck] = useState(venues);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [progress, setProgress] = useState(readSavedProgress);

  const [practiceDeck, setPracticeDeck] = useState([]);
  const [practiceIndex, setPracticeIndex] = useState(0);
  const [practiceAnswer, setPracticeAnswer] = useState("");
  const [practiceFeedback, setPracticeFeedback] = useState("idle");
  const [practiceScore, setPracticeScore] = useState({ correct: 0, answered: 0 });

  const [mockDeck, setMockDeck] = useState([]);
  const [mockIndex, setMockIndex] = useState(0);
  const [mockAnswers, setMockAnswers] = useState([]);
  const [mockComplete, setMockComplete] = useState(false);

  const categories = useMemo(
    () => [ALL_CATEGORIES, ...Array.from(new Set(venues.map((card) => card.category)))],
    [],
  );

  const filteredDeck = useMemo(() => {
    const query = search.trim().toLowerCase();
    return venues.filter((card) => {
      const matchesCategory = category === ALL_CATEGORIES || card.category === category;
      const matchesSearch = !query || `${card.venue} ${card.location}`.toLowerCase().includes(query);
      return matchesCategory && matchesSearch;
    });
  }, [category, search]);

  useEffect(() => {
    trackEvent("visit", { landingMode: "free-validation" });
    trackEvent("feature_opened", { feature: "flashcards" });
  }, []);

  useEffect(() => {
    setDeck(filteredDeck);
    setCurrentIndex(0);
    setFlipped(false);
  }, [filteredDeck]);

  useEffect(() => {
    try {
      window.localStorage.setItem(CARD_PROGRESS_KEY, JSON.stringify(progress));
    } catch {
      // Keep progress in memory if local storage is unavailable.
    }
  }, [progress]);

  useEffect(() => {
    const handleKeyDown = (event) => {
      if (
        mode !== "study" ||
        !deck.length ||
        ["INPUT", "TEXTAREA", "SELECT"].includes(event.target?.tagName)
      ) return;

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
  const knownCount = Object.values(progress).filter((value) => value === "known").length;
  const learningCount = Object.values(progress).filter((value) => value === "learning").length;

  function openFlashcards() {
    setMode("study");
    trackEvent("feature_opened", { feature: "flashcards" });
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
    setProgress((value) => ({ ...value, [cardKey(current)]: status }));
    trackEvent("flashcard_marked", { status, category: current.category });
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

  function startPractice() {
    const source = category === ALL_CATEGORIES
      ? venues
      : venues.filter((card) => card.category === category);

    setPracticeDeck(buildQuiz(source, venues, source.length));
    setPracticeIndex(0);
    setPracticeAnswer("");
    setPracticeFeedback("idle");
    setPracticeScore({ correct: 0, answered: 0 });
    setMode("practice");
    trackEvent("feature_opened", { feature: "practice" });
    trackEvent("practice_started", {
      category: category === ALL_CATEGORIES ? "all" : category,
      questionCount: source.length,
    });
  }

  function choosePracticeAnswer(value) {
    const question = practiceDeck[practiceIndex];
    if (!question || practiceFeedback !== "idle") return;

    const correct = normaliseAnswer(value) === normaliseAnswer(question.card.location);
    setPracticeAnswer(value);
    setPracticeFeedback(correct ? "correct" : "wrong");
    setPracticeScore((score) => ({
      correct: score.correct + (correct ? 1 : 0),
      answered: score.answered + 1,
    }));
    trackEvent("practice_answered", {
      correct,
      category: question.card.category,
      questionNumber: practiceIndex + 1,
    });
  }

  function nextPracticeQuestion() {
    if (!practiceDeck.length) return;

    if (practiceIndex + 1 >= practiceDeck.length) {
      trackEvent("practice_completed", {
        correct: practiceScore.correct,
        answered: practiceScore.answered,
        questionCount: practiceDeck.length,
        percentage: practiceScore.answered
          ? Math.round((practiceScore.correct / practiceScore.answered) * 100)
          : 0,
        category: category === ALL_CATEGORIES ? "all" : category,
      });
      const source = category === ALL_CATEGORIES
        ? venues
        : venues.filter((card) => card.category === category);
      setPracticeDeck(buildQuiz(source, venues, source.length));
      setPracticeIndex(0);
      setPracticeScore({ correct: 0, answered: 0 });
    } else {
      setPracticeIndex((value) => value + 1);
    }

    setPracticeAnswer("");
    setPracticeFeedback("idle");
  }

  function startMock() {
    setMockDeck(buildQuiz(venues, venues, MOCK_QUESTION_COUNT));
    setMockIndex(0);
    setMockAnswers([]);
    setMockComplete(false);
    setMode("mock");
    trackEvent("feature_opened", { feature: "mock" });
    trackEvent("mock_started", { questionCount: MOCK_QUESTION_COUNT });
  }

  function chooseMockAnswer(value) {
    const question = mockDeck[mockIndex];
    if (!question || mockComplete) return;

    const answerRecord = {
      card: question.card,
      given: value,
      correct: normaliseAnswer(value) === normaliseAnswer(question.card.location),
    };
    const nextAnswers = [...mockAnswers, answerRecord];
    setMockAnswers(nextAnswers);

    if (mockIndex + 1 >= mockDeck.length) {
      const correctCount = nextAnswers.filter((item) => item.correct).length;
      trackEvent("mock_completed", {
        correct: correctCount,
        questionCount: mockDeck.length,
        percentage: Math.round((correctCount / mockDeck.length) * 100),
      });
      setMockComplete(true);
      return;
    }

    setMockIndex((value) => value + 1);
  }

  return (
    <div className="app-shell revision-shell">
      {(onHome || accessExpiresAt) && (
        <div className="member-bar">
          {onHome && (
            <button className="text-button member-home" onClick={onHome} type="button">
              ← Product home
            </button>
          )}
          {accessExpiresAt && (
            <span className="access-status">Access until {formatAccessDate(accessExpiresAt)}</span>
          )}
        </div>
      )}

      <header className="hero">
        <div>
          <p className="eyebrow">Free independent Hull taxi knowledge-test revision</p>
          <h1>Hull Knowledge Cards</h1>
          <p className="subtitle">
            Practise Hull taxi and private-hire knowledge with interactive flashcards,
            multiple-choice questions and a 30-question mock test.
          </p>
        </div>
      </header>

      <nav className="mode-tabs" aria-label="Revision modes">
        <button className={mode === "study" ? "active" : ""} onClick={openFlashcards} aria-pressed={mode === "study"} type="button">
          Flashcards
        </button>
        <button className={mode === "practice" ? "active" : ""} onClick={startPractice} aria-pressed={mode === "practice"} type="button">
          Practice
        </button>
        <button className={mode === "mock" ? "active" : ""} onClick={startMock} aria-pressed={mode === "mock"} type="button">
          30-question mock
        </button>
      </nav>

      <main>
        {mode !== "mock" && (
          <section className="controls">
            <label>
              <span>Category</span>
              <select value={category} onChange={(event) => setCategory(event.target.value)}>
                {categories.map((item) => <option key={item}>{item}</option>)}
              </select>
            </label>

            {mode === "study" && (
              <label className="search-box">
                <span>Search</span>
                <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Venue or road" />
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

        {mode === "practice" && (
          <PracticePanel
            deck={practiceDeck}
            index={practiceIndex}
            answer={practiceAnswer}
            feedback={practiceFeedback}
            score={practiceScore}
            chooseAnswer={choosePracticeAnswer}
            nextQuestion={nextPracticeQuestion}
            restart={startPractice}
          />
        )}

        {mode === "mock" && (
          <MockPanel
            deck={mockDeck}
            index={mockIndex}
            answers={mockAnswers}
            complete={mockComplete}
            chooseAnswer={chooseMockAnswer}
            restart={startMock}
          />
        )}

        <FeedbackPanel />
      </main>

      <footer>
        <p>
          Independent revision resource. Not endorsed by Hull City Council.
          Venue information should be checked against current official guidance.
          Flashcard progress and first-touch referral attribution are stored on this device.
          Pseudonymous usage events are collected to improve this resource.
        </p>
      </footer>
    </div>
  );
}

function FeedbackPanel() {
  const [open, setOpen] = useState(false);
  const [helpfulRating, setHelpfulRating] = useState("");
  const [easeRating, setEaseRating] = useState("");
  const [mostUseful, setMostUseful] = useState("");
  const [missingText, setMissingText] = useState("");
  const [outcome, setOutcome] = useState("");
  const [status, setStatus] = useState("idle");

  async function send(event) {
    event.preventDefault();
    setStatus("sending");
    try {
      await submitFeedback({ helpfulRating, easeRating, mostUseful, missingText, outcome });
      setStatus("sent");
    } catch {
      setStatus("error");
    }
  }

  if (!open) {
    return (
      <div style={{ display: "flex", justifyContent: "center", marginTop: "18px" }}>
        <button className="text-button" type="button" onClick={() => setOpen(true)}>Give feedback</button>
      </div>
    );
  }

  if (status === "sent") {
    return (
      <section className="study-stage" style={{ marginTop: "18px", textAlign: "center" }}>
        <strong>Thanks — your feedback has been recorded.</strong>
      </section>
    );
  }

  return (
    <section className="study-stage" style={{ marginTop: "18px" }} aria-label="Candidate feedback">
      <div className="card-topline"><span>Optional feedback</span><button className="text-button" type="button" onClick={() => setOpen(false)}>Close</button></div>
      <form onSubmit={send} style={{ display: "grid", gap: "14px" }}>
        <label>
          <span>Did this app help with your revision?</span>
          <select value={helpfulRating} onChange={(event) => setHelpfulRating(event.target.value)}>
            <option value="">Choose 1–5 (optional)</option>
            <option value="1">1 — Not much</option><option value="2">2</option><option value="3">3</option><option value="4">4</option><option value="5">5 — Very helpful</option>
          </select>
        </label>
        <label>
          <span>How easy was it to use?</span>
          <select value={easeRating} onChange={(event) => setEaseRating(event.target.value)}>
            <option value="">Choose 1–5 (optional)</option>
            <option value="1">1 — Difficult</option><option value="2">2</option><option value="3">3</option><option value="4">4</option><option value="5">5 — Very easy</option>
          </select>
        </label>
        <label>
          <span>Which feature was most useful?</span>
          <select value={mostUseful} onChange={(event) => setMostUseful(event.target.value)}>
            <option value="">Choose (optional)</option><option value="flashcards">Flashcards</option><option value="practice">Practice</option><option value="mock">30-question mock</option><option value="other">Other</option>
          </select>
        </label>
        <label>
          <span>What was missing or could be better?</span>
          <textarea value={missingText} onChange={(event) => setMissingText(event.target.value)} maxLength="1000" rows="3" placeholder="Optional" style={{ width: "100%", padding: "13px 14px", border: "1px solid #cbdad5", borderRadius: "13px", font: "inherit" }} />
        </label>
        <label>
          <span>Have you taken your knowledge/licensing assessment?</span>
          <select value={outcome} onChange={(event) => setOutcome(event.target.value)}>
            <option value="">Choose (optional)</option><option value="not-yet">Not yet</option><option value="passed">Yes — passed</option><option value="not-passed">Yes — did not pass</option><option value="prefer-not-to-say">Prefer not to say</option>
          </select>
        </label>
        {status === "error" && <p className="access-error" role="alert">Feedback could not be sent. Please try again.</p>}
        <button className="primary" disabled={status === "sending"} type="submit">{status === "sending" ? "Sending…" : "Send feedback"}</button>
      </form>
    </section>
  );
}

function Flashcards({ deck, current, index, flipped, progress, setFlipped, nextCard, previousCard, markCard, randomiseDeck, knownCount, learningCount, resetProgress }) {
  if (!current) return <div className="empty">No cards match your search.</div>;

  const status = progress[cardKey(current)];
  const mapUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${current.venue}, ${current.location}, Hull, UK`)}`;

  return (
    <>
      <section className="stats-row">
        <span><strong>{knownCount}</strong> known</span>
        <span><strong>{learningCount}</strong> learning</span>
        <span><strong>{venues.length - knownCount - learningCount}</strong> unmarked</span>
      </section>

      <section className="study-stage">
        <div className="card-topline"><span>{current.category}</span><span>{index + 1} / {deck.length}</span></div>
        <div className={`flashcard ${flipped ? "is-flipped" : ""}`} onClick={() => setFlipped((value) => !value)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); setFlipped((value) => !value); } }} role="button" tabIndex="0" aria-label="Flip flashcard">
          <span className="card-inner">
            <span className="card-face card-front"><small>Where is…</small><strong>{current.venue}</strong><em>Tap to reveal</em></span>
            <span className="card-face card-back"><small>{current.venue}</small><strong>{current.location}</strong><a href={mapUrl} target="_blank" rel="noreferrer" onClick={(event) => event.stopPropagation()}>Open in Maps ↗</a></span>
          </span>
        </div>
        <div className="status-line" aria-live="polite">{status === "known" && "Marked as known"}{status === "learning" && "Marked for more practice"}</div>
        <div className="nav-buttons">
          <button className="ghost icon" onClick={previousCard} aria-label="Previous card" type="button">←</button>
          <button className="learning" onClick={() => markCard("learning")} type="button">Needs work</button>
          <button className="known" onClick={() => markCard("known")} type="button">Got it</button>
          <button className="ghost icon" onClick={nextCard} aria-label="Next card" type="button">→</button>
        </div>
        <div className="secondary-actions"><button className="text-button" onClick={randomiseDeck} type="button">Shuffle cards</button><button className="text-button danger-text" onClick={resetProgress} type="button">Reset progress</button></div>
        <p className="shortcuts">Keyboard: space to flip · ←/→ to move · C = got it · X = needs work</p>
      </section>
    </>
  );
}

function PracticePanel({ deck, index, answer, feedback, score, chooseAnswer, nextQuestion, restart }) {
  const question = deck[index];
  if (!question) return <section className="test-panel empty-state"><p>No practice questions are available for this category.</p><button className="primary" onClick={restart} type="button">Restart practice</button></section>;

  return (
    <section className="test-panel">
      <div className="card-topline"><span>{question.card.category}</span><span>{score.correct} correct · {score.answered} answered</span></div>
      <QuestionPrompt question={question} />
      <ChoiceList question={question} answer={answer} feedback={feedback} onChoose={chooseAnswer} />
      {feedback !== "idle" && (
        <div className={`feedback choice-feedback ${feedback}`} aria-live="polite">
          <div><strong>{feedback === "correct" ? "Correct" : "Not quite"}</strong>{feedback === "wrong" && <span>The answer is {question.card.location}.</span>}</div>
          <button className="primary" onClick={nextQuestion} type="button">Next question</button>
        </div>
      )}
    </section>
  );
}

function MockPanel({ deck, index, answers, complete, chooseAnswer, restart }) {
  const question = deck[index];
  if (!question) return <div className="empty">Starting your mock…</div>;

  if (complete) {
    const correctCount = answers.filter((item) => item.correct).length;
    const percentage = Math.round((correctCount / deck.length) * 100);
    return (
      <section className="test-panel summary-panel">
        <p className="eyebrow">Mock complete</p><h2>{correctCount} / {deck.length}</h2><div className="score-ring"><span>{percentage}%</span></div>
        <p className="result-copy">Use the review below to decide what to revisit before trying another mock.</p>
        <button className="primary" onClick={restart} type="button">Try another mock</button>
        <details><summary>Review answers</summary><div className="review-list">{answers.map((item, itemIndex) => <div className={`review-item ${item.correct ? "correct" : "incorrect"}`} key={`${item.card.venue}-${itemIndex}`}><strong>{itemIndex + 1}. {item.card.venue}</strong><span>Your answer: {item.given}</span>{!item.correct && <span>Correct answer: {item.card.location}</span>}</div>)}</div></details>
      </section>
    );
  }

  return (
    <section className="test-panel">
      <div className="card-topline"><span>30-question mock</span><span>{index + 1} / {deck.length}</span></div>
      <QuestionPrompt question={question} />
      <ChoiceList question={question} answer="" feedback="idle" onChoose={chooseAnswer} />
      <div className="test-progress" aria-label={`Question ${index + 1} of ${deck.length}`}><span style={{ width: `${((index + 1) / deck.length) * 100}%` }} /></div>
      <p className="mock-note">Answers are scored at the end. No pass mark is assumed.</p>
    </section>
  );
}

function QuestionPrompt({ question }) {
  return <div className="test-question multiple-choice-question"><small>Which location is correct for…</small><h2>{question.card.venue}</h2></div>;
}

function ChoiceList({ question, answer, feedback, onChoose }) {
  return (
    <div className="choice-list" role="radiogroup" aria-label={`Choose the location for ${question.card.venue}`}>
      {question.options.map((option, optionIndex) => {
        const isCorrect = normaliseAnswer(option) === normaliseAnswer(question.card.location);
        const isSelected = normaliseAnswer(option) === normaliseAnswer(answer);
        return (
          <button type="button" className={`choice-button ${feedback === "idle" ? "" : isCorrect ? "choice-correct" : isSelected ? "choice-wrong" : "choice-muted"}`} onClick={() => onChoose(option)} disabled={feedback !== "idle"} aria-pressed={isSelected} key={`${option}-${optionIndex}`}>
            <span className="choice-letter">{String.fromCharCode(65 + optionIndex)}</span><span>{option}</span>{feedback !== "idle" && isCorrect && <strong aria-label="Correct answer">✓</strong>}{feedback === "wrong" && isSelected && <strong aria-label="Incorrect answer">×</strong>}
          </button>
        );
      })}
    </div>
  );
}
