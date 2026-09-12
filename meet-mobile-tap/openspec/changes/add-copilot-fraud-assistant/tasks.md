## 1. Dependency spike, time-boxed — [DEFERRED, superseded by the headless decision]

The spike below (native peer modules, `expo prebuild`, the web-surface exit) was written
against `@copilotkit/react-native`'s full native build. The scope decision uses
`@copilotkit/react-native/headless` instead, which has no native peer deps — see
proposal.md's Scope as of now. Replaced by task 1.4/1.5 below; 1.1-1.3 are kept for
context, not to be executed.

- [ ] 1.1 [DEFERRED - superseded by the headless decision, see proposal.md Scope as of
      now] Add `@copilotkit/react-native` and its peer native modules (reanimated,
      gesture-handler, bottom-sheet, streamdown, expo-file-system, expo-document-picker);
      run `npx expo prebuild` and verify `ios/*.xcworkspace` exists — per CLAUDE.md,
      `prebuild` exits 0 even when `pod install` failed
- [ ] 1.2 [DEFERRED - see 1.1] Build and launch on a device with LiveKit still working;
      verify a room still joins and the level meter still moves after the new pods are
      installed
- [ ] 1.3 [DEFERRED - see 1.1; no exit needed if 1.4 confirms headless has no native
      footprint] If the time box is exceeded, take the exit: ship the assistant as a
      CopilotKit web surface on a second screen and keep the HUD on the phone; verify the
      decision and its reason are recorded in CLAUDE.md
- [ ] 1.4 [NEW — replaces 1.1] Add `@copilotkit/react-native/headless` to `mobile/`;
      verify it installs with no new native peer dependency (no new entry needed in
      `ios/Podfile.lock`) and confirm `npx expo prebuild` was not required
- [ ] 1.5 [NEW — replaces 1.2] Build and launch on a device with LiveKit still working;
      verify a room still joins and the level meter still moves, proving headless carries
      no native footprint of its own

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
- [ ] 4.2 [DEFERRED - all three actions are individually deferred: end call (hangup
      deferred), verify caller (Twilio Verify deferred), alert trusted contact (SMS
      deferred); see proposal.md Scope as of now] Implement world-changing actions — end
      call, verify caller, alert trusted contact — each behind a confirmation naming the
      consequence and the recipient; verify nothing happens until confirmed
- [ ] 4.3 [UNCERTAIN — keep if any world-changing or degraded-availability action ships;
      otherwise moot until 4.2 is picked back up] Verify declining an action produces no
      effect and no unprompted re-proposal
- [ ] 4.4 Render unavailable actions as disabled with a reason; verify the three deferred
      actions (end call, verify caller, alert trusted contact) render this way today, not
      only against a transport declaring a capability false

## 5. Generative UI

- [ ] 5.1 Render the risk assessment as a component from a tool call; verify band, score
      and signals with quotes match the current assessment exactly
- [ ] 5.2 [BLOCKED ON 4.2, which is deferred — nothing to render until an intervention
      action ships, see add-fraud-intervention's Scope as of now] Render a proposed
      intervention as an interactive component; verify confirm and decline both route
      through the same confirmation path as task 4.2
- [ ] 5.3 Verify a rendered component never shows a signal absent from the assessment

## 6. Fit with the call

- [ ] 6.1 Verify the HUD stays visible and primary while the assistant is open
- [ ] 6.2 Run the assistant during a live replay session on a device; verify answers arrive
      fast enough to be useful mid-call and record the latency
