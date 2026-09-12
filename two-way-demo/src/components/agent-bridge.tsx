"use client";

/**
 * THE BRIDGE. Every agent<->UI channel is registered here, and nowhere else.
 *
 *   useAgentContext     ui  -> agent   ambient, re-sent every turn, no turn triggered
 *   useFrontendTool     agent -> ui    agent runs code in the browser; return value goes back
 *   useComponent        agent -> ui    agent picks one of YOUR components and fills its props
 *   useHumanInTheLoop   both           agent BLOCKS until respond() is called
 *
 * The fourth channel, "a UI event starts a turn", is not a hook — it is
 * addMessage + runAgent, and it lives in use-board.ts::reportToAgent.
 *
 * This component renders nothing. Hooks register into the chat stream.
 */
import { useComponent, useAgentContext, useFrontendTool, useHumanInTheLoop } from "@copilotkit/react-core/v2";
import { z } from "zod";
import { COLUMN_IDS, boardSummary, columnTitle, isColumnId, type ColumnId } from "@/lib/board";
import { BoardCard, PlanCard } from "./agent-cards";
import type { BoardController } from "./use-board";

const columnEnum = z.enum(COLUMN_IDS as [ColumnId, ...ColumnId[]]);

export function AgentBridge({ controller }: { controller: BoardController }) {
  const { board, boardRef, applyMove, applyBlock, applyAdd, applyPlan, log } = controller;

  /**
   * Channel 1 — ambient context. Read-only, re-sent on every turn, triggers
   * nothing by itself. This is why the agent never has to ask what is on the
   * board: it is already in the prompt.
   */
  useAgentContext({
    description:
      "Sprint board. The live board the user is looking at right now, including per-column load and the WIP limit. This is the truth; never ask the user what is on the board. Messages prefixed with [ui] describe changes the user already made by hand.",
    value: boardSummary(board),
  });

  /**
   * Channel 2 — the agent runs code in the browser.
   *
   * The returned string is what the MODEL reads back, not what the user sees.
   * Return real error text on failure so the agent can repair and retry, and a
   * short factual confirmation on success so it does not re-narrate the move.
   */
  useFrontendTool(
    {
      name: "move_card",
      description:
        "Move one card to another column. Takes effect immediately and the user sees it. For three or more moves at once, use propose_reorganization instead.",
      parameters: z.object({
        cardId: z.string().describe("Card id, e.g. AE-102."),
        to: columnEnum.describe("Destination column."),
      }),
      handler: async ({ cardId, to }) => applyMove(cardId, to, "agent").message,
    },
    [applyMove],
  );

  useFrontendTool(
    {
      name: "block_card",
      description: "Flag or unflag a card as blocked. A blocked card in In progress is the board's top problem.",
      parameters: z.object({
        cardId: z.string(),
        blocked: z.boolean().describe("true to flag as blocked, false to clear the flag."),
      }),
      handler: async ({ cardId, blocked }) => applyBlock(cardId, blocked).message,
    },
    [applyBlock],
  );

  useFrontendTool(
    {
      name: "add_card",
      description: "Create a new card. Use only when the user asks for new work to be tracked.",
      parameters: z.object({
        title: z.string().trim().min(1).max(120),
        owner: z.string().trim().min(1).max(40),
        points: z.number().int().min(1).max(13),
        column: columnEnum.default("backlog"),
      }),
      handler: async (input) => applyAdd(input).message,
    },
    [applyAdd],
  );

  /**
   * Channel 3 — generative UI, controlled tier.
   *
   * The agent chooses WHEN to draw and WHAT data to pass. It cannot invent
   * markup, so the board card is always on-brand. Note the `.default([])` calls:
   * they protect the schema, while the optional props in BoardCard protect the
   * render during streaming. You need both.
   */
  useComponent({
    name: "render_board",
    description:
      "Draw the board as a card in the chat. Call this after you change the board, and after a [ui] message that changed its shape. Prefer drawing over describing.",
    parameters: z.object({
      headline: z.string().describe("The state of the board in under ten words."),
      note: z.string().describe("One sentence on what matters right now."),
      columns: z
        .array(
          z.object({
            title: z.string(),
            count: z.number(),
            points: z.number(),
          }),
        )
        .max(4)
        .default([]),
      risks: z.array(z.string()).max(3).default([]).describe("Blockers or WIP breaches, if any."),
      tone: z.enum(["neutral", "good", "attention"]).default("neutral"),
    }),
    render: BoardCard,
  });

  /**
   * Channel 4 — the true round trip. The agent STOPS here.
   *
   * `respond` is a function only while the call is executing; narrowing on its
   * presence is safer than importing a status enum from a transitive dependency.
   * Whatever string you hand it becomes the tool result the model reads next,
   * so it is worth writing that string for the model, not for the user.
   */
  useHumanInTheLoop({
    name: "propose_reorganization",
    description:
      "Propose several moves at once and WAIT for the user to approve or discard them. Use this instead of calling move_card repeatedly. Do not continue until it returns.",
    parameters: z.object({
      rationale: z.string().describe("Why this reshuffle, in one sentence."),
      moves: z
        .array(
          z.object({
            cardId: z.string(),
            to: columnEnum,
            why: z.string().max(80).describe("A few words on why this card moves."),
          }),
        )
        .min(1)
        .max(6),
    }),
    render: ({ args, respond, result }) => {
      const moves = (args?.moves ?? []).map((move) => ({
        cardId: move?.cardId,
        to: move?.to ? columnTitle(move.to as ColumnId) : undefined,
        why: move?.why,
      }));

      // Already settled: this call is being replayed in the transcript.
      if (!respond) {
        return <PlanCard rationale={args?.rationale} moves={moves} settled={result ? String(result) : "Waiting…"} />;
      }

      return (
        <PlanCard
          rationale={args?.rationale}
          moves={moves}
          onApply={() => {
            const valid = (args?.moves ?? []).flatMap((move) =>
              move?.cardId && isColumnId(move.to) ? [{ cardId: move.cardId, to: move.to }] : [],
            );
            const { applied, skipped } = applyPlan(valid);
            log("ui->agent", "useHumanInTheLoop respond()", `Applied ${applied.length} move(s)`);

            respond(
              applied.length === 0
                ? "The user approved the plan but nothing changed — every card was already in its target column. Do not re-propose it."
                : `Approved and applied by the user: ${applied.join(", ")}.${
                    skipped.length ? ` Skipped (already there or unknown): ${skipped.join(", ")}.` : ""
                  } The board now reflects this. Redraw it with render_board and say what changed in one sentence.`,
            );
          }}
          onDiscard={() => {
            log("ui->agent", "useHumanInTheLoop respond()", "Plan discarded");
            respond(
              "The user discarded the plan. Nothing was moved. Do not apply it, do not propose a variation of it, and do not ask again unless the board changes.",
            );
          }}
        />
      );
    },
  });

  return null;
}
