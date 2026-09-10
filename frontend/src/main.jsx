import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";

const greeting =
  "Olá! Sou o assistente do RDN Bank. Vou consultar os dados e orientar você com segurança. Como posso ajudar?";
const suggestions = [
  "Fiz um Pix e o dinheiro não chegou",
  "Perdi meu cartão",
  "Quero contestar uma compra",
  "Minha parcela está atrasada",
  "Quero atualizar meus dados",
];

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

function ProgressPanel({ steps, busy, error }) {
  const completed = steps.filter((step) => step.status === "done").length;
  return (
    <aside className="progress-panel" aria-label="Andamento do atendimento">
      <div className="panel-heading">
        <span className="eyebrow">EM TEMPO REAL</span>
        <span className={`connection ${busy ? "working" : ""}`} />
      </div>
      <h2>Andamento</h2>
      <p className="panel-subtitle">
        {error
          ? "Não foi possível concluir."
          : busy
            ? "Seu pedido está sendo processado."
            : steps.length
              ? "Resposta pronta. Podemos continuar."
              : "Cada etapa do seu pedido, aqui."}
      </p>
      {steps.length ? (
        <ol className="steps" aria-live="polite">
          {steps.map((step) => (
            <li key={step.id} className={`step ${step.status}`}>
              <span className="step-light">
                {step.status === "done" && <Icon check />}
                {step.status === "error" && "!"}
              </span>
              <div>
                <span className="step-label">{step.label}</span>
                <small>
                  {step.status === "done"
                    ? "Concluído"
                    : step.status === "error"
                      ? "Interrompido"
                      : step.status === "active"
                        ? "Em andamento"
                        : "Aguardando"}
                </small>
              </div>
            </li>
          ))}
        </ol>
      ) : (
        <div className="progress-empty">
          <div className="orbit">
            <span />
            <span />
            <span />
          </div>
          <strong>Vamos começar?</strong>
          <p>Envie uma mensagem para acompanhar o atendimento.</p>
        </div>
      )}
      {steps.length > 0 && (
        <div className="progress-summary">
          <span>
            {completed}{" "}
            {completed === 1 ? "etapa concluída" : "etapas concluídas"}
          </span>
          <span>{busy ? "Processando" : error ? "Pausado" : "Finalizado"}</span>
        </div>
      )}
    </aside>
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
  const request = useRef(null);
  const thread = useRef(null);
  const scroll = useRef(null);
  const inputRef = useRef(null);
  useEffect(() => {
    scroll.current.scrollTop = scroll.current.scrollHeight;
  }, [messages]);
  useEffect(() => () => request.current?.abort(), []);
  function reset() {
    request.current?.abort();
    request.current = null;
    thread.current = null;
    setMessages([{ role: "agent", text: greeting }]);
    setSteps([]);
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
    setMessages((previous) => [...previous, { role: "user", text }]);
    setInput("");
    setBusy(true);
    setError("");
    setSteps([
      { id: "connect", label: "Enviando sua solicitação", status: "active" },
    ]);
    let answer = "";
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
        if (event.event === "progress") setSteps(event.steps);
        if (event.reply) answer = event.reply;
      });
      if (!answer.trim())
        throw new Error("O agente não retornou uma resposta. Tente novamente.");
      if (controller.signal.aborted) return;
      setMessages((previous) => [...previous, { role: "agent", text: answer }]);
    } catch (failure) {
      if (controller.signal.aborted) return;
      setError(failure.message);
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
                  <div className={`message-row ${message.role}`}>
                    <span className="message-author">
                      {message.role === "agent" ? "RDN Assistente" : "Você"}
                    </span>
                    <div className={`msg ${message.role}`}>{message.text}</div>
                  </div>
                  {index === 0 && messages.length === 1 && (
                    <div id="suggestions" className="suggestions">
                      <span className="suggestion-label">
                        Como podemos ajudar hoje?
                      </span>
                      <div>
                        {suggestions.map((text) => (
                          <button key={text} onClick={() => send(text)}>
                            {text}
                            <Icon />
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </React.Fragment>
              ))}
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
          <ProgressPanel steps={steps} busy={busy} error={error} />
        </div>
      </section>
    </main>
  );
}
createRoot(document.getElementById("root")).render(<App />);
