/**
 * Runs requests serially for each speaker while allowing different speakers to
 * make progress independently. The bounded backlog prevents a slow STT service
 * from turning a long call into an ever-growing memory and request queue.
 */
export class SpeakerTaskQueue {
  private readonly states = new Map<
    string,
    { outstanding: number; tail: Promise<void> }
  >();
  private accepting = true;

  constructor(
    private readonly maxWaitingPerSpeaker = 1,
    private readonly onError?: (speakerId: string, error: Error) => void,
  ) {}

  /** Returns false when shutdown began or this speaker's bounded backlog is full. */
  enqueue(speakerId: string, task: () => Promise<void>): boolean {
    if (!this.accepting) return false;

    const current = this.states.get(speakerId);
    // `outstanding` includes the active request, so add one for that slot.
    if (current && current.outstanding >= this.maxWaitingPerSpeaker + 1) return false;

    const state = current ?? { outstanding: 0, tail: Promise.resolve() };
    state.outstanding += 1;
    const run = state.tail.then(task);
    const settled = run
      .catch((cause) => {
        this.onError?.(
          speakerId,
          cause instanceof Error ? cause : new Error(String(cause)),
        );
      })
      .finally(() => {
        state.outstanding -= 1;
        if (state.outstanding === 0 && this.states.get(speakerId) === state) {
          this.states.delete(speakerId);
        }
      });
    state.tail = settled;
    this.states.set(speakerId, state);
    return true;
  }

  /** Stop accepting work. Already accepted requests remain drainable. */
  close(): void {
    this.accepting = false;
  }

  /** Wait until every accepted request has settled. Call close() first. */
  async drain(): Promise<void> {
    while (this.states.size > 0) {
      await Promise.all([...this.states.values()].map((state) => state.tail));
    }
  }
}
