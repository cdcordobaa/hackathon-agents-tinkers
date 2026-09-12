"use client";

/**
 * The board itself. Native HTML5 drag and drop, no dependencies.
 *
 * This component knows nothing about CopilotKit. It reports a drop upward via
 * `onMove`, exactly as it would in an app with no agent in it — which is the
 * honest way to retrofit an agent onto a UI you already have.
 */
import { useState } from "react";
import {
  COLUMNS,
  WIP_LIMIT,
  cardsIn,
  isColumnId,
  type Board,
  type Card,
  type ColumnId,
} from "@/lib/board";

export function BoardView({
  board,
  onMove,
  recentlyChanged,
}: {
  board: Board;
  onMove: (cardId: string, to: ColumnId) => void;
  recentlyChanged: string[];
}) {
  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState<ColumnId | null>(null);

  const drop = (to: ColumnId) => (event: React.DragEvent) => {
    event.preventDefault();
    setOver(null);
    setDragging(null);
    const cardId = event.dataTransfer.getData("text/plain");
    const card = board.cards.find((item) => item.id === cardId);
    if (!card || card.column === to) return;
    onMove(cardId, to);
  };

  return (
    <div className="board" role="list">
      {COLUMNS.map((column) => {
        const cards = cardsIn(board, column.id);
        const points = cards.reduce((total, card) => total + card.points, 0);
        const overLimit = column.id === "in_progress" && cards.length > WIP_LIMIT;

        return (
          <section
            key={column.id}
            role="listitem"
            className={[
              "column",
              over === column.id ? "column--over" : "",
              overLimit ? "column--warn" : "",
            ].join(" ")}
            onDragOver={(event) => {
              event.preventDefault();
              setOver(column.id);
            }}
            onDragLeave={() => setOver((current) => (current === column.id ? null : current))}
            onDrop={drop(column.id)}
          >
            <header className="column-header">
              <h3>{column.title}</h3>
              <span className="column-count">
                {cards.length}
                {column.id === "in_progress" ? `/${WIP_LIMIT}` : ""} &middot; {points}pt
              </span>
            </header>

            {overLimit ? <p className="column-warn">Over WIP limit</p> : null}

            <ul className="card-list">
              {cards.map((card) => (
                <CardTile
                  key={card.id}
                  card={card}
                  dragging={dragging === card.id}
                  flash={recentlyChanged.includes(card.id)}
                  onDragStart={(event) => {
                    event.dataTransfer.setData("text/plain", card.id);
                    event.dataTransfer.effectAllowed = "move";
                    setDragging(card.id);
                  }}
                  onDragEnd={() => setDragging(null)}
                  onKeyMove={(direction) => {
                    const index = COLUMNS.findIndex((item) => item.id === card.column);
                    const next = COLUMNS[index + direction]?.id;
                    if (isColumnId(next)) onMove(card.id, next);
                  }}
                />
              ))}
              {cards.length === 0 ? <li className="card-empty">Empty</li> : null}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

function CardTile({
  card,
  dragging,
  flash,
  onDragStart,
  onDragEnd,
  onKeyMove,
}: {
  card: Card;
  dragging: boolean;
  flash: boolean;
  onDragStart: (event: React.DragEvent) => void;
  onDragEnd: () => void;
  onKeyMove: (direction: -1 | 1) => void;
}) {
  return (
    <li
      className={[
        "card",
        dragging ? "card--dragging" : "",
        flash ? "card--flash" : "",
        card.blocked ? "card--blocked" : "",
      ].join(" ")}
      draggable
      tabIndex={0}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onKeyDown={(event) => {
        // Keyboard parity with dragging — same onMove path, same agent report.
        if (event.key === "ArrowRight") { event.preventDefault(); onKeyMove(1); }
        if (event.key === "ArrowLeft") { event.preventDefault(); onKeyMove(-1); }
      }}
      aria-label={`${card.id} ${card.title}. Use left and right arrow keys to move between columns.`}
    >
      <div className="card-top">
        <code>{card.id}</code>
        <span className="card-points">{card.points}pt</span>
      </div>
      <p className="card-title">{card.title}</p>
      <div className="card-bottom">
        <span className="card-owner">{card.owner}</span>
        {card.blocked ? <span className="card-flag">blocked</span> : null}
      </div>
    </li>
  );
}
