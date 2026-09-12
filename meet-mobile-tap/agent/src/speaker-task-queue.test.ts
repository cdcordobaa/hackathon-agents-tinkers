import { test } from "node:test";
import assert from "node:assert/strict";
import { SpeakerTaskQueue } from "./speaker-task-queue.ts";

const tick = () => new Promise((resolve) => setImmediate(resolve));

test("serializes each speaker, keeps attribution, and bounds its backlog", async () => {
  const events: string[] = [];
  let releaseFirst!: () => void;
  const firstGate = new Promise<void>((resolve) => (releaseFirst = resolve));
  const queue = new SpeakerTaskQueue(1);

  assert.equal(queue.enqueue("alice", async () => {
    events.push("alice:first:start");
    await firstGate;
    events.push("alice:first:end");
  }), true);
  assert.equal(queue.enqueue("alice", async () => {
    events.push("alice:second");
  }), true);
  assert.equal(queue.enqueue("alice", async () => {
    events.push("alice:overflow");
  }), false, "only one task may wait behind the active request");

  assert.equal(queue.enqueue("bob", async () => {
    events.push("bob");
  }), true);
  await tick();
  assert.deepEqual(events, ["alice:first:start", "bob"], "other speakers run independently");

  queue.close();
  releaseFirst();
  await queue.drain();

  assert.deepEqual(events, ["alice:first:start", "bob", "alice:first:end", "alice:second"]);
  assert.equal(queue.enqueue("alice", async () => {}), false);
});

test("task failure is reported with its speaker and does not block later work", async () => {
  const errors: string[] = [];
  const events: string[] = [];
  const queue = new SpeakerTaskQueue(1, (speaker, error) => {
    errors.push(`${speaker}: ${error.message}`);
  });

  queue.enqueue("counterparty-7", async () => {
    throw new Error("STT timeout");
  });
  queue.enqueue("counterparty-7", async () => {
    events.push("second ran");
  });
  queue.close();
  await queue.drain();

  assert.deepEqual(errors, ["counterparty-7: STT timeout"]);
  assert.deepEqual(events, ["second ran"]);
});
