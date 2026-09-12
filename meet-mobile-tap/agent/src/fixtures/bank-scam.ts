/**
 * A scripted call, for testing the pipeline without a phone or a room.
 *
 * Shaped like the common Colombian bank-impersonation pretext: authority claim,
 * a scary transaction, manufactured urgency, isolation ("do not hang up, do not
 * tell anyone"), and only then the actual ask — the OTP.
 *
 * The arc matters more than any single line. A good progressive analysis should
 * sit at "none" through the opening, lift as the pressure tactics stack, and
 * spike at the OTP request — which is the thing to watch for when testing.
 */
export type ScriptedTurn = {
  speaker: string;
  text: string;
  /** Milliseconds to wait before this turn, at 1x speed. */
  gapMs: number;
};

export const BANK_SCAM: ScriptedTurn[] = [
  { speaker: "caller", text: "Buenas tardes, ¿hablo con el señor Cristian?", gapMs: 0 },
  { speaker: "you", text: "Sí, con él. ¿Quién habla?", gapMs: 2500 },
  {
    speaker: "caller",
    text: "Le habla Andrea Gómez del área de seguridad de su banco. Lo llamo por un tema urgente con su cuenta.",
    gapMs: 2000,
  },
  { speaker: "you", text: "¿Qué pasó con mi cuenta?", gapMs: 3000 },
  {
    speaker: "caller",
    text: "Detectamos un intento de compra por cuatro millones ochocientos mil pesos en Medellín hace seis minutos. ¿Usted la está realizando?",
    gapMs: 2000,
  },
  { speaker: "you", text: "No, yo no he comprado nada. Yo estoy en Bogotá.", gapMs: 3500 },
  {
    speaker: "caller",
    text: "Entonces alguien está usando su tarjeta en este momento. Necesito que no cuelgue la llamada, si cuelga la transacción se aprueba automáticamente.",
    gapMs: 2000,
  },
  { speaker: "you", text: "Listo, no cuelgo. ¿Qué hago?", gapMs: 3000 },
  {
    speaker: "caller",
    text: "Voy a bloquear la tarjeta, pero el sistema me pide validar su identidad. Por favor confírmeme los últimos cuatro dígitos y la fecha de vencimiento.",
    gapMs: 2500,
  },
  { speaker: "you", text: "Son cuatro, dos, nueve, uno.", gapMs: 4000 },
  {
    speaker: "caller",
    text: "Perfecto. Le acabo de enviar un código de seguridad por mensaje de texto. Dígamelo para completar el bloqueo, y por seguridad no comente esto con nadie mientras estamos en línea.",
    gapMs: 2500,
  },
  { speaker: "you", text: "Me llegó un código de seis dígitos...", gapMs: 4500 },
  {
    speaker: "caller",
    text: "Sí señor, ese mismo. Dígamelo rápido por favor, tenemos menos de un minuto antes de que se apruebe el cobro.",
    gapMs: 2000,
  },
];
