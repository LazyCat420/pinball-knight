# How to use this document

This is the persistent working record for this repository — the sprite forge and the dungeon it feeds. It replaces one-off
chat reports that vanish when a session ends: everything worth remembering
about how this system behaves lives here, in the repo, versioned alongside the
code it describes.

Two audiences, one document. The operator reads it to answer *"what is working,
what is broken, what should I do next"* without re-deriving it. An assistant
picking up a cold session reads it to avoid re-investigating what was already
established.

## The contract

**Markdown is the source of truth. HTML is generated.**
Chapters live in `documentation/chapters/*.md`. `index.html` is built from them
and must never be hand-edited — it carries a `do not edit by hand` stamp for
that reason. Open it in a browser for the readable version; edit the markdown
for the durable one.

```bash
python3 documentation/build_docs.py          # rebuild index.html
python3 documentation/build_docs.py --check  # fail if index.html is stale
```

The builder is stdlib-only and self-contained. No `pip install`, no CDN, no
network at view time — a docs build that needs a working environment first is a
docs build that quietly stops happening.

## When to write here

Update this document **as part of the change**, in the same commit — not
afterwards from memory. Specifically:

- A behaviour is verified working → record it in *Current state*, with the
  evidence that proved it.
- Something is found broken → record it in *Open items* with its blast radius,
  even if it is not being fixed now.
- A fix ships → move the item, and add the mechanism to the relevant chapter so
  the next reader learns the rule, not just the patch.
- An incident is diagnosed → write it up in *Incidents*. The diagnosis is worth
  more than the fix; the fix is one line, the reasoning is what prevents the
  next one.

## What earns a place

Write down what a competent reader could **not** recover from the code in ten
minutes: why a thing is the way it is, what was tried and rejected, which
signals lie, which failure looks like success. Do not restate what the code
already says plainly — a paraphrase of a function is maintenance debt that goes
stale silently.

Be specific and falsifiable. "Improved reliability" is not a record. "Gatekeeper
returned an empty response on 3 of the last 5 cycles; each one ended green with
0 tickers" is. Prefer measured numbers, log lines, and commit SHAs over
adjectives — and mark unverified claims as unverified rather than smoothing them
into fact.

## Chapter layout

| File | Holds |
|---|---|
| `00-how-to-use-this.md` | This contract |
| `01-cycle-pipeline.md` | How a trading cycle actually runs, end to end |
| `02-current-state.md` | What is verified working, right now, with evidence |
| `03-open-items.md` | Known-broken and not-yet-done, ranked |
| `04-incidents.md` | Diagnosed failures and the lesson each one carries |
| `05-runbook.md` | Commands to operate, inspect, and verify the system |
| `06-report-standards.md` | How to build reports and diagrams in this repo |

Filenames carry a numeric prefix purely to fix the reading order; the number is
stripped from the rendered title. Add a chapter by dropping a new numbered file
into `chapters/` and rebuilding — the nav picks it up automatically.
