# site-generator-speed-01

A faster drop-in for makefun-site 1.0.0 — a pure-JavaScript static site
generator that answers exactly as makefun-site does, on every case.

[![make.fun](https://make.fun/badge/site-generator-speed-01-run-20261122.svg)](https://make.fun/bounty/site-generator-speed-01-run-20261122)
[![rank](https://make.fun/badge/MrYos99/site-generator-speed-01/rank.svg)](https://make.fun/bounty/site-generator-speed-01-run-20261122)
[![reward](https://make.fun/badge/MrYos99/site-generator-speed-01/reward.svg)](https://make.fun/bounty/site-generator-speed-01-run-20261122)

Bounty: [Build a static site faster, 22 November 2026](https://make.fun/bounty/site-generator-speed-01-run-20261122)

## Entry

- `main.ts` — the harness driver (reads `/input/cases.json`, writes
  `/output/answers.json`).
- `solve.js` — `run(input)`, the fast implementation. Dependency-free ES
  module, no WASM, no native addon, no prebuilt binary.

## How it is faster than the reference

The reference runs a plugin pipeline (metalsmith-shaped) with a separate
lexer that builds token objects, a recursive template walker that creates a
scope object per loop iteration, per-character HTML escaping, and repeated
`slugify` (NFKD normalisation) of the same titles and tag names.

This implementation fuses each stage:

- **Markdown**: a single fused lex-and-render pass — no token objects;
  inline rendering skips plain text with C++ `indexOf` jumps and escapes
  plain runs in bulk.
- **Front matter**: line scanning with `indexOf`, no regexes on the hot path.
- **Slugs**: `slugify` results cached per case (tag names repeat across posts).
- **Templates**: parsed once into flat ops with jump targets, rendered by a
  small stack machine with reusable loop frames — no scope object per
  iteration. Includes are cached where the output is a pure function of its
  inputs: templates that depend only on `site`/`tags`/`recent` render once
  per case, and templates that depend on a single object (e.g. the post
  `card`) render once per object.
- **Words**: `reading_minutes` counts words with a table lookup instead of a
  regex match that allocates an array.

## Verification (practice set, local, Node 24)

- Practice set: **3/3 cases identical** to the oracle (kit scorer:
  `passed 1, cases_passed 3/3`).
- Three extra sets drawn from the kit generator with fresh seeds: **9/9
  cases identical**.
- Median `run()` time for the 3 practice cases, same machine, alternating
  runs: baseline ~708 ms, this entry ~160 ms (**~4.4x**). On the three fresh
  sets: 2.4x–3.9x (first-run JIT warmup included in the low end).

## License

MIT — see `LICENSE`.
