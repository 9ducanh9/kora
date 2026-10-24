# Run locally

Use Node.js 24 and npm. Install the locked dependencies with `npm ci`, copy
`.env.example` to `.env.local`, then run `npm run dev` and open
`http://localhost:3000`.

The development and build hooks copy the ELK worker from the installed dependency
into `public/vendor`. Do not commit generated worker files or `node_modules`.
The curated AWS icons and asset manifest are already included; rebuilding the
catalog is not required to run the editor.

## Provider configuration

`DEEPSEEK_KEY` is optional for example diagrams and required for live local AI
generation unless a key is entered in the prompt settings. `DEEPSEEK_MODEL`
optionally overrides the default `deepseek-chat`. Keep keys in `.env.local`,
never in source or a `NEXT_PUBLIC_` variable. Generation sends the supplied
architecture description to DeepSeek. Keys entered in the prompt settings stay
in memory until refresh; legacy saved browser keys are removed on startup.

`npm run build` and `npm start` run a production build, whose generation endpoint
stays disabled. Use development mode to test live generation. The production
lock has no environment toggle.

## Editor controls

| Control | Action |
|---|---|
| Edit Prompt / Quick Test | Select Quick Test and Acceptance Test (Sec 22) to run the fixed offline example |
| Generate Architecture | Generate from the description in local development |
| Left drag on an icon | Move that component |
| Drag a group header | Move the group and its descendants |
| Right drag on canvas | Pan |
| Left drag in minimap | Navigate the overview |
| Double-click a label | Rename |
| Connection handles | Create or reconnect a wire |
| Shift + drag | Select a region |
| Auto Layout | Recalculate placement and routes |
| Snap 20px | Toggle grid snapping |
| Undo / Redo | Revert or repeat an editor command |
| Save / Load | Store or restore the browser copy |
| Export / Import | JSON backup, SVG/PNG image export, or JSON import |

JSON backups are useful when switching browsers or domains: browser storage does
not move with the app URL.

## Validation

```bash
npx tsc --noEmit
npm run test:document-validation
npm run test:document-ingestion
npm run test:editor-commands
npm run test:editor-transactions
npm run test:layout-routing
npm run test:diagram-export
npm run test:provider-contract
npm run test:semantic-generation
npm run build
```

`npm run test:deepseek` calls the real provider and requires a key; it can incur
provider charges. Most regression suites use local fixtures or mocked responses.
`npm run lint` runs ESLint without an interactive setup prompt. `npm run test:ci`
runs all offline suites with provider keys removed from their environment.
After building, `npm run test:browser` runs the Chromium regression tests (install
the browser first with `npx playwright install chromium`). CI runs all these checks.
