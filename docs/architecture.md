# Architecture

Kora is a Next.js application. React Flow renders the editable canvas; ELK
calculates hierarchical placement and connection routes. The API route calls
DeepSeek only in local development.

## Generation path

1. The prompt editor sends a description to `/api/parse-architecture`.
2. The verified DeepSeek parser extracts requirements and creates an architecture graph.
3. Schema validation checks structure; semantic checks compare entities, boundaries, and flows against the extracted requirements. Repair attempts and request time are bounded.
4. The client resolves assets, normalizes the architecture, measures text, and runs layout through the ELK worker.
5. The resulting document enters the editor as a replacement operation. Failed or stale results do not replace the current diagram.

The model does not supply final canvas coordinates. Semantic validation is only
as complete as the extracted requirements and implemented checks; it is not an
audit of deployed infrastructure.

## Document and editor

The document separates semantic nodes, containers, and connections from their
presentation: coordinates, dimensions, endpoint sides, cached routes, and viewport.
The command engine manages moves, label edits, deletion, connections, layout,
undo, and redo. Drag previews stay outside the committed document until release.

Controlled React Flow updates retain existing DOM measurements when dimensions
are unchanged, so dragging does not hide nodes or disconnect their rendered edges.
Resizes invalidate those measurements. Route caches have an input signature;
manual geometry changes can use fallback routes until Auto Layout is rerun.

Browser persistence supports local save/load and detects changes from another
tab. JSON preserves an editable document; SVG and PNG are image exports.

## Source map

| Directory | Responsibility |
|---|---|
| `src/app` | Workspace and API routes |
| `src/components` | Prompt, canvas, toolbar, and footer |
| `src/core/ai` | Provider calls, parsing, and evaluation |
| `src/core/architecture` | Architecture preparation and policy |
| `src/core/diagram`, `validation`, `ir` | Document types, validation, and architecture model |
| `src/core/commands`, `editor` | History, interactions, and drag geometry |
| `src/core/layout` | Measurement, ELK worker, routing, and cache validation |
| `src/core/export`, `workspace` | File output and browser persistence |
| `src/core/server` | Bounded request bodies and local generation limits |
| `tests/fixtures`, `scripts` | Example inputs, regression checks, and evaluation tooling |

## Production boundary

The public editor runs on Vercel. The generation API returns 503 in production;
`/api/health` reports editor liveness with HTTP 200; `/api/ready` returns 503 while
generation is disabled. Supplying an API key does not bypass
that gate. Hosted identity, entitlements/billing, shared usage limits, and usage
accounting must be integrated before enabling public generation.

There is no hosted diagram database or collaboration server. Source publication
on GitHub is separate from the existing deployment; it does not itself establish
automatic deployment from Git pushes.
