"use client";

import { CopilotChat, useConfigureSuggestions } from "@copilotkit/react-core/v2";
import { AgentBridge } from "@/components/agent-bridge";
import { BoardView } from "@/components/board-view";
import { ChannelLog } from "@/components/channel-log";
import { useBoard } from "@/components/use-board";
import type { ColumnId } from "@/lib/board";

export default function Home() {
  const controller = useBoard();

  useConfigureSuggestions(
    {
      suggestions: [
        {
          title: "What's wrong with this board?",
          message: "Read the board and tell me what needs attention. Draw it, don't describe it.",
        },
        {
          title: "Tidy it up",
          message: "Propose a reorganization that respects the WIP limit. Show me the plan before anything moves.",
        },
        {
          title: "Unblock AE-102",
          message: "AE-102 is unblocked now. Update the board and redraw it.",
        },
      ],
      available: "before-first-message",
    },
    [],
  );

  const handleUserMove = (cardId: string, to: ColumnId) => {
    // The ONLY thing a drag does is call the same reducer an agent tool calls.
    // Reporting it to the agent happens inside, in one place.
    controller.applyMove(cardId, to, "user");
  };

  return (
    <>
      {/* Registers every channel. Renders nothing. */}
      <AgentBridge controller={controller} />

      <main className="shell">
        <header className="masthead">
          <div>
            <p className="eyebrow">CopilotKit v2 &middot; two-way loop</p>
            <h1>Sprint board</h1>
            <p className="intro">
              Drag a card and watch the agent notice. Ask it to tidy up and watch the board move.
              Same state, two drivers.
            </p>
          </div>
          <div className={`run-state ${controller.busy ? "run-state--busy" : ""}`}>
            <span className="run-dot" aria-hidden="true" />
            {controller.busy ? "Agent running" : "Idle"}
          </div>
        </header>

        <div className="layout">
          <div className="left">
            <section className="panel" aria-labelledby="board-title">
              <header className="panel-header">
                <h2 id="board-title">Board</h2>
                <p>Drag between columns, or focus a card and use &larr; / &rarr;.</p>
              </header>
              <BoardView
                board={controller.board}
                onMove={handleUserMove}
                recentlyChanged={controller.recentlyChanged}
              />
            </section>

            <ChannelLog entries={controller.entries} />
          </div>

          <section className="panel chat-panel" aria-labelledby="chat-title">
            <header className="panel-header">
              <h2 id="chat-title">Assistant</h2>
              <p>It can see the board and change it.</p>
            </header>
            <CopilotChat
              className="chat"
              labels={{
                welcomeMessageText: "I can see your board. What should we do with it?",
                chatInputPlaceholder: "Ask about the board…",
              }}
            />
          </section>
        </div>

        <footer className="legend">
          <h2>The four channels</h2>
          <dl>
            <div>
              <dt><code>useAgentContext</code></dt>
              <dd>UI &rarr; agent, ambient. Board state re-sent every turn. Triggers nothing.</dd>
            </div>
            <div>
              <dt><code>useFrontendTool</code></dt>
              <dd>Agent &rarr; UI. Agent runs browser code; the return string goes back to the model.</dd>
            </div>
            <div>
              <dt><code>useComponent</code></dt>
              <dd>Agent &rarr; UI. Agent picks your component and fills typed props.</dd>
            </div>
            <div>
              <dt><code>useHumanInTheLoop</code></dt>
              <dd>Round trip. The run pauses; <code>respond()</code> is the tool result.</dd>
            </div>
            <div>
              <dt><code>addMessage + runAgent</code></dt>
              <dd>UI &rarr; agent. A drag starts a turn. Not a hook &mdash; see <code>use-board.ts</code>.</dd>
            </div>
          </dl>
        </footer>
      </main>
    </>
  );
}
