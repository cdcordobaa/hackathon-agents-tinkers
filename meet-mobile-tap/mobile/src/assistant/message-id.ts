// Same reasoning as agents-everywhere-starter-kit/apps/mobile/src/message-id.ts:
// crypto.randomUUID is not guaranteed in RN without a native polyfill this
// project is deliberately not adding, so message ids are sequence-based.
let sequence = 0;

export function createUserMessageId(now: number = Date.now()): string {
  sequence += 1;
  return `user-${now}-${sequence}`;
}
