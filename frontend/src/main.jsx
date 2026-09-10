import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";
import {
  Processing,
  LiveProgress,
  SavedSidebar,
  DeleteConfirmation,
  validCases,
  statusLabel,
} from "./Consultations";

const greeting =
  "Olá! Sou o assistente do RDN Bank. Vou consultar os dados e orientar você com segurança. Como posso ajudar?";
const suggestions = [
  "Fiz um Pix e o dinheiro não chegou",
  "Perdi meu cartão",
  "Quero contestar uma compra",
  "Minha parcela está atrasada",
  "Quero atualizar meus dados",
];
const categoryLabel = {
  pix: "Pix",
  cartao: "Cartão",
  compra: "Compra",
  parcela: "Parcela",
  perfil: "Cadastro",
};
function turnTitle(text, cases) {
  const category = cases?.[0]?.category;
  if (category) return `Consulta ${categoryLabel[category] || category} enviada`;
  const trimmed = (text || "").trim();
  if (!trimmed) return "Atendimento";
  return trimmed.length > 46 ? `${trimmed.slice(0, 46)}…` : trimmed;
}

function Icon({ check = false }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d={check ? "m6 12 4 4 8-8" : "m5 12 14 0m-6-6 6 6-6 6"}
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

async function readEvents(response, receive) {
  if (!response.ok)
    throw new Error("Não foi possível conectar. Tente novamente.");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  function frame(block) {
    const raw = block
      .split("\n")
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trimStart())
      .join("\n");
    if (!raw || raw === "[DONE]") return;
    const event = JSON.parse(raw);
    if (typeof event !== "object" || event === null) return;
    if (event.error)
      throw new Error(
        typeof event.error === "string"
          ? event.error
          : "O agente não conseguiu concluir.",
      );
    receive(event);
  }
  while (true) {
    const { value, done } = await reader.read();
    buffer += decoder.decode(value, { stream: !done });
    buffer = buffer.replace(/\r\n/g, "\n");
    let boundary;
    while ((boundary = buffer.indexOf("\n\n")) !== -1) {
      frame(buffer.slice(0, boundary));
      buffer = buffer.slice(boundary + 2);
    }
    if (done) {
      if (buffer.trim()) frame(buffer);
      break;
    }
  }
}

function App() {
  const [messages, setMessages] = useState([{ role: "agent", text: greeting }]);
  const [input, setInput] = useState("");
  const [steps, setSteps] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(() => {
    try {
      const stored = JSON.parse(
        localStorage.getItem("rdn-consultations-v1") || "[]",
      );
      return validCases(stored).map((item) => ({
        ...item,
        checkedAt:
          stored.find(
            (source) =>
              source.id === item.id && source.category === item.category,
          )?.checkedAt || new Date().toISOString(),
      }));
    } catch {
      return [];
    }
  });
  const [deleting, setDeleting] = useState(null);
  const [flashKey, setFlashKey] = useState(null);
  const [history, setHistory] = useState([]);
  const [expandedSuggestions, setExpandedSuggestions] = useState(false);
  const [collapsedSteps, setCollapsedSteps] = useState({});
  const lastTurn = useRef(null);
  const stepQueue = useRef([]);
  const stepTimer = useRef(null);
  function clearStepQueue() {
    stepQueue.current = [];
    if (stepTimer.current) clearTimeout(stepTimer.current);
    stepTimer.current = null;
  }
  function drainStepQueue() {
    if (stepTimer.current) return;
    const next = stepQueue.current.shift();
    if (!next) return;
    setSteps(next);
    stepTimer.current = setTimeout(() => {
      stepTimer.current = null;
      drainStepQueue();
    }, 260);
  }
  function queueSteps(nextSteps) {
    // Snapshots can arrive in a burst (several tool calls resolved in the
    // same polling window); reveal them one at a time so the panel visibly
    // progresses instead of jumping straight to the final state.
    stepQueue.current.push(nextSteps);
    drainStepQueue();
  }
  useEffect(() => {
    try {
      localStorage.setItem("rdn-consultations-v1", JSON.stringify(saved));
    } catch {}
  }, [saved]);
  const request = useRef(null);
  const thread = useRef(null);
  const scroll = useRef(null);
  const inputRef = useRef(null);
  useEffect(() => {
    scroll.current.scrollTop = scroll.current.scrollHeight;
  }, [messages]);
  useEffect(
    () => () => {
      request.current?.abort();
      if (stepTimer.current) clearTimeout(stepTimer.current);
    },
    [],
  );
  function reset() {
    request.current?.abort();
    request.current = null;
    thread.current = null;
    lastTurn.current = null;
    clearStepQueue();
    setMessages([{ role: "agent", text: greeting }]);
    setSteps([]);
    setHistory([]);
    setExpandedSuggestions(false);
    setCollapsedSteps({});
    setBusy(false);
    setError("");
    setInput("");
    inputRef.current?.focus();
  }
  async function send(text) {
    text = text.trim();
    if (!text || request.current) return;
    const controller = new AbortController();
    request.current = controller;
    clearStepQueue();
    if (steps.length > 0) {
      const finishedSteps = steps.map((step) =>
        step.status === "active" ? { ...step, status: "done" } : step,
      );
      const title = turnTitle(lastTurn.current?.text, lastTurn.current?.cases);
      setHistory((previous) => [
        ...previous,
        { id: `turn-${previous.length}-${Date.now()}`, title, steps: finishedSteps },
      ]);
    }
    lastTurn.current = { text, cases: [] };
    setMessages((previous) => [...previous, { role: "user", text }]);
    setInput("");
    setBusy(true);
    setError("");
    setSteps([
      { id: "understand", label: "Entendendo sua solicitação", status: "active" },
    ]);
    let answer = "";
    let turnSteps = [];
    let cases = [];
    try {
      const response = await fetch("/api/chat/stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text, threadId: thread.current }),
        signal: controller.signal,
      });
      await readEvents(response, (event) => {
        if (controller.signal.aborted) return;
        if (event.thread_id) thread.current = event.thread_id;
        if (event.event === "progress") {
          turnSteps = event.steps;
          queueSteps(event.steps);
        }
        if (event.reply) answer = event.reply;
        if (event.cases)
          cases = validCases(event.cases).map((item) => ({
            ...item,
            checkedAt: new Date().toISOString(),
          }));
      });
      if (!answer.trim())
        throw new Error("O agente não retornou uma resposta. Tente novamente.");
      if (controller.signal.aborted) return;
      setMessages((previous) => [
        ...previous,
        { role: "agent", text: answer, steps: turnSteps, cases },
      ]);
      lastTurn.current = { text, cases };
      const changed = cases.find((updated) => {
        const item = saved.find(
          (stored) =>
            stored.id === updated.id && stored.category === updated.category,
        );
        return item && item.status !== updated.status;
      });
      setSaved((previous) =>
        previous.map(
          (item) =>
            cases.find(
              (updated) =>
                updated.id === item.id && updated.category === item.category,
            ) || item,
        ),
      );
      if (changed) {
        const key = `${changed.category}:${changed.id}`;
        setFlashKey(key);
        setTimeout(() => setFlashKey((current) => (current === key ? null : current)), 2200);
      }
    } catch (failure) {
      if (controller.signal.aborted) return;
      setError(failure.message);
      clearStepQueue();
      setSteps((previous) =>
        previous.map((step) =>
          step.status === "active" ? { ...step, status: "error" } : step,
        ),
      );
    } finally {
      if (request.current === controller) {
        request.current = null;
        setBusy(false);
      }
    }
  }
  function refreshItem(item) {
    send(
      `Qual é o status atual da consulta ${item.title}? Categoria: ${item.category}; registro confirmado: ${item.id}. Consulte novamente no banco, por favor.`,
    );
  }
  return (
    <main className="page">
      <section className="chat" aria-label="Chat RDN Bank">
        <header className="chat-header">
          <div className="brand">
            <span className="brand-light" />
            <div>
              <h1>RDN Bank</h1>
              <p>SAC Inteligente</p>
            </div>
          </div>
          <button id="reset" className="gradient new-chat" onClick={reset}>
            <span>＋</span> Novo atendimento
          </button>
        </header>
        <div className="workspace">
          <section className="conversation">
            <div
              className="messages"
              id="messages"
              ref={scroll}
              role="log"
              aria-label="Mensagens do atendimento"
            >
              {messages.map((message, index) => (
                <React.Fragment key={index}>
                  {message.steps && (
                    <Processing
                      steps={message.steps}
                      busy={false}
                      expanded={!collapsedSteps[index]}
                      onToggle={() =>
                        setCollapsedSteps((previous) => ({
                          ...previous,
                          [index]: !previous[index],
                        }))
                      }
                    />
                  )}
                  <div className={`message-row ${message.role}`}>
                    <span className="message-author">
                      {message.role === "agent" && message.steps ? (
                        <button
                          className="steps-toggle"
                          onClick={() =>
                            setCollapsedSteps((previous) => ({
                              ...previous,
                              [index]: !previous[index],
                            }))
                          }
                          aria-expanded={!collapsedSteps[index]}
                          aria-label={
                            collapsedSteps[index]
                              ? "Expandir etapas"
                              : "Recolher etapas"
                          }
                        >
                          {collapsedSteps[index] ? "⌄" : "⌃"}
                        </button>
                      ) : (
                        message.role === "user" && (
                          <span className="avatar user" />
                        )
                      )}
                      {message.role === "agent" ? "RDN Assistente" : "Você"}
                    </span>
                    <div className={`msg ${message.role}`}>{message.text}</div>
                    {message.cases?.map((item) => {
                      const exists = saved.some(
                        (stored) =>
                          stored.id === item.id &&
                          stored.category === item.category,
                      );
                      return (
                        <button
                          className="save-case"
                          key={`${item.category}:${item.id}`}
                          disabled={exists}
                          onClick={() =>
                            setSaved((previous) => [
                              ...previous.filter(
                                (stored) =>
                                  stored.id !== item.id ||
                                  stored.category !== item.category,
                              ),
                              item,
                            ])
                          }
                        >
                          {exists ? "✓ Consulta salva" : "＋ Salvar consulta"} ·{" "}
                          {statusLabel(item.status)}
                        </button>
                      );
                    })}
                  </div>
                  {index === 0 &&
                    messages.length === 1 &&
                    (() => {
                      const savedEntries = saved
                        .slice()
                        .sort(
                          (a, b) => new Date(b.checkedAt) - new Date(a.checkedAt),
                        )
                        .map((item) => ({
                          key: `${item.category}:${item.id}`,
                          label: item.title,
                          priority: true,
                          onClick: () => refreshItem(item),
                        }));
                      const defaultEntries = suggestions.map((text) => ({
                        key: text,
                        label: text,
                        priority: false,
                        onClick: () => send(text),
                      }));
                      const combined = [...savedEntries, ...defaultEntries];
                      const visible = expandedSuggestions
                        ? combined
                        : combined.slice(0, 5);
                      const hidden = combined.length - visible.length;
                      return (
                        <div id="suggestions" className="suggestions">
                          <span className="suggestion-label">
                            Como podemos ajudar hoje?
                          </span>
                          <div>
                            {visible.map((entry) => (
                              <button
                                key={entry.key}
                                className={entry.priority ? "priority" : undefined}
                                onClick={entry.onClick}
                                title={
                                  entry.priority
                                    ? `Consultar novamente: ${entry.label}`
                                    : undefined
                                }
                              >
                                {entry.label}
                                <Icon />
                              </button>
                            ))}
                            {(hidden > 0 || expandedSuggestions) && (
                              <button
                                className="more-suggestions"
                                onClick={() =>
                                  setExpandedSuggestions((value) => !value)
                                }
                                aria-label={
                                  expandedSuggestions
                                    ? "Mostrar menos sugestões"
                                    : "Ver mais sugestões"
                                }
                                title={
                                  expandedSuggestions
                                    ? "Mostrar menos sugestões"
                                    : "Ver mais sugestões"
                                }
                              >
                                {expandedSuggestions ? (
                                  <span className="chevron-up">⌃</span>
                                ) : (
                                  <span className="dots">
                                    <span />
                                    <span />
                                    <span />
                                  </span>
                                )}
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    })()}
                </React.Fragment>
              ))}
              {(busy || error) && (
                <Processing steps={steps} busy={busy} error={error} />
              )}
            </div>
            <form
              id="form"
              onSubmit={(event) => {
                event.preventDefault();
                send(input);
              }}
            >
              <div className="compose">
                <input
                  id="input"
                  ref={inputRef}
                  value={input}
                  onChange={(event) => setInput(event.target.value)}
                  placeholder="Escreva sua mensagem…"
                  aria-label="Sua mensagem"
                  autoComplete="off"
                />
                <button
                  className="gradient send"
                  disabled={busy || !input.trim()}
                  type="submit"
                >
                  Enviar
                  <Icon />
                </button>
              </div>
              {error && (
                <p className="error" role="alert">
                  {error}
                </p>
              )}
            </form>
          </section>
          <div className="side-rail">
            {steps.length > 0 ? (
              <LiveProgress
                key="live"
                history={history}
                steps={steps}
                busy={busy}
                error={error}
              />
            ) : (
              <SavedSidebar
                key="saved"
                saved={saved}
                busy={busy}
                flashKey={flashKey}
                askDelete={setDeleting}
                refresh={refreshItem}
              />
            )}
          </div>
        </div>
        {deleting && (
          <DeleteConfirmation
            item={deleting}
            cancel={() => setDeleting(null)}
            confirm={() => {
              setSaved((previous) =>
                previous.filter(
                  (item) =>
                    item.id !== deleting.id ||
                    item.category !== deleting.category,
                ),
              );
              setDeleting(null);
            }}
          />
        )}
      </section>
    </main>
  );
}
createRoot(document.getElementById("root")).render(<App />);
