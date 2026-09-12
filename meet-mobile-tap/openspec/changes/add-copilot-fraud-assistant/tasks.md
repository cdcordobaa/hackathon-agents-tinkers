## 1. Dependency spike, time-boxed

- [ ] 1.1 Add `@copilotkit/react-native` and its peer native modules (reanimated,
      gesture-handler, bottom-sheet, streamdown, expo-file-system, expo-document-picker);
      run `npx expo prebuild` and verify `ios/*.xcworkspace` exists — per CLAUDE.md,
      `prebuild` exits 0 even when `pod install` failed
- [ ] 1.2 Build and launch on a device with LiveKit still working; verify a room still
      joins and the level meter still moves after the new pods are installed
- [ ] 1.3 If the time box is exceeded, take the exit: ship the assistant as a CopilotKit
      web surface on a second screen and keep the HUD on the phone; verify the decision
      and its reason are recorded in CLAUDE.md

## 2. Runtime endpoint

- [ ] 2.1 Stand up a CopilotKit runtime on the gateway — either fresh or over the existing
      `claude-agent-server` AG-UI bridge; verify the app reaches it and a message round-trips
- [ ] 2.2 Grep the built bundle for a model provider key; verify none is present
- [ ] 2.3 Supply the session as readable context: current profile, recent turns, caller
      info, transport and connection state; verify the assistant answers a question whose
      answer is only in the live context

## 3. Grounding

- [ ] 3.1 Label transcript turns in context as third-party speech; verify the labelling is
      present in the serialised context
- [ ] 3.2 Replay the prompt-injection fixtures from add-fraud-analysis-evaluation through
      the assistant's context; verify no action is triggered and no confirmation is
      auto-accepted
- [ ] 3.3 Verify the assistant reports the existing assessment and never states a
      different risk band of its own
- [ ] 3.4 Verify it says no assessment exists yet rather than estimating, before the first
      pass

## 4. Actions

- [ ] 4.1 Implement read-only actions — explain a signal, what did they just say — with no
      confirmation step; verify both answer correctly from context
- [ ] 4.2 Implement world-changing actions — end call, verify caller, alert trusted contact
      — each behind a confirmation naming the consequence and the recipient; verify nothing
      happens until confirmed
- [ ] 4.3 Verify declining an action produces no effect and no unprompted re-proposal
- [ ] 4.4 Render unavailable actions as disabled with a reason from transport capabilities
      and intervention availability; verify against a transport declaring `canHangup: false`

## 5. Generative UI

- [ ] 5.1 Render the risk assessment as a component from a tool call; verify band, score
      and signals with quotes match the current assessment exactly
- [ ] 5.2 Render a proposed intervention as an interactive component; verify confirm and
      decline both route through the same confirmation path as task 4.2
- [ ] 5.3 Verify a rendered component never shows a signal absent from the assessment

## 6. Fit with the call

- [ ] 6.1 Verify the HUD stays visible and primary while the assistant is open
- [ ] 6.2 Run the assistant during a live replay session on a device; verify answers arrive
      fast enough to be useful mid-call and record the latency
