<h1 align="center">Kora</h1>

<p align="center">English · <a href="README.vi.md">Tiếng Việt</a></p>

<p align="center">Describe an AWS architecture. Get a diagram. Make it yours.</p>

<p align="center">
  <a href="https://kora-nine-kappa.vercel.app/">Open the editor</a> ·
  <a href="docs/architecture.md">Architecture</a> ·
  <a href="docs/run-local.md">Run locally</a> ·
  <a href="docs/README.md">Documentation</a>
</p>

<p align="center">
  <img alt="Next.js + TypeScript" src="https://img.shields.io/badge/Next.js-TypeScript-3178C6?style=flat&amp;logo=nextdotjs&amp;logoColor=white&amp;labelColor=16243a" />
  <img alt="React Flow + ELK" src="https://img.shields.io/badge/React_Flow-ELK-61DAFB?style=flat&amp;logo=react&amp;logoColor=61DAFB&amp;labelColor=16243a" />
  <img alt="AWS architecture diagrams" src="https://img.shields.io/badge/AWS-Architecture-FF9900?style=flat&amp;labelColor=16243a" />
</p>

Kora turns a natural-language architecture description into an editable AWS
diagram. It separates the architecture model from its layout, checks the generated
structure and extracted requirements, and arranges the result with AWS icons and
nested cloud, VPC, and subnet boundaries.

![Kora editor](docs/images/kora-editor.png)

The screenshot shows an example diagram in the editor. **The public deployment
currently supports editing, examples, import, and export; live AI generation is
disabled in production.** DeepSeek generation is available in local development
with your own API key. The custom domain `kora.aurel.id.vn` is being connected;
the editor link above uses the existing Vercel address.

## What it does

| Prompt to diagram | Editable canvas | Portable output |
|---|---|---|
| Extract components, boundaries, and directed flows, then validate and lay out the architecture. | Move icons and groups, edit labels, connect services, undo changes, and rerun Auto Layout. | Save in the browser, keep an editable JSON backup, or export SVG and PNG. |

- Official AWS service icons, with generic components for external systems.
- Hierarchical layout and orthogonal connections through ELK.
- Separate checks for document validity and extracted semantic requirements, with bounded AI repair.
- Right-button drag to pan; left-button drag in the minimap to navigate.
- Grid snapping, zoom controls, and light, dark, or system themes.

## How it works

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/images/kora-workflow-dark.svg" />
  <source media="(prefers-color-scheme: light)" srcset="docs/images/kora-workflow-light.svg" />
  <img alt="Kora workflow: describe, extract requirements and graph, validate schema and semantics, arrange AWS icons with ELK, then edit and export." src="docs/images/kora-workflow-light.svg" />
</picture>

Created with Kora's layout and SVG exporter. [Open the editable JSON](docs/images/kora-workflow.json) with the editor's Import button.

AI supplies the architecture graph; Kora calculates the diagram geometry. Manual
edits go through a command history so a move, rename, or layout can be undone as
one operation. Diagrams are stored in the browser, without a hosted diagram
database.

Semantic checks compare the graph with requirements extracted from the prompt.
They help detect omissions and incorrect flows, but do not prove the architecture
matches a real deployment. See [architecture](docs/architecture.md) for the data
model, request path, and current production boundary.

## Run locally

Requires Node.js 24 and npm.

```bash
git clone https://github.com/9ducanh9/kora.git
cd kora
npm ci
cp .env.example .env.local
npm run dev
```

Open `http://localhost:3000`. In **Edit Prompt**, choose **Quick Test** and
**Acceptance Test (Sec 22)**, then generate the fixed example without a key.
For live local generation, set `DEEPSEEK_KEY` in
`.env.local` or enter your key in the prompt settings.

On PowerShell, use `Copy-Item .env.example .env.local` instead of `cp` if needed.
The [local guide](docs/run-local.md) includes controls, validation commands, and
production limitations.

AWS icons retain their respective AWS rights; bundled fonts include their license
in [public/fonts](public/fonts). Kora is an independent project, not an AWS product.
