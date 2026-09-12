## Scope as of now

**BREAKING (to this proposal's own risk assessment).** This proposal's biggest risk was
the native-module footprint of `@copilotkit/react-native` pulling in `react-native-reanimated`,
`react-native-gesture-handler`, `@gorhom/bottom-sheet`, `react-native-streamdown`,
`expo-file-system` and `expo-document-picker` alongside LiveKit's already-installed WebRTC
pods — hence the time-boxed spike in task 1. The scope decision resolves this directly:
**use `@copilotkit/react-native/headless`**, which has no native peer dependencies, so
there is no `expo prebuild` and no `pod install` for this change at all, and no risk to
the LiveKit iOS build. The dependency spike (section 1) and its native-conflict framing
in `design.md` are superseded.

**Still in scope, unaffected:** the runtime endpoint (section 2), grounding rules
(section 3, including replaying prompt-injection fixtures), read-only actions and
generative UI for the risk card/signals (sections 4's read-only half and 5), and fit
with the call (section 6).

**[DEFERRED — each superseded by an item on the deferred list]** Of the four
world-changing actions in task 4.2: "end the call" (hangup deferred), "verify the
caller's identity" (Twilio Verify deferred), and "alert a trusted contact" (SMS
deferred) are all deferred along with the mechanisms they depend on. Only "explain a
signal" and "what did they just say" (both read-only, task 4.1) remain buildable now.

The specs below still describe the full original intent — see `tasks.md` for the
per-task reconciliation.

## Why

A risk score tells someone they are in trouble. It does not answer "wait, is my bank
actually allowed to ask me for that?" — which is the question a person under pressure
actually has, and the one a scammer's script depends on them not asking.

An assistant in the app can answer it, with the live transcript as context, and can carry
out the action that follows. CopilotKit is the hackathon's sponsor tooling and the starter
kit's mobile app already demonstrates the pattern: readable context, frontend actions, and
generative UI rendered from the agent's tool calls.

## What Changes

- `@copilotkit/react-native` in `mobile/`, backed by a CopilotKit runtime endpoint on the
  gateway so no model key reaches the device.
- The live session as **readable context**: current risk profile, recent transcript turns,
  caller reputation, transport and connection state. The assistant answers about *this*
  call, not in general.
- **Frontend actions** the assistant can take, each requiring user confirmation for
  anything irreversible: end the call, verify the caller's identity, alert a trusted
  contact, explain a signal, replay what was just said.
- **Generative UI**: the risk card, the signal list and an intervention prompt rendered
  from agent tool calls rather than hand-placed, so the assistant can surface the right
  thing at the right moment.
- A hard boundary: transcript content is data. The assistant's context includes speech from
  someone who may be trying to manipulate it, and an instruction inside a transcript turn
  must never become an action.
- A time-boxed dependency spike first. `@copilotkit/react-native@1.71.1` accepts React 19
  and RN ≥0.70, but pulls in `react-native-reanimated`, `react-native-gesture-handler`,
  `@gorhom/bottom-sheet`, `react-native-streamdown`, `expo-file-system` and
  `expo-document-picker` — native modules, on an Expo 57 project whose iOS build already
  carries LiveKit's WebRTC pods.

## Capabilities

### New Capabilities
- `assistant`: an in-app agent that can answer questions about the call in progress and
  take safe, confirmed actions on the user's behalf.

## Impact

- `mobile/`: new dependencies requiring `npx expo prebuild` and `pod install` — see
  CLAUDE.md's troubleshooting entries, which apply directly here.
- New: a CopilotKit runtime endpoint on the gateway, with the session as its context source.
- Depends on: add-call-session-contracts, add-mobile-call-shell (screens to host the
  assistant). The intervention actions degrade to unavailable until add-fraud-intervention
  lands, so the two can proceed in parallel.
