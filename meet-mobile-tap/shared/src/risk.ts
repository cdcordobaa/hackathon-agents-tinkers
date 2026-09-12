/**
 * There is exactly one definition of the analysis result, and it lives in
 * `agent/src/risk-profile.ts` — the file that header calls out as THE
 * SWAPPABLE FILE. Do not copy these types here: a copy drifts the moment
 * someone edits the schema on one side and not the other, and the whole point
 * of this package is that the mobile HUD and the gateway import the same
 * shape the analyzer actually produces.
 *
 * This module only re-exports. If this import path goes red, the analyzer's
 * exports changed shape and every consumer of `shared/` needs to know before
 * `tsc` finds out for them.
 */
export {
  type RiskLevel,
  type Signal,
  type RiskProfile,
  RISK_PROFILE_SCHEMA,
} from "../../agent/src/risk-profile.ts";
