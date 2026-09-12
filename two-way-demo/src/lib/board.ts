/**
 * The board. Plain data + pure functions, no React and no CopilotKit.
 *
 * Keeping the domain free of both is what lets the SAME functions be driven by
 * a user's drag and by an agent's tool call. Every mutation below returns a new
 * board, so optimistic UI and agent writes go through one code path.
 */

export const COLUMNS = [
  { id: "backlog", title: "Backlog" },
  { id: "in_progress", title: "In progress" },
  { id: "review", title: "Review" },
  { id: "done", title: "Done" },
] as const;

export type ColumnId = (typeof COLUMNS)[number]["id"];

export const COLUMN_IDS = COLUMNS.map((column) => column.id) as ColumnId[];

export function isColumnId(value: unknown): value is ColumnId {
  return typeof value === "string" && COLUMN_IDS.includes(value as ColumnId);
}

export function columnTitle(id: ColumnId): string {
  return COLUMNS.find((column) => column.id === id)?.title ?? id;
}

export type Card = {
  id: string;
  title: string;
  owner: string;
  points: number;
  column: ColumnId;
  blocked: boolean;
};

export type Board = { cards: Card[] };

export const initialBoard: Board = {
  cards: [
    { id: "AE-101", title: "Rate limiter drops burst traffic", owner: "Dana", points: 5, column: "in_progress", blocked: false },
    { id: "AE-102", title: "Checkout retries charge twice", owner: "Ali", points: 8, column: "in_progress", blocked: true },
    { id: "AE-103", title: "Add audit log to admin actions", owner: "Dana", points: 3, column: "review", blocked: false },
    { id: "AE-104", title: "Migrate sessions off in-memory store", owner: "Priya", points: 8, column: "backlog", blocked: false },
    { id: "AE-105", title: "Flaky signup e2e test", owner: "Ali", points: 2, column: "backlog", blocked: false },
    { id: "AE-106", title: "Ship weekly digest email", owner: "Priya", points: 5, column: "done", blocked: false },
  ],
};

export function findCard(board: Board, cardId: string): Card | undefined {
  const wanted = cardId.trim().toLowerCase();
  return board.cards.find((card) => card.id.toLowerCase() === wanted);
}

export function moveCard(board: Board, cardId: string, to: ColumnId): Board {
  return {
    cards: board.cards.map((card) =>
      card.id === cardId ? { ...card, column: to } : card,
    ),
  };
}

export function setBlocked(board: Board, cardId: string, blocked: boolean): Board {
  return {
    cards: board.cards.map((card) =>
      card.id === cardId ? { ...card, blocked } : card,
    ),
  };
}

export function addCard(
  board: Board,
  input: { title: string; owner: string; points: number; column: ColumnId },
): { board: Board; card: Card } {
  const nextNumber =
    board.cards.reduce((max, card) => {
      const parsed = Number.parseInt(card.id.replace(/\D/g, ""), 10);
      return Number.isFinite(parsed) ? Math.max(max, parsed) : max;
    }, 100) + 1;

  const card: Card = { id: `AE-${nextNumber}`, blocked: false, ...input };
  return { board: { cards: [...board.cards, card] }, card };
}

export function cardsIn(board: Board, column: ColumnId): Card[] {
  return board.cards.filter((card) => card.column === column);
}

/** The summary the agent reasons over — small on purpose, prompts are not dashboards. */
export function boardSummary(board: Board) {
  return {
    columns: COLUMNS.map((column) => {
      const cards = cardsIn(board, column.id);
      return {
        id: column.id,
        title: column.title,
        count: cards.length,
        points: cards.reduce((total, card) => total + card.points, 0),
        blocked: cards.filter((card) => card.blocked).map((card) => card.id),
      };
    }),
    wipLimit: WIP_LIMIT,
    overWipLimit: cardsIn(board, "in_progress").length > WIP_LIMIT,
    cards: board.cards,
  };
}

export const WIP_LIMIT = 2;
