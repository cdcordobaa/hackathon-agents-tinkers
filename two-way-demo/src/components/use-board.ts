"use client";

/**
 * All the state, in one place.
 *
 * The interesting function here is `reportToAgent`. Everything else is ordinary
 * React: a board in useState, pure reducers from lib/board, a small log.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useAgent, useCopilotKit } from "@copilotkit/react-core/v2";
import {
  addCard,
  columnTitle,
  findCard,
  initialBoard,
  moveCard,
  setBlocked,
  type Board,
  type ColumnId,
} from "@/lib/board";
import type { Direction, LogEntry } from "./channel-log";

let logCounter = 0;

export function useBoard() {
  const [board, setBoard] = useState<Board>(initialBoard);
  const [entries, setEntries] = useState<LogEntry[]>([]);
  const [recentlyChanged, setRecentlyChanged] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  // Handlers registered with CopilotKit can outlive a render. Reading the board
  // through a ref keeps an agent tool call from acting on a stale snapshot.
  const boardRef = useRef(board);
  useEffect(() => {
    boardRef.current = board;
  }, [board]);

  const { agent } = useAgent({ agentId: "default" });
  const { copilotkit } = useCopilotKit();

  const runningRef = useRef(false);
  const queuedRef = useRef(false);

  const log = useCallback((direction: Direction, channel: string, detail: string) => {
    setEntries((current) =>
      [
        {
          key: `log-${(logCounter += 1)}`,
          direction,
          channel,
          detail,
          at: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }),
        },
        ...current,
      ].slice(0, 40),
    );
  }, []);

  const flash = useCallback((cardId: string) => {
    setRecentlyChanged((current) => [...new Set([...current, cardId])]);
    setTimeout(() => {
      setRecentlyChanged((current) => current.filter((id) => id !== cardId));
    }, 1400);
  }, []);

  /**
   * UI -> agent, channel 3: start a turn from a UI event.
   *
   * `addMessage` puts the fact in the transcript; `runAgent` makes the agent act
   * on it. This is the same pair a send button uses — the only difference is
   * that a drag calls it instead of a human typing.
   *
   * Guarded, because a run that is already in flight must not be re-entered.
   * A drag during a run still records its message, then triggers one more run.
   */
  const reportToAgent = useCallback(
    async (text: string) => {
      agent.addMessage({
        id: globalThis.crypto?.randomUUID?.() ?? `ui-${Date.now()}-${Math.random()}`,
        role: "user",
        content: text,
      });

      if (runningRef.current) {
        queuedRef.current = true;
        return;
      }

      runningRef.current = true;
      setBusy(true);
      try {
        do {
          queuedRef.current = false;
          await copilotkit.runAgent({ agent });
        } while (queuedRef.current);
      } catch (error) {
        log("ui->agent", "runAgent", `Run failed: ${error instanceof Error ? error.message : String(error)}`);
      } finally {
        runningRef.current = false;
        setBusy(false);
      }
    },
    [agent, copilotkit, log],
  );

  /** A drag, a keyboard move, or the agent's own move_card all land here. */
  const applyMove = useCallback(
    (cardId: string, to: ColumnId, source: "user" | "agent") => {
      const card = findCard(boardRef.current, cardId);
      if (!card) return { ok: false as const, message: `No card ${cardId} on this board.` };
      if (card.column === to) {
        return { ok: false as const, message: `${card.id} is already in ${columnTitle(to)}.` };
      }

      const from = card.column;
      setBoard((current) => moveCard(current, card.id, to));
      flash(card.id);

      if (source === "user") {
        log("ui->agent", "addMessage + runAgent", `Dragged ${card.id} from ${columnTitle(from)} to ${columnTitle(to)}`);
        void reportToAgent(
          `[ui] I moved ${card.id} ("${card.title}") from ${columnTitle(from)} to ${columnTitle(to)}.`,
        );
      } else {
        log("agent->ui", "useFrontendTool", `move_card: ${card.id} -> ${columnTitle(to)}`);
      }

      return {
        ok: true as const,
        message: `Moved ${card.id} from ${columnTitle(from)} to ${columnTitle(to)}.`,
      };
    },
    [flash, log, reportToAgent],
  );

  const applyBlock = useCallback(
    (cardId: string, blocked: boolean) => {
      const card = findCard(boardRef.current, cardId);
      if (!card) return { ok: false as const, message: `No card ${cardId} on this board.` };

      setBoard((current) => setBlocked(current, card.id, blocked));
      flash(card.id);
      log("agent->ui", "useFrontendTool", `block_card: ${card.id} ${blocked ? "blocked" : "unblocked"}`);
      return { ok: true as const, message: `${card.id} is now ${blocked ? "blocked" : "unblocked"}.` };
    },
    [flash, log],
  );

  const applyAdd = useCallback(
    (input: { title: string; owner: string; points: number; column: ColumnId }) => {
      const { board: next, card } = addCard(boardRef.current, input);
      setBoard(next);
      flash(card.id);
      log("agent->ui", "useFrontendTool", `add_card: ${card.id} in ${columnTitle(card.column)}`);
      return { ok: true as const, message: `Created ${card.id} ("${card.title}") in ${columnTitle(card.column)}.` };
    },
    [flash, log],
  );

  /** Applies an approved multi-move plan in one pass. */
  const applyPlan = useCallback(
    (moves: { cardId: string; to: ColumnId }[]) => {
      const applied: string[] = [];
      const skipped: string[] = [];

      for (const move of moves) {
        const card = findCard(boardRef.current, move.cardId);
        if (!card || card.column === move.to) {
          skipped.push(move.cardId);
          continue;
        }
        // boardRef is updated synchronously so later moves in the same plan
        // see the results of earlier ones.
        boardRef.current = moveCard(boardRef.current, card.id, move.to);
        applied.push(`${card.id} -> ${columnTitle(move.to)}`);
        flash(card.id);
      }

      setBoard(boardRef.current);
      return { applied, skipped };
    },
    [flash],
  );

  return {
    board,
    entries,
    recentlyChanged,
    busy,
    log,
    boardRef,
    applyMove,
    applyBlock,
    applyAdd,
    applyPlan,
    reportToAgent,
  };
}

export type BoardController = ReturnType<typeof useBoard>;
