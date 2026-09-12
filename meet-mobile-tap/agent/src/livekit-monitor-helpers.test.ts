import { test } from "node:test";
import assert from "node:assert/strict";
import {
  analysisSpeakerLabel,
  normalizedLevel,
  parseParticipantMetadata,
  pcmRms,
} from "./livekit-monitor-helpers.ts";

test("only complete gateway metadata grants audio consent", () => {
  assert.deepEqual(
    parseParticipantMetadata(
      JSON.stringify({ role: "subject", displayName: "Ana", consent: true }),
      "fallback",
    ),
    { role: "subject", displayName: "Ana", consented: true },
  );
  assert.equal(
    parseParticipantMetadata(
      JSON.stringify({ role: "counterparty", displayName: "Bank", consent: false }),
      "fallback",
    ).consented,
    false,
  );
  assert.equal(
    parseParticipantMetadata(JSON.stringify({ displayName: "No role", consent: true }), "fallback")
      .consented,
    false,
  );
  assert.equal(parseParticipantMetadata("not json", "fallback").consented, false);
});

test("analysis labels preserve the protected-party role", () => {
  assert.equal(
    analysisSpeakerLabel({ role: "subject", displayName: "Ana", consented: true }),
    "Protected caller (Ana)",
  );
  assert.equal(
    analysisSpeakerLabel({ role: "counterparty", displayName: "Banco", consented: true }),
    "Other caller (Banco)",
  );
});

test("RMS and normalized levels distinguish silence from observed signal", () => {
  assert.equal(pcmRms(new Int16Array(160)), 0);
  const rms = pcmRms(Int16Array.from([1000, -1000, 1000, -1000]));
  assert.equal(rms, 1000);
  assert.equal(normalizedLevel(0), 0);
  assert.ok(normalizedLevel(rms) > 0);
  assert.ok(normalizedLevel(rms) <= 1);
});
