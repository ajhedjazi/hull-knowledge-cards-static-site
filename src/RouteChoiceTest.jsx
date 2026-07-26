import { useEffect, useMemo, useRef, useState } from "react";
import L from "leaflet";
import routeOptionsData from "./data/routeOptions.generated.json";
import { scoreRouteAnswer } from "./routeSpeechScore";

const ROUTE_OPTION_STYLES = {
  A: { color: "#2f6fad", dashArray: null },
  B: { color: "#8556a3", dashArray: "12 7" },
  C: { color: "#c77c10", dashArray: "3 8" },
  D: { color: "#0b675d", dashArray: "15 7 3 7" },
};

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

function formatDistance(distanceMetres) {
  return `${(distanceMetres / 1000).toFixed(2)} km`;
}

function formatDifference(distanceMetres) {
  if (distanceMetres < 1000) {
    return `${Math.round(distanceMetres / 10) * 10} m longer`;
  }

  return `${(distanceMetres / 1000).toFixed(1)} km longer`;
}

export default function RouteChoiceTest({
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
  const [selectedOptionId, setSelectedOptionId] = useState("");
  const [choiceLocked, setChoiceLocked] = useState(false);
  const [voiceTranscript, setVoiceTranscript] = useState("");
  const optionSet = routeOptionsData[route.id];
  const options = useMemo(
    () =>
      optionSet.options.map((option) => ({
        ...option,
        path: decodePolyline6(option.geometry),
      })),
    [optionSet],
  );

  useEffect(() => {
    setSelectedOptionId("");
    setChoiceLocked(false);
    setVoiceTranscript("");
  }, [route.id]);

  const selectedOption = options.find(
    (option) => option.id === selectedOptionId,
  );
  const correctOption = options.find(
    (option) => option.id === optionSet.correctOptionId,
  );
  const selectedCorrectly =
    selectedOptionId === optionSet.correctOptionId;
  const distanceDifference = selectedOption
    ? selectedOption.distanceMetres - correctOption.distanceMetres
    : 0;
  const voiceScore = useMemo(
    () =>
      revealed && selectedOption && voiceTranscript.trim()
        ? scoreRouteAnswer(
            voiceTranscript,
            selectedOption,
            route.endName,
          )
        : null,
    [revealed, route.endName, selectedOption, voiceTranscript],
  );
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

  function chooseOption(optionId) {
    if (!choiceLocked && !revealed) {
      setSelectedOptionId(optionId);
    }
  }

  function confirmChoice() {
    if (selectedOptionId) {
      setChoiceLocked(true);
    }
  }

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
          <strong>Which is the shortest sensible route?</strong>
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
        <RouteChoiceMap
          route={route}
          options={options}
          selectedOptionId={selectedOptionId}
          correctOptionId={optionSet.correctOptionId}
          choiceLocked={choiceLocked}
          revealed={revealed}
        />
        <div className="map-legend" aria-label="Map key">
          <span>
            <i className="legend-triangle">▲</i> Collection
          </span>
          <span>
            <i className="legend-circle">●</i> Drop-off
          </span>
          <span>
            <i
              className={`legend-line ${
                revealed ? "model" : selectedOptionId ? "planned" : "options"
              }`}
            />
            {revealed
              ? "Shortest route"
              : selectedOptionId
                ? `Selected: Route ${selectedOptionId}`
                : "Routes A–D"}
          </span>
        </div>
      </div>

      {!choiceLocked && !revealed && (
        <section className="route-choice-panel" aria-labelledby="route-choice">
          <div className="route-choice-heading">
            <div>
              <small>Choose one route</small>
              <h2 id="route-choice">Compare A–D before locking it in</h2>
            </div>
            <p>
              Distances are hidden until the answer is revealed. Select a route
              to highlight it on the map.
            </p>
          </div>

          <div className="route-option-grid">
            {options.map((option) => {
              const selected = selectedOptionId === option.id;

              return (
                <button
                  className={`route-option-button ${
                    selected ? "is-selected" : ""
                  }`}
                  style={{
                    "--route-colour": ROUTE_OPTION_STYLES[option.id].color,
                  }}
                  type="button"
                  aria-pressed={selected}
                  onClick={() => chooseOption(option.id)}
                  key={option.id}
                >
                  <span className="route-option-letter">{option.id}</span>
                  <span>
                    <strong>Route {option.id}</strong>
                    <small>{selected ? "Selected" : "Show this route"}</small>
                  </span>
                </button>
              );
            })}
          </div>

          <button
            className="primary route-choice-confirm"
            type="button"
            disabled={!selectedOptionId}
            onClick={confirmChoice}
          >
            {selectedOptionId
              ? `Lock in Route ${selectedOptionId}`
              : "Select a route first"}
          </button>
        </section>
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

      {choiceLocked && !revealed && (
        <div className="speak-prompt">
          <span className="speak-icon" aria-hidden="true">
            ◉
          </span>
          <div>
            <small>Your choice · Route {selectedOptionId}</small>
            <h2>Give your route answer</h2>
            <p>
              Speak as though the course leader is listening. The microphone
              will turn your answer into text ready for an automatic practice
              score.
            </p>
          </div>
          <VoiceAnswerRecorder
            routeId={route.id}
            transcript={voiceTranscript}
            setTranscript={setVoiceTranscript}
            reveal={() => setRevealed(true)}
          />
          <button
            className="edit-plan"
            onClick={() => {
              setVoiceTranscript("");
              setChoiceLocked(false);
            }}
            type="button"
          >
            Change my route
          </button>
        </div>
      )}

      {revealed && (
        <div className="route-answer" aria-live="polite">
          <section
            className={`route-result ${
              selectedCorrectly ? "is-correct" : "is-incorrect"
            }`}
          >
            <span className="route-result-icon" aria-hidden="true">
              {selectedCorrectly ? "✓" : "!"}
            </span>
            <div>
              <small>You selected Route {selectedOptionId}</small>
              <h2>
                {selectedCorrectly
                  ? "Correct — that is the shortest route"
                  : `The shortest route is Route ${optionSet.correctOptionId}`}
              </h2>
              <p>
                Route {optionSet.correctOptionId} is{" "}
                {formatDistance(correctOption.distanceMetres)}.
                {!selectedCorrectly &&
                  ` Route ${selectedOptionId} is ${formatDifference(
                    distanceDifference,
                  )}.`}
              </p>
            </div>
          </section>

          {voiceScore && (
            <VoiceScoreCard
              route={route}
              transcript={voiceTranscript}
              score={voiceScore}
              selectedOptionId={selectedOptionId}
              correctOptionId={optionSet.correctOptionId}
            />
          )}

          <section className="route-comparison">
            <div className="route-comparison-heading">
              <small>Distance comparison</small>
              <strong>Why the alternatives lose distance</strong>
            </div>
            <div className="route-comparison-grid">
              {options.map((option) => {
                const isCorrect = option.id === optionSet.correctOptionId;
                const isChosen = option.id === selectedOptionId;
                const difference =
                  option.distanceMetres - correctOption.distanceMetres;

                return (
                  <article
                    className={`route-comparison-card ${
                      isCorrect ? "is-shortest" : ""
                    }`}
                    key={option.id}
                  >
                    <div>
                      <span
                        className="comparison-letter"
                        style={{
                          "--route-colour":
                            ROUTE_OPTION_STYLES[option.id].color,
                        }}
                      >
                        {option.id}
                      </span>
                      <strong>Route {option.id}</strong>
                    </div>
                    <b>{formatDistance(option.distanceMetres)}</b>
                    <small>
                      {isCorrect
                        ? "Shortest"
                        : formatDifference(difference)}
                      {isChosen ? " · Your choice" : ""}
                    </small>
                  </article>
                );
              })}
            </div>
          </section>

          <div className="key-roads">
            <small>Key roads on the shortest route</small>
            <strong>{correctOption.roads.join(" → ")}</strong>
          </div>

          <div className="model-script">
            <p className="eyebrow">Model verbal script</p>
            <ol>
              {correctOption.instructions.map((step, stepIndex) => (
                <li key={`${stepIndex}-${step}`}>
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

function VoiceAnswerRecorder({
  routeId,
  transcript,
  setTranscript,
  reveal,
}) {
  const recognitionRef = useRef(null);
  const finalTranscriptRef = useRef(transcript);
  const [isListening, setIsListening] = useState(false);
  const [interimTranscript, setInterimTranscript] = useState("");
  const [speechError, setSpeechError] = useState("");
  const speechSupported =
    typeof window !== "undefined" &&
    Boolean(window.SpeechRecognition || window.webkitSpeechRecognition);

  useEffect(() => {
    finalTranscriptRef.current = transcript;
  }, [transcript]);

  useEffect(
    () => () => {
      recognitionRef.current?.abort();
    },
    [routeId],
  );

  function stopListening() {
    try {
      recognitionRef.current?.stop();
    } catch {
      // Recognition may already have stopped after a pause.
    }
    recognitionRef.current = null;
    setIsListening(false);
    setInterimTranscript("");
  }

  function startListening() {
    const SpeechRecognition =
      window.SpeechRecognition || window.webkitSpeechRecognition;

    if (!SpeechRecognition) {
      setSpeechError(
        "Voice transcription is not available in this browser. You can type or use your keyboard’s dictation button instead.",
      );
      return;
    }

    recognitionRef.current?.abort();
    const recognition = new SpeechRecognition();
    recognition.lang = "en-GB";
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;

    recognition.onresult = (event) => {
      let finalText = "";
      let interimText = "";

      for (
        let resultIndex = event.resultIndex;
        resultIndex < event.results.length;
        resultIndex += 1
      ) {
        const result = event.results[resultIndex];
        const text = result[0]?.transcript || "";

        if (result.isFinal) {
          finalText += ` ${text}`;
        } else {
          interimText += ` ${text}`;
        }
      }

      if (finalText.trim()) {
        const combinedTranscript =
          `${finalTranscriptRef.current} ${finalText}`.trim();
        finalTranscriptRef.current = combinedTranscript;
        setTranscript(combinedTranscript);
      }

      setInterimTranscript(interimText.trim());
    };

    recognition.onerror = (event) => {
      const messages = {
        "not-allowed":
          "Microphone access was blocked. Allow microphone access, then try again.",
        "no-speech":
          "No speech was heard. Move somewhere quieter and try again.",
        network:
          "The browser’s speech service could not connect. You can type your answer instead.",
      };

      setSpeechError(
        messages[event.error] ||
          "Voice transcription stopped unexpectedly. You can try again or type your answer.",
      );
      setIsListening(false);
    };

    recognition.onend = () => {
      setIsListening(false);
      setInterimTranscript("");
    };

    try {
      setSpeechError("");
      recognitionRef.current = recognition;
      recognition.start();
      setIsListening(true);
    } catch {
      setSpeechError(
        "The microphone could not start. Wait a moment and try again.",
      );
      setIsListening(false);
    }
  }

  return (
    <section className="voice-answer" aria-label="Spoken route answer">
      <div className="voice-controls">
        <button
          className={`voice-record ${isListening ? "is-listening" : ""}`}
          type="button"
          onClick={isListening ? stopListening : startListening}
          disabled={!speechSupported}
        >
          <span aria-hidden="true">{isListening ? "■" : "●"}</span>
          {isListening ? "Stop listening" : "Start microphone"}
        </button>
        {transcript && (
          <button
            className="voice-clear"
            type="button"
            onClick={() => {
              finalTranscriptRef.current = "";
              setTranscript("");
              setInterimTranscript("");
            }}
          >
            Clear answer
          </button>
        )}
      </div>

      {!speechSupported && (
        <p className="voice-support-note">
          This browser does not provide live speech transcription. Use the
          microphone on your phone keyboard or type below.
        </p>
      )}

      <label className="voice-transcript">
        <span>Your transcript</span>
        <textarea
          value={transcript}
          onChange={(event) => {
            finalTranscriptRef.current = event.target.value;
            setTranscript(event.target.value);
          }}
          placeholder="Your spoken route will appear here. You can correct any road name the microphone mishears."
          rows="5"
        />
      </label>

      {interimTranscript && (
        <p className="voice-interim" aria-live="polite">
          Listening: {interimTranscript}
        </p>
      )}
      {speechError && (
        <p className="voice-error" role="alert">
          {speechError}
        </p>
      )}

      <p className="voice-privacy">
        The transcript stays in this page unless you choose to share it. Your
        browser may use its own online speech service to recognise your voice.
      </p>

      <button
        className="primary reveal-route"
        onClick={() => {
          stopListening();
          reveal();
        }}
        type="button"
      >
        {transcript.trim()
          ? "Reveal route and score my answer"
          : "Reveal route without a voice score"}
      </button>
    </section>
  );
}

function VoiceScoreCard({
  route,
  transcript,
  score,
  selectedOptionId,
  correctOptionId,
}) {
  const [shareStatus, setShareStatus] = useState("");
  const canShare =
    typeof navigator !== "undefined" && typeof navigator.share === "function";

  async function shareAssessment() {
    const assessmentText = [
      `Hull route assessment: ${route.startName} to ${route.endName}`,
      `Candidate selected Route ${selectedOptionId}. Shortest route: Route ${correctOptionId}.`,
      `Automatic practice score: ${score.total}% — ${score.label}.`,
      `Road names heard: ${score.matchedRoads.join(", ") || "none"}.`,
      score.missedRoads.length
        ? `Road names not heard: ${score.missedRoads.join(", ")}.`
        : "All route road names were heard.",
      "",
      `Transcript: ${transcript}`,
      "",
      "This is a revision score, not an official licensing assessment.",
    ].join("\n");

    try {
      if (navigator.share) {
        await navigator.share({
          title: `Route assessment: ${route.startName} to ${route.endName}`,
          text: assessmentText,
        });
        setShareStatus("Share sheet opened.");
      } else {
        await navigator.clipboard.writeText(assessmentText);
        setShareStatus("Assessment copied. Paste it into a message or email.");
      }
    } catch (error) {
      if (error?.name !== "AbortError") {
        setShareStatus(
          "Could not share automatically. Select and copy the transcript instead.",
        );
      }
    }
  }

  return (
    <section className="voice-score" aria-labelledby="voice-score-heading">
      <div className="voice-score-summary">
        <div
          className={`voice-score-ring ${
            score.total >= 85
              ? "is-strong"
              : score.total >= 70
                ? "is-close"
                : "is-practice"
          }`}
        >
          <strong>{score.total}%</strong>
          <small>practice score</small>
        </div>
        <div>
          <small>Spoken-answer feedback</small>
          <h2 id="voice-score-heading">{score.label}</h2>
          <p>
            This checks the roads, their order, turn language and destination.
            It is useful practice, not an official pass or fail.
          </p>
        </div>
      </div>

      <div className="voice-score-breakdown">
        <article>
          <strong>{score.roadCoverage}%</strong>
          <span>Road names</span>
        </article>
        <article>
          <strong>{score.orderCoverage}%</strong>
          <span>Correct order</span>
        </article>
        <article>
          <strong>{score.directionCoverage}%</strong>
          <span>Turn language</span>
        </article>
        <article>
          <strong>{score.destinationMentioned ? "Yes" : "No"}</strong>
          <span>Destination</span>
        </article>
      </div>

      <ul className="voice-feedback-list">
        {score.feedback.map((feedbackItem) => (
          <li key={feedbackItem}>{feedbackItem}</li>
        ))}
      </ul>

      <details className="voice-transcript-review">
        <summary>Review my transcript</summary>
        <p>{transcript}</p>
      </details>

      <div className="voice-share">
        <button type="button" onClick={shareAssessment}>
          {canShare ? "Share with course leader" : "Copy assessment"}
        </button>
        <p>
          {canShare
            ? "You choose the person and app from your phone’s share sheet; nothing sends automatically."
            : "Copy the result, then paste it into a message or email."}
        </p>
        {shareStatus && <span aria-live="polite">{shareStatus}</span>}
      </div>
    </section>
  );
}

function RouteChoiceMap({
  route,
  options,
  selectedOptionId,
  correctOptionId,
  choiceLocked,
  revealed,
}) {
  const mapElementRef = useRef(null);
  const mapRef = useRef(null);
  const routeLayersRef = useRef([]);

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
    options.forEach((option) => {
      option.path.forEach((point) => bounds.extend(point));
    });
    map.fitBounds(bounds, {
      padding: [42, 42],
      maxZoom: 14,
    });

    return () => {
      map.remove();
      mapRef.current = null;
      routeLayersRef.current = [];
    };
  }, [options, route]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    routeLayersRef.current.forEach((layer) => layer.remove());
    routeLayersRef.current = [];

    function priority(option) {
      if (revealed && option.id === correctOptionId) return 3;
      if (option.id === selectedOptionId) return 2;
      return 1;
    }

    const orderedOptions = [...options].sort(
      (left, right) => priority(left) - priority(right),
    );

    for (const option of orderedOptions) {
      const optionStyle = ROUTE_OPTION_STYLES[option.id];
      const selected = option.id === selectedOptionId;
      const correct = option.id === correctOptionId;
      let style = {
        color: optionStyle.color,
        dashArray: optionStyle.dashArray,
        lineCap: "round",
        opacity: selected ? 1 : 0.62,
        weight: selected ? 8 : 5,
      };

      if (choiceLocked && !revealed) {
        style = selected
          ? {
              color: "#c77c10",
              dashArray: null,
              lineCap: "round",
              opacity: 1,
              weight: 8,
            }
          : {
              color: "#7f918f",
              dashArray: "4 9",
              lineCap: "round",
              opacity: 0.28,
              weight: 3,
            };
      }

      if (revealed) {
        if (correct) {
          style = {
            color: "#0b675d",
            dashArray: null,
            lineCap: "round",
            opacity: 1,
            weight: 8,
          };
        } else if (selected) {
          style = {
            color: "#b54b3a",
            dashArray: "9 7",
            lineCap: "round",
            opacity: 0.92,
            weight: 6,
          };
        } else {
          style = {
            color: "#879996",
            dashArray: "4 9",
            lineCap: "round",
            opacity: 0.22,
            weight: 3,
          };
        }
      }

      routeLayersRef.current.push(
        L.polyline(option.path, {
          ...style,
          interactive: false,
        }).addTo(map),
      );
    }
  }, [
    choiceLocked,
    correctOptionId,
    options,
    revealed,
    selectedOptionId,
  ]);

  return (
    <div
      className="assessment-map route-choice-map"
      ref={mapElementRef}
      role="img"
      aria-label={`Four route options from ${route.startName} to ${route.endName}`}
    />
  );
}
