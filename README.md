# Comparitor

**Comparitor** is a retro-styled code diff and analysis workspace. Paste two versions of code side-by-side, get instant visual diffs, automatic bug detection, and an AI-grade code review — all in the browser.

🔗 **Live demo:** [shianmike.github.io/comparitor](https://shianmike.github.io/comparitor/)

---

## Features

- **Side-by-side diff viewer** — Monaco Editor panels with line-level diff highlighting and inline change tooltips
- **Character-level diffing** — powered by the `diff` library for granular added/removed/modified callouts
- **Static code analysis** — detects undefined variables, mismatched brackets, unused symbols, missing returns, and risky patterns across JS/TS and Python
- **Code review summary** — structured findings grouped by severity (errors, warnings, suggestions) with suggested fixes
- **File upload** — drag-drop or browse to load any text file into either panel
- **RetroUI design** — custom pixel-border card system, badges, and tab components

## Tech Stack

| Layer | Library |
|-------|---------|
| Framework | React 19 + TypeScript |
| Build | Vite |
| Editor | Monaco Editor (`@monaco-editor/react`) |
| Diff | `diff` (jsdiff) |
| Styling | Tailwind CSS |
| Icons | Lucide React |

## Getting Started

```bash
npm install
npm run dev
```

Open [http://localhost:5173](http://localhost:5173).

## Build

```bash
npm run build
```

Output is written to `dist/`.

## Project Structure

```
src/
  App.tsx              # Main layout and editor panels
  types.ts             # Shared TypeScript types
  lib/
    codeAnalysis.ts    # Static analysis engine
    utils.ts           # Class name helper
  components/retroui/  # Retro-styled UI primitives
    Badge.tsx
    Button.tsx
    Card.tsx
    Tabs.tsx
```

## License

MIT
