/**
 * Mints an OpenAI Realtime ephemeral secret for the browser — plain
 * node:http, zero dependencies (Node 22 has global fetch), run as its own
 * process so OPENAI_API_KEY never enters the Vite bundle.
 *
 * This exists as a stand-in for a gateway route. The spec this app is built
 * against (openspec/changes/add-browser-livekit-rung/design.md, "Open
 * Questions" and the "No long-lived transcription credential reaches the
 * browser" requirement in specs/browser-call-rung/spec.md) calls for the
 * GATEWAY to mint this credential per session, mirroring how it already
 * mints LiveKit room tokens — but that route does not exist yet, and T5 does
 * not depend on server/ to demo. Once the gateway grows
 * `POST /session/:id/realtime-secret` (or equivalent), delete this file and
 * point participant-pipeline.ts's `fetchEphemeralSecret` at the gateway
 * instead — the request/response shape below was chosen to make that swap a
 * one-line change (see that function's own comment).
 *
 * Logic ported from
 * ../../../agents-everywhere-starter-kit/apps/web/src/app/api/realtime-token/route.ts
 * (MIT, same workspace), collapsed from a Next.js route handler into a bare
 * HTTP server. Only the "listen" mode is kept — this app never opens a
 * spoken-reply session, so there is no "speak" branch to port.
 *
 *   npm run token-server          # reads web/.env for OPENAI_API_KEY
 */
import http from "node:http";

const PORT = Number(process.env.TOKEN_SERVER_PORT) || 8788;
const TRANSCRIBE_MODEL = process.env.VITE_TRANSCRIBE_MODEL || "gpt-live-transcribe";

const apiKey = process.env.OPENAI_API_KEY;
if (!apiKey) {
  console.error("OPENAI_API_KEY is not set. Put it in web/.env (never VITE_-prefixed — it must not reach the bundle).");
  process.exit(1);
}

function withCors(res) {
  // Vite dev serves the app on a different port than this server; a browser
  // fetch across those two ports is a CORS request. Wide open on purpose —
  // this process mints nothing more sensitive than a short-lived,
  // transcription-scoped secret, and it only ever runs on localhost for a
  // demo.
  res.setHeader("access-control-allow-origin", "*");
  res.setHeader("access-control-allow-methods", "POST, OPTIONS");
  res.setHeader("access-control-allow-headers", "content-type");
}

async function readJsonBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (chunks.length === 0) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

const server = http.createServer((req, res) => {
  withCors(res);

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  if (req.method === "POST" && req.url === "/realtime-token") {
    readJsonBody(req)
      .then(async (body) => {
        // Trust the browser's reported rate only as far as a sane audio
        // range; it comes from AudioContext.sampleRate, which the browser
        // chooses, not us.
        const sampleRate =
          typeof body.sampleRate === "number" && body.sampleRate >= 8000 && body.sampleRate <= 48000
            ? Math.round(body.sampleRate)
            : 24000;

        const upstream = await fetch("https://api.openai.com/v1/realtime/client_secrets", {
          method: "POST",
          headers: {
            authorization: `Bearer ${apiKey}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            session: {
              type: "transcription",
              audio: {
                input: {
                  format: { type: "audio/pcm", rate: sampleRate },
                  transcription: { model: TRANSCRIBE_MODEL },
                },
              },
            },
          }),
        });

        if (!upstream.ok) {
          const detail = await upstream.text();
          res.writeHead(upstream.status, { "content-type": "application/json" });
          res.end(JSON.stringify({ error: `OpenAI refused the session: ${detail.slice(0, 300)}` }));
          return;
        }

        const data = await upstream.json();
        if (!data.value) {
          res.writeHead(502, { "content-type": "application/json" });
          res.end(JSON.stringify({ error: "No ephemeral secret in the response." }));
          return;
        }

        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ value: data.value }));
      })
      .catch((cause) => {
        res.writeHead(400, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: cause instanceof Error ? cause.message : String(cause) }));
      });
    return;
  }

  res.writeHead(404, { "content-type": "application/json" });
  res.end(JSON.stringify({ error: "not found" }));
});

server.listen(PORT, () => {
  console.log(`Realtime token-server listening on :${PORT}`);
  console.log(`  POST http://localhost:${PORT}/realtime-token`);
});
