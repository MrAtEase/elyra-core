# Merlin OS Design Manifest

This document is the **reference, filter, and measure** for every Merlin system decision—UI, workflow, intelligence, or automation. Every contribution must ask: *Reduces cognitive load or increases it?* The answers below translate the mandate into actionable guidelines, workflows, and a living spec.

## 1. Essence

- **Merlin is not a tool, chat, or dashboard.** It is a calm, intelligent space that helps people make better decisions before they realize they need one.
- **Feel:** Quiet, present, almost invisible; it never shouts, demands, or explains itself unnecessarily. When it works, “I think clearer without knowing why.”
- **Outcome:** Merlin makes thinking feel effortless by ordering context and surface actions that are relevant *now*.

## 2. Central Law: Cognitive Friction is the Enemy

- Avoid anything that requires extra explanations, surfaces too many options, or forces the user to think about the system.  
- **If it doesn’t feel natural, it’s wrong.** Every interaction must fade into the background of the user’s life and work.

## 3. Orb Guidelines

- The Orb is the *tactile state* of Merlin, not a button or badge. It communicates presence with light and breath-like cues.
- It signals: “Merlin is with you,” “background work is running,” “attention is needed,” or “everything is calm.”
- No text, no forced animations, no explanations. The Orb should feel like a quiet pulsing breath, indicating readiness without interrupting thought.

## 4. Interaction Posture

- The user does not prompt, configure, or operate Merlin constantly. Merlin observes, adapts, and offers assistance when relevant.
- Merlin offers help gently; it interrupts only when absolutely necessary.  
- Many interactions occur without explicit prompts—Merlin anticipates, synthesizes context, and surfaces the next best move.

## 5. Embrace Empty Space

- "Empty" is a feature. It is capacity for thought, not a failure.  
- Show only what is relevant—prefer showing less than showing everything.  
- The environment must grow organically, not through a modular list of options.

## 6. Chat is a Doorway, Not the Room

- The chat interface is an access point, fallback, and quiet dialog path.  
- It must be able to appear and disappear, stay quiet, and carry context without ever dominating the experience.

## 7. Intuition over Transparency

- Trust is built through consistency. Merlin doesn’t need to explain every move or expose every internal state.  
- Decisions should feel natural; users should barely notice why they work.

## 8. Design Direction

- Avoid flashy, neon, sci-fi, or playful aesthetics.  
- Embrace calm, natural, deep, serious, and human design—something one takes seriously, not admires for novelty.

## 9. Quality Measure

- Every feature, element, or behavior must pass this test: *Does it make someone feel smarter without extra effort?*  
- If not, remove it.

## 10. Living Manifest Spec

### UI/Feature Guidelines

1. **State-first UI:** Use ambient cues (Orb, gradients, lighting) to show prᵒsess states instead of text overlays.  
2. **Progressive reveal:** Surface actions incrementally—assistants appear with contextually relevant recommendations rather than full menus.  
3. **Quiet intelligence:** Summaries, suggestions, and alerts should use simple typography, soft motion, and minimal copy.
4. **Single-path interactions:** Prefer one option over many. When choices exist, keep them highly contextual and limited in number.  
5. **Adaptive calmness:** The layout adjusts to the user's focus. Background systems live below the fold or in muted layers.  
6. **Orb-first notifications:** Use the Orb to indicate background work or attention needs before text appears.

### Workflows

1. **Observation loop:** Merlin passively observes context (calendar events, open docs, tasks) and surfaces one prioritized insight or action at a time.
2. **Quiet interventions:** Merlin only speaks up when an insight materially changes the user's path (risk, opportunity, conflict).
3. **Undoable nudges:** Suggestions should be gentle and instantly dismissible; Merlin retracts gracefully if ignored.
4. **Context retention:** Every suggestion references the current work—Merlin remembers what the user is doing even without explicit prompts.
5. **Orb-fueled pacing:** Use the Orb’s state to pace interactions, letting it signal readiness before any dialogue or action.

## Next Steps & Adoption

1. **Embed this manifest** in design reviews, user journeys, and sprint planning. Raise the question “Does this reduce cognitive load?” at every review.
2. **Document state metaphors** (Orb breathing, lighting, etc.) and ensure engineers know how to map telemetry to these cues without verbosity.
3. **Create a Merlin Playbook** describing common workflows that respect the manifesto (e.g., onboarding, deep work, interruptions).
4. **Monitor perception** by collecting micro-feedback on calmness/intuitiveness after releases; adjust fidelity, not noise.

Merlin is now an intelligent room—not a chat. Keep the Orb breathing, stay quiet, and always aim for effortless clarity.
