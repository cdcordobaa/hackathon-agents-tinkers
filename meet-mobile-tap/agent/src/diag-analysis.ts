import { ProgressiveAnalyzer } from "./analyzer.ts";
import { RollingTranscript } from "./transcript.ts";
import { resolveModelSetup } from "./model-client.ts";

const setup = resolveModelSetup();
console.log(`provider=${setup.provider} model=${setup.model} strict=${setup.supportsStrictSchema} interval=${setup.suggestedIntervalMs}`);

const t = new RollingTranscript();
t.final("caller", "Buenas tardes, ¿hablo con el señor Cristian?");
t.final("you", "Sí, con él. ¿Quién habla?");
t.final("caller", "Le habla Andrea Gómez del área de seguridad de su banco. Lo llamo por un tema urgente.");
t.final("you", "¿Qué pasó con mi cuenta?");
t.final("caller", "Detectamos un intento de compra por cuatro millones. Necesito que no cuelgue.");

const a = new ProgressiveAnalyzer({
  transcript: t,
  client: setup.client,
  model: setup.model,
  supportsStrictSchema: setup.supportsStrictSchema,
  requestTimeoutMs: 15_000,
  onResult: (p, m) => {
    console.log(`\nOK pass=${m.pass} latency=${m.latencyMs}ms risk=${p.risk} score=${p.score}`);
    console.log(`   headline: ${p.headline}`);
    console.log(`   signals: ${p.signals.length}`);
    process.exit(0);
  },
  onError: (e) => {
    console.log("\n*** THE ERROR THE MONITOR THROWS AWAY ***");
    console.log("name:", e.name);
    console.log("message:", e.message);
    const any = e as any;
    if (any.status) console.log("status:", any.status);
    if (any.code) console.log("code:", any.code);
    if (any.error) console.log("error:", JSON.stringify(any.error).slice(0, 500));
    if (any.cause) console.log("cause:", String(any.cause).slice(0, 300));
    process.exit(1);
  },
});
await a.flush();
