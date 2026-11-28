<div align="center">

# Writer

**A Local-First AI Writing Agent Workbench Built Specifically for Web-Novel & Long-Form Fiction Authors**

*Stay in full command of million-word serials — every foreshadowing thread, character arc, and cliffhanger, without losing your voice.*

[![Release](https://img.shields.io/github/v/release/Minglink/Writer?style=flat-square&label=Release&color=8B5E34)](https://github.com/Minglink/Writer/releases/latest)
[![Download](https://img.shields.io/badge/Windows_x64-Installer-2C2824?style=flat-square&logo=windows)](https://github.com/Minglink/Writer/releases/latest)
[![Agent Kernel](https://img.shields.io/badge/Kernel-DeepSeek_Harness-2F6668?style=flat-square)](./packages/agent-runtime/src/dsh)
[![Architecture](https://img.shields.io/badge/Electron-5--Process_Isolated-40845A?style=flat-square&logo=electron)](./apps/desktop)
[![Storage](https://img.shields.io/badge/Local--First-Markdown_%2B_SQLite-6E5A44?style=flat-square)](./AGENTS.md)
[![License](https://img.shields.io/badge/License-PolyForm_Noncommercial_1.0.0-A94F47?style=flat-square)](./LICENSE)

[简体中文](./README.md) · **English** · [Download v0.1.7](https://github.com/Minglink/Writer/releases/tag/v0.1.7)

</div>

---

<p align="center">
  <img src="./docs/images/workbench-preview.png" alt="Writer Warm Book-Page Workbench" width="100%" />
</p>

## Why Writer?

Writing a million-word serialized web novel is fundamentally different from drafting a short article:

- **Continuity breaks at scale**: By chapter 200, subtle items, injuries, power-system rules, and uncollected foreshadowing threads buried in early chapters become nearly impossible to track manually.
- **Generic chat UIs leak spoilers & lose context**: Re-pasting worldbuilding into chat windows wastes time, and revising Chapter 18 when you've already written Chapter 80 often causes generic LLMs to leak future twists ("omniscient spoiler pollution").
- **Silent overwrites ruin authorial voice**: Most AI writing tools overwrite prose with stiff, generic phrasing and offer no line-by-line diff review.
- **Eye fatigue during marathon sessions**: Stark white or harsh high-contrast dark screens punish authors writing 5,000–10,000 words a night.

**Writer** is engineered from the ground up to solve these exact problems — combining local-first Markdown storage, an anti-spoiler long-form continuity engine, book-decomposition craft libraries, multi-agent teams, and a mandatory Diff Proposal Gate inside a warm, eye-friendly book-page desktop studio.

---

## Core Capabilities

<p align="center">
  <img src="./docs/images/webnovel-agent-pipeline.svg" alt="Web-Novel Long-Form Memory and Co-Creation Pipeline" width="100%" />
</p>

- **Long-Form Continuity & Anti-Spoiler Evidence Engine**: Automatically assembles worldbuilding, character cards, foreshadowing ledgers, margin notes, and previous-chapter hooks while strictly truncating future timeline spoilers when revising earlier chapters.
- **Purpose-Built Co-Creation Guardrails**: Switch seamlessly between **Read-Only Brainstorming** (plot breakthroughs without touching prose), **Read-Only Critique** (pacing, logic, and reader-retention checks), and **Selection Rewrite / Chapter Co-Writing**.
- **Book Decomposition & Reusable Craft Skills**: Decompose full-length novels, compare styles, and analyze your own manuscript revisions to distill reusable **Skills** (`/`) and **Materials** (`@`).
- **Mandatory Diff Proposal Gate**: Agents never silently overwrite your manuscript. Every proposed edit is presented as an inspectable diff; only accepted changes are atomically written to disk with optimistic revision locking.
- **Book-Page Eye-Care Aesthetics**: Warm slightly-yellowed paper light theme (`#F6F1E4`) and e-reader-inspired low-glare night mode (`#1B1A18` / `#C8C2B6`).

---

## System Architecture

<p align="center">
  <img src="./docs/images/system-architecture.svg" alt="Writer 5-Process System Architecture" width="100%" />
</p>

Writer enforces strict process isolation across five Electron processes (**Renderer**, **Main**, **Core Utility**, **Agent Utility**, and **Tool Utility**) connected via Zod-validated IPC envelopes (`@writer/contracts`), powered by the **DeepSeek Harness** LLM & tool execution seams (`packages/agent-runtime/src/dsh/`).

- **Bring Your Own Models (BYOK)**: Connect `OpenAI Completions`, `OpenAI Responses`, `Anthropic Messages`, or `Google Generative AI` endpoints with OS-encrypted API keys (`SafeStorage`) never exposed to the Renderer.
- **Open Local Files + MCP**: Works are stored as `writer.json` + UTF-8 Markdown folders compatible with Git and cloud drives, with an optional bounded **MCP** interface for external coding/writing agents.

---

## Getting Started

Download `Writer-0.1.7-win-x64.exe` (for **Windows 10 / 11 x64**) from [**GitHub Releases**](https://github.com/Minglink/Writer/releases/latest), or run from source (`Node.js >= 24`, `pnpm >= 11`):

```bash
git clone https://github.com/Minglink/Writer.git
cd Writer
pnpm install
pnpm dev
```

Build the Windows x64 installer locally:

```bash
pnpm pack:win
```

---

## License

Licensed under the **[PolyForm Noncommercial License 1.0.0](./LICENSE)** — free for personal creation, study, academic research, and non-commercial use and redistribution; commercial use requires separate authorization.
