"use client";

/**
 * The point of the demo, made visible.
 *
 * Every crossing of the agent<->UI boundary appends a line here, tagged with
 * the CopilotKit primitive that carried it. Nothing in the app depends on this
 * panel; it exists so you can watch the loop instead of inferring it.
 */
export type Direction = "agent->ui" | "ui->agent";

export type LogEntry = {
  key: string;
  direction: Direction;
  channel: string;
  detail: string;
  at: string;
};

export function ChannelLog({ entries }: { entries: LogEntry[] }) {
  return (
    <section className="panel log-panel" aria-labelledby="log-title">
      <header className="panel-header">
        <h2 id="log-title">Channel log</h2>
        <p>Every message that crosses the agent&nbsp;/&nbsp;UI boundary.</p>
      </header>

      {entries.length === 0 ? (
        <p className="log-empty">
          Nothing yet. Drag a card, or ask the assistant to tidy the board.
        </p>
      ) : (
        <ol className="log-list">
          {entries.map((entry) => (
            <li key={entry.key} className={`log-row log-row--${entry.direction === "agent->ui" ? "down" : "up"}`}>
              <span className="log-arrow" aria-hidden="true">
                {entry.direction === "agent->ui" ? "↓" : "↑"}
              </span>
              <div className="log-body">
                <div className="log-meta">
                  <code className="log-channel">{entry.channel}</code>
                  <time>{entry.at}</time>
                </div>
                <p className="log-detail">{entry.detail}</p>
              </div>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
