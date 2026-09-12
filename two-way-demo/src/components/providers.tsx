"use client";

/**
 * Client boundary for the CopilotKit provider.
 *
 * `@copilotkit/react-core/v2` uses `export *` internally, and Next refuses to
 * pull an `export *` module across a client boundary straight from a Server
 * Component. Importing it inside an explicit "use client" module and
 * re-exporting a named component keeps layout.tsx a Server Component.
 */
import { CopilotKitProvider } from "@copilotkit/react-core/v2";

export function Providers({ children }: { children: React.ReactNode }) {
  // Must agree with `basePath` in app/api/copilotkit/[[...path]]/route.ts.
  return <CopilotKitProvider runtimeUrl="/api/copilotkit">{children}</CopilotKitProvider>;
}
