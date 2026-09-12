export type ParticipantDescriptor = {
  role: "subject" | "counterparty" | "unknown";
  displayName: string;
  consented: boolean;
};

/** Metadata is an authorization boundary: malformed or partial data never grants consent. */
export function parseParticipantMetadata(
  raw: string,
  fallbackName: string,
): ParticipantDescriptor {
  try {
    const value = JSON.parse(raw) as Record<string, unknown>;
    const role = value.role;
    const displayName = value.displayName;
    if (
      (role === "subject" || role === "counterparty") &&
      typeof displayName === "string" &&
      displayName.trim().length > 0 &&
      displayName.length <= 100 &&
      value.consent === true
    ) {
      return { role, displayName: displayName.trim(), consented: true };
    }
  } catch {
    // Invalid JSON is ordinary for participants not minted by the gateway.
  }
  return {
    role: "unknown",
    displayName: fallbackName.slice(0, 100),
    consented: false,
  };
}

export function pcmRms(pcm: Int16Array): number {
  if (pcm.length === 0) return 0;
  let sum = 0;
  for (const sample of pcm) sum += sample * sample;
  return Math.sqrt(sum / pcm.length);
}

/** Speech commonly lands between -40 and -8 dBFS. Keep meters useful in that range. */
export function normalizedLevel(rms: number): number {
  if (rms <= 0) return 0;
  const db = 20 * Math.log10(rms / 32_768);
  return Math.max(0, Math.min(1, (db + 50) / 42));
}

export function analysisSpeakerLabel(descriptor: ParticipantDescriptor): string {
  if (descriptor.role === "subject") return `Protected caller (${descriptor.displayName})`;
  if (descriptor.role === "counterparty") return `Other caller (${descriptor.displayName})`;
  return descriptor.displayName;
}
