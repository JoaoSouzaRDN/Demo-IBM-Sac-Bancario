import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";
import {
  Processing,
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
          setSteps(event.steps);
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
      setSaved((previous) =>
        previous.map(
          (item) =>
            cases.find(
              (updated) =>
                updated.id === item.id && updated.category === item.category,
            ) || item,
        ),
      );
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
                  {message.steps && (
                    <Processing steps={message.steps} busy={false} />
                  )}
                  <div className={`message-row ${message.role}`}>
                    <span className="message-author">
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
          <SavedSidebar
            saved={saved}
            busy={busy}
            askDelete={setDeleting}
            refresh={(item) =>
              send(
                `Qual é o status atual da consulta ${item.title}? Categoria: ${item.category}; registro confirmado: ${item.id}. Consulte novamente no banco, por favor.`,
              )
            }
          />
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
