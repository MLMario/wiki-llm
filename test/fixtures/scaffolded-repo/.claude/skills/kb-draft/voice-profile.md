---
maintained-by: human (Mario)
last-updated: 2026-04-25
runtime-samples-from:
  - knowledge-base/wiki/sources/2026-04-25-stop-building-agents-start-building-context-summary.md
  - knowledge-base/wiki/sources/2026-04-22-evergreen-interests-summary.md
  - knowledge-base/wiki/sources/2026-04-22-building-knowledge-bases-llms-maintain-summary.md
---

# Voice Profile — Mario (Real Value AI)

## Idiosyncratic moves

(Hand-curated. Each is a specific syntactic or rhetorical pattern the writer
reaches for. Pass 5b matches sentences against these by index.)

1. **Specificity-compounds-generality-decays coinages.** Pairs a sharp
   specific noun with a sharp generic verb to compress an axiom.
   ("Specificity compounds. Generality decays.")
2. **The-wiki-shouldn't-be-X-it-should-be-Y reframing.** Inverts a passive
   relationship to an active one in a single sentence — the corrective
   shape, never the descriptive one.
3. **Claim-then-counter-immediately.** States a position, then in the same
   paragraph says where it doesn't apply — never hedges with "however"
   between sentences. The counter is structural, not rhetorical.
4. **Concrete-anecdote-as-evidence.** Drops a numeric concrete detail
   (a 6-week build replaced by a 2-day setup; a 130-page wiki) instead of
   an abstract description. Numbers earn their keep.
5. **Naming-the-architecture-pattern.** Coins the noun for the pattern
   ("harness commoditization", "context layer", "voice-check primitive")
   and uses it as a load-bearing handle in the rest of the piece.

## Banned phrases / openers

(Static blocklist. Pass 4 must avoid; pass 5b flags any that slip through.)

- "in today's fast-paced world"
- "delve into" / "delve"
- "tapestry"
- "ever-evolving landscape"
- "embark on a journey"
- "leverage" (as a verb when "use" works)
- "harness" (as a verb — collides with the noun the author uses for the
  Claude Code / agent harness)
- "vibrant"
- "crucial"
- "compelling"
- "not just X, but Y"
- "in conclusion"
- "organizations must embrace innovation"

## Verbatim sample sentences

Populated at runtime from the sources in `runtime-samples-from`. Pass 5b's
prompt construction concatenates each source's `## TL;DR` and the first 3
`## Key takeaways` bullets verbatim, numbered sample-1, sample-2, sample-3, …
in source-list order. Do not pre-fill this section; the runtime samples are
the source of truth and the static seed must not duplicate them.
