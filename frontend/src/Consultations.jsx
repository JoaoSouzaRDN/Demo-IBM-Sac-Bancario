import React, { useEffect, useLayoutEffect, useRef } from "react";

const labels = {
  pending: "Pendente",
  active: "Ativo",
  contested: "Em contestação",
  overdue: "Em atraso",
  needs_review: "Em análise",
  completed: "Concluído",
};
export const statusLabel = (status) => labels[status] || status;
// Finished steps float to the top as they get ticked off; whatever is still
// active (or pending) sinks to the bottom, so the list visibly "empties out"
// upward instead of just flipping icons in place.
const stepRank = { done: 0, error: 0, active: 1, pending: 2 };
function orderedSteps(steps) {
  return steps
    .map((step, index) => ({ step, index }))
    .sort((a, b) => {
      const rank = (stepRank[a.step.status] ?? 2) - (stepRank[b.step.status] ?? 2);
      return rank !== 0 ? rank : a.index - b.index;
    })
    .map(({ step }) => step);
}
// FLIP (First-Last-Invert-Play): when a step is ticked off and its rendered
// position jumps to the top of the list, this animates that jump instead of
// letting it snap, so the checked step visibly "flies up" as the active dot
// sinks toward the bottom.
function useStepFlip(dep) {
  const containerRef = useRef(null);
  const positions = useRef(new Map());
  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) {
      positions.current = new Map();
      return;
    }
    const nodes = container.querySelectorAll("[data-flip-key]");
    const next = new Map();
    nodes.forEach((node) => {
      const key = node.dataset.flipKey;
      const top = node.getBoundingClientRect().top;
      next.set(key, top);
      const prevTop = positions.current.get(key);
      if (prevTop != null && prevTop !== top) {
        const delta = prevTop - top;
        node.style.transition = "none";
        node.style.transform = `translateY(${delta}px)`;
        requestAnimationFrame(() => {
          node.style.transition = "transform 0.35s ease";
          node.style.transform = "";
        });
      }
    });
    positions.current = next;
  }, [dep]);
  return containerRef;
}
export function validCases(cases) {
  return Array.isArray(cases)
    ? cases
        .filter(
          (item) =>
            item &&
            typeof item.id === "string" &&
            typeof item.title === "string" &&
            typeof item.status === "string" &&
            ["pix", "cartao", "compra", "parcela", "perfil"].includes(
              item.category,
            ),
        )
        .map(({ id, title, status, category, protocol }) => ({
          id,
          title,
          status,
          category,
          protocol: typeof protocol === "string" ? protocol : "",
        }))
    : [];
}

export function Processing({
  steps,
  busy,
  error,
  expanded: controlledExpanded,
  onToggle,
}) {
  const [localExpanded, setLocalExpanded] = React.useState(true);
  const controlled = controlledExpanded !== undefined;
  const expanded = controlled ? controlledExpanded : localExpanded;
  const toggle = controlled ? onToggle : () => setLocalExpanded((value) => !value);
  const active = steps.find((step) => step.status === "active");
  const listRef = useStepFlip(steps);
  return (
    <div className="processing">
      <div className="processing-bar">
        {!expanded && (
          <>
            <span
              className={`mini-light big ${busy ? "active" : error ? "failed" : "done"}`}
            >
              {!busy && !error && <Icon check />}
            </span>
            <span className={busy ? "shimmer-text" : undefined}>
              {busy
                ? active?.label || "Processando solicitação"
                : error
                  ? "Processamento interrompido"
                  : `${steps.length} etapas concluídas`}
            </span>
          </>
        )}
        <button
          className="processing-chevron-btn"
          onClick={toggle}
          aria-expanded={expanded}
          aria-label={expanded ? "Recolher etapas" : "Expandir etapas"}
        >
          {expanded ? "⌃" : "⌄"}
        </button>
      </div>
      {expanded && (
        <ol className="step-flow" ref={listRef}>
          {orderedSteps(steps).map((step) => (
            <li
              key={step.id}
              data-flip-key={step.id}
              className={`flow-${step.status}`}
            >
              <span className="flow-light">
                {step.status === "done" ? <Icon check /> : step.status === "error" ? "!" : null}
              </span>
              <span className={step.status === "active" ? "shimmer-text" : undefined}>
                {step.label}
              </span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

export function LiveProgress({ history = [], steps, busy, error }) {
  const [expandedTurns, setExpandedTurns] = React.useState({});
  const listRef = useStepFlip(steps);
  const hasSteps = steps.length > 0;
  const hasAny = hasSteps || history.length > 0;
  const done = steps.filter((step) => step.status === "done").length;
  const totalDone =
    history.reduce((sum, turn) => sum + turn.steps.length, 0) + done;
  const totalSteps =
    history.reduce((sum, turn) => sum + turn.steps.length, 0) + steps.length;
  return (
    <aside className="progress-panel live-panel panel-fade" aria-label="Andamento da solicitação">
      <div className="panel-heading">
        <span className="eyebrow">ACOMPANHAMENTO</span>
        <span className={`connection ${busy ? "working" : ""}`} />
      </div>
      <h2>Andamento</h2>
      <p className="panel-subtitle">
        {busy
          ? "Acompanhe em tempo real o que o assistente está fazendo."
          : hasAny
            ? "Histórico deste atendimento."
            : "As etapas aparecem aqui assim que você enviar uma mensagem."}
      </p>
      <div className="live-scroll">
      {!hasAny && (
        <div className="progress-empty">
          <div className="orbit">
            <span />
            <span />
            <span />
          </div>
          <strong>Aguardando sua mensagem</strong>
          <p>Nenhuma solicitação em andamento no momento.</p>
        </div>
      )}
      {hasAny && (
        <ol className="steps" ref={listRef}>
          {history.map((turn) => {
            const isOpen = !!expandedTurns[turn.id];
            return (
              <li key={turn.id} data-flip-key={turn.id} className="step done turn-group">
                <button
                  className="turn-toggle"
                  onClick={() =>
                    setExpandedTurns((previous) => ({
                      ...previous,
                      [turn.id]: !previous[turn.id],
                    }))
                  }
                  aria-expanded={isOpen}
                >
                  <span className="step-light">
                    <Icon check />
                  </span>
                  <span>
                    <span className="step-label">{turn.title}</span>
                    <small>{turn.steps.length} etapas concluídas</small>
                  </span>
                  <span className="turn-chevron">{isOpen ? "⌃" : "⌄"}</span>
                </button>
                {isOpen && (
                  <ol className="compact-steps turn-substeps">
                    {orderedSteps(turn.steps).map((step) => (
                      <li key={step.id}>
                        <span className={step.status}>
                          {step.status === "done"
                            ? "✓"
                            : step.status === "error"
                              ? "!"
                              : "•"}
                        </span>
                        {step.label}
                      </li>
                    ))}
                  </ol>
                )}
              </li>
            );
          })}
          {orderedSteps(steps).map((step) => (
            <li key={step.id} data-flip-key={step.id} className={`step ${step.status}`}>
              <span className="step-light">
                {step.status === "done" ? <Icon check /> : step.status === "error" ? "!" : null}
              </span>
              <span>
                <span
                  className={`step-label ${step.status === "active" ? "shimmer-text" : ""}`}
                >
                  {step.label}
                </span>
                {step.status === "active" && <small>Em andamento…</small>}
                {step.status === "done" && <small>Concluído</small>}
                {step.status === "error" && <small>Falhou</small>}
              </span>
            </li>
          ))}
        </ol>
      )}
      </div>
      {hasAny && (
        <p className="progress-summary">
          <span>{totalDone} de {totalSteps} etapas concluídas</span>
          {error && <span className="progress-error">Interrompido</span>}
        </p>
      )}
    </aside>
  );
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

export function SavedSidebar({ saved, busy, refresh, askDelete, flashKey }) {
  return (
    <aside className="progress-panel saved-panel panel-fade" aria-label="Consultas salvas">
      <span className="eyebrow">SEUS ACOMPANHAMENTOS</span>
      <h2>
        Consultas salvas <span className="saved-count">{saved.length}</span>
      </h2>
      <p className="panel-subtitle">
        O último status consultado, sempre à mão.
      </p>
      {!saved.length && (
        <div className="progress-empty">
          <div className="orbit">
            <span />
            <span />
            <span />
          </div>
          <strong>Nenhuma consulta salva</strong>
          <p>
            Após consultar uma situação, clique em “Salvar consulta” na
            resposta.
          </p>
        </div>
      )}
      <div className="saved-list">
        {saved.map((item) => (
          <article
            className={`saved-card ${flashKey === `${item.category}:${item.id}` ? "just-updated" : ""}`}
            key={`${item.category}:${item.id}`}
          >
            <button
              className="saved-open"
              disabled={busy}
              onClick={() => refresh(item)}
              aria-label={`Atualizar ${item.title}`}
            >
              <span className="saved-category">{item.category}</span>
              <strong>{item.title}</strong>
              <span className="status-badge">{statusLabel(item.status)}</span>
              <small>
                Consultado{" "}
                {new Date(item.checkedAt).toLocaleString("pt-BR", {
                  day: "2-digit",
                  month: "2-digit",
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </small>
              <span className="refresh-label">
                Consultar status novamente ↗
              </span>
            </button>
            <button
              className="delete-saved"
              onClick={() => askDelete(item)}
              aria-label={`Excluir ${item.title}`}
              title="Excluir consulta salva"
            >
              ×
            </button>
          </article>
        ))}
      </div>
      {saved.length > 0 && (
        <p className="saved-note">
          Salvas neste navegador. Clique para pedir uma nova consulta ao agente.
        </p>
      )}
    </aside>
  );
}

export function DeleteConfirmation({ item, cancel, confirm }) {
  const dialog = useRef(null);
  useEffect(() => {
    dialog.current.showModal();
  }, []);
  return (
    <dialog
      className="delete-dialog"
      ref={dialog}
      onCancel={(event) => {
        event.preventDefault();
        cancel();
      }}
      aria-labelledby="delete-title"
    >
      <h2 id="delete-title">Excluir consulta salva?</h2>
      <p>Remover “{item.title}” da sua lista?</p>
      <p className="dialog-note">
        Isso não cancela nem altera o chamado no banco.
      </p>
      <div className="dialog-actions">
        <button autoFocus onClick={cancel}>
          Cancelar
        </button>
        <button className="confirm-delete" onClick={confirm}>
          Excluir consulta
        </button>
      </div>
    </dialog>
  );
}
