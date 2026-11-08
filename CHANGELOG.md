# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
