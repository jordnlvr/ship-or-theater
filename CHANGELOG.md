# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.2] - unreleased

### Fixed
- Social card (`assets/social-card.html`, `assets/social-card.png`, `site/social-card.png`): enlarged the body copy, verdict band labels and footer command/URL to 30–32px so all text remains legible at social thumbnail widths (~400px).
- Phone and tablet navigation menu (`site/styles.css`): gave the open menu disclosure a solid surface, stronger bottom border and shadow, and a dim scrim over the page below it in both light and dark mode so body text does not show through.
- Hero CLI command on phone (`site/styles.css`): kept `$ npx ship-or-theater "<claim>"` on a single line across 360–430px viewports with a responsive monospace font size while keeping the Copy button reachable and preventing horizontal scroll.
- README layout (`README.md`): moved the centered `assets/logo.svg` wordmark block to the very top of the file above the `sot:readme-pitch` block.

## [1.0.1] - 2026-11-07

### Changed
- Updated `package.json`, CLI `--help`, and MCP `evaluate_claim` descriptions to begin with the plain-English summary: *"Paste in an AI claim you saw online and get a straight answer, with evidence: real (SHIPS), half-true (MIXED) or hype (THEATER)."*
- Landing page, README and social card now say who it's for and why; phone menu links to Principles.
- Upgraded `@anthropic-ai/sdk` from `^0.39.0` to `^1.6.0`, removing the transitive `formdata-node` / `node-domexception@1.0.0` install deprecation warning.
- `VERSION` is now read from `package.json` at runtime so CLI and MCP version metadata cannot drift from the package manifest.

### Fixed
- `npx ship-or-theater "<claim>" > file` from Git Bash on Windows could exit 0 with an empty file. The CLI now waits for `stdout` to finish writing (and drain) before it exits; verified with a real run through `npx` in Git Bash. `--out <file>` remains the most robust way to save a scorecard.
- Output write errors (for example a closed pipe) are reported on `stderr` with exit code `1` instead of crashing.

## [1.0.0] - 2026-11-07

### Added
- Styled terminal scorecard (`src/terminal.ts`) as the default output when `stdout` is a TTY: verdict badge (`SHIPS` green, `MIXED` amber, `THEATER` red, `INCONCLUSIVE` grey), reality score bar, per-dimension bars and confidence, steelman, strongest debunk, and footer.
- `--format pretty|markdown|json` CLI flag and `--no-color` / `NO_COLOR` support (non-TTY output defaults to `markdown` for backward compatibility).
- Live TTY progress indicator on `stderr` while pipeline stages run (`extractor → 6 skeptics → steelman → judge`).
- Zero-setup `ship-or-theater rubric` subcommand and `--rubric` flag to print the fixed reality rubric and verdict bands with no model or API key, plus `--version` (`-V`).
- Shared provider resolution (`SOT_PROVIDER=auto|api|claude-cli`) across both the CLI and MCP server (`ship-or-theater-mcp`), allowing MCP clients to evaluate claims via the local `claude` CLI without `ANTHROPIC_API_KEY`.
- Claim gallery runner (`gallery/gallery.mjs`) with `--only <slug>`, `--concurrency <n>`, and `--force` options.
- Cross-platform GitHub Actions CI matrix (`ubuntu-latest`, `windows-latest`, `macos-latest` × Node 20/22) and GitHub Pages deployment workflow.

### Changed
- Updated the default Anthropic API model from `claude-sonnet-4-6` to `claude-sonnet-5-5` (still overrideable via `SOT_MODEL` or `--model`).

### Fixed
- Fixed Windows `spawn claude ENOENT` failure in `--provider claude-cli` by resolving `claude.cmd` / `claude.exe` on `PATH` and invoking `.cmd` shims safely with stdin prompt piping.
- Missing `claude` binary now fails immediately without retrying and prints an actionable install/key message.

### Removed
- Removed hand-authored `examples/` directory in favor of real pipeline runs in `gallery/`.
