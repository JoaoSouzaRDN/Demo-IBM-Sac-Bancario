import React, { useEffect, useRef } from "react";

const labels = {
  pending: "Pendente",
  active: "Ativo",
  contested: "Em contestação",
  overdue: "Em atraso",
  needs_review: "Em análise",
  completed: "Concluído",
};
export const statusLabel = (status) => labels[status] || status;
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

export function Processing({ steps, busy, error }) {
  const [expanded, setExpanded] = React.useState(false);
  const active = steps.find((step) => step.status === "active");
  return (
    <div className="processing">
      <button
        className="processing-toggle"
        onClick={() => setExpanded((value) => !value)}
        aria-expanded={expanded}
      >
        <span
          className={`mini-light ${busy ? "active" : error ? "failed" : "done"}`}
        >
          {!busy && !error && "✓"}
        </span>
        <span>
          {busy
            ? active?.label || "Processando solicitação"
            : error
              ? "Processamento interrompido"
              : `${steps.length} etapas concluídas`}
        </span>
        <span className="processing-chevron">{expanded ? "⌃" : "⌄"}</span>
      </button>
      {expanded && (
        <ol className="compact-steps">
          {steps.map((step) => (
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
    </div>
  );
}

export function SavedSidebar({ saved, busy, refresh, askDelete }) {
  return (
    <aside className="progress-panel saved-panel" aria-label="Consultas salvas">
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
          <article className="saved-card" key={`${item.category}:${item.id}`}>
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
