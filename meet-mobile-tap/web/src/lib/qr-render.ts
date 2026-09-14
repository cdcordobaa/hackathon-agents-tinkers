/**
 * Renders a gateway session id as a scannable QR code, entirely offline —
 * no CDN, no network call, no canvas. `qrcodegen.ts` (vendored, see that
 * file's own header for provenance/license) does the actual encoding; this
 * module only turns its module grid into an inline SVG and drops it into a
 * container element.
 *
 * SVG over `<canvas>` on purpose: it stays crisp at any size the CSS gives
 * it (a phone held close, or the id projected across a room), needs no
 * device-pixel-ratio handling, and needs no re-render on resize.
 */
import { qrcodegen } from "./qrcodegen.ts";

const QUIET_ZONE_MODULES = 4; // per the QR spec's minimum quiet border

/**
 * Renders `text` as a QR code SVG into `container`, replacing any previous
 * contents. Medium error correction: resilient enough for a slightly dirty
 * or angled phone-camera scan without pushing a 36-character UUID into a
 * needlessly dense (harder-to-scan-small) module grid.
 */
export function renderQrCode(container: HTMLElement, text: string): void {
  const qr = qrcodegen.QrCode.encodeText(text, qrcodegen.QrCode.Ecc.MEDIUM);
  const dim = qr.size + QUIET_ZONE_MODULES * 2;

  const rects: string[] = [];
  for (let y = 0; y < qr.size; y++) {
    for (let x = 0; x < qr.size; x++) {
      if (qr.getModule(x, y)) {
        rects.push(`<rect x="${x + QUIET_ZONE_MODULES}" y="${y + QUIET_ZONE_MODULES}" width="1" height="1"/>`);
      }
    }
  }

  const svg =
    `<svg viewBox="0 0 ${dim} ${dim}" xmlns="http://www.w3.org/2000/svg" role="img" ` +
    `aria-label="QR code encoding the session id">` +
    `<rect width="${dim}" height="${dim}" fill="#fff"/>` +
    `<g fill="#000">${rects.join("")}</g>` +
    `</svg>`;

  container.innerHTML = svg;
}

/** Clears any QR code previously rendered into `container`. */
export function clearQrCode(container: HTMLElement): void {
  container.innerHTML = "";
}
