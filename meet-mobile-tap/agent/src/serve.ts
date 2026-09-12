import { networkInterfaces } from "node:os";
import { createDemoServer } from "./demo-server.ts";

const port = Number(process.env.PORT ?? 8787);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("PORT must be between 1 and 65535.");
const app = createDemoServer({ onLog: console.log });
app.server.listen(port, process.env.HOST ?? "0.0.0.0", () => {
  console.log(`SecureGuIA call demo: http://localhost:${port}`);
  for (const addresses of Object.values(networkInterfaces())) {
    for (const address of addresses ?? []) {
      if (address.family === "IPv4" && !address.internal) console.log(`Phone gateway URL: http://${address.address}:${port}`);
    }
  }
  console.log("Use only on a trusted network. Browser preview works without API keys.");
});
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    const deadline = setTimeout(() => process.exit(1), 12_000);
    deadline.unref();
    void app.stop().then(() => { clearTimeout(deadline); process.exit(0); });
  });
}
