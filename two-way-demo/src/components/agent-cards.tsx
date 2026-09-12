"use client";

/**
 * Components the AGENT renders.
 *
 * Every prop is optional and every array is guarded: tool arguments arrive
 * incrementally, token by token, BEFORE the Zod schema's defaults are applied.
 * A renderer that assumes `props.columns` exists will crash halfway through the
 * first stream. This is the single most common generative-UI bug.
 */

export interface BoardCardProps {
  headline?: string;
  note?: string;
  columns?: Array<{ title?: string; count?: number; points?: number } | null> | null;
  risks?: Array<string | null> | null;
  tone?: string;
}

const toneColor: Record<string, string> = {
  neutral: "var(--line-strong)",
  good: "var(--ok)",
  attention: "var(--warn)",
};

export function BoardCard({ headline, note, columns, risks, tone }: BoardCardProps) {
  return (
    <article className="gen-card" style={{ borderLeftColor: toneColor[tone ?? "neutral"] ?? toneColor.neutral }}>
      <h3>{headline || "Reading the board…"}</h3>
      {note ? <p className="gen-note">{note}</p> : null}

      {columns?.length ? (
        <div className="gen-columns">
          {columns.map((column, index) => (
            <div key={index} className="gen-column">
              <span className="gen-column-title">{column?.title || "…"}</span>
              <span className="gen-column-count">{column?.count ?? "–"}</span>
              <span className="gen-column-points">{column?.points ?? 0}pt</span>
            </div>
          ))}
        </div>
      ) : null}

      {risks?.length ? (
        <ul className="gen-risks">
          {risks.map((risk, index) => (
            <li key={index}>{risk || "…"}</li>
          ))}
        </ul>
      ) : null}
    </article>
  );
}

export interface PlanCardProps {
  rationale?: string;
  moves?: Array<{ cardId?: string; to?: string; why?: string } | null> | null;
  onApply?: () => void;
  onDiscard?: () => void;
  settled?: string;
}

export function PlanCard({ rationale, moves, onApply, onDiscard, settled }: PlanCardProps) {
  return (
    <article className="gen-card gen-card--plan">
      <h3>Proposed reorganization</h3>
      <p className="gen-note">{rationale || "Working out a plan…"}</p>

      <ul className="gen-moves">
        {moves?.length ? (
          moves.map((move, index) => (
            <li key={index}>
              <code>{move?.cardId || "…"}</code>
              <span className="gen-arrow" aria-hidden="true">
                {"→"}
              </span>
              <strong>{move?.to || "…"}</strong>
              {move?.why ? <em>{move.why}</em> : null}
            </li>
          ))
        ) : (
          <li className="gen-move-empty">Planning…</li>
        )}
      </ul>

      {settled ? (
        <p className="gen-settled">{settled}</p>
      ) : (
        <div className="gen-actions">
          <button type="button" className="btn btn--primary" onClick={onApply}>
            Apply to board
          </button>
          <button type="button" className="btn" onClick={onDiscard}>
            Discard
          </button>
        </div>
      )}
    </article>
  );
}
