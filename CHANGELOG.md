# Changelog

## [0.7.0] — 2026-11-01

### Added

- Manage collection-level variables and secrets alongside workspace and environment variables in the Variables modal.
- Support collection variable precedence over environment and workspace variables with winning source identification in hover tooltips.
- Mask secret values in variable hover inspector by default with on-demand reveal via mouse click or `⌥ Option` / `Alt` key peek.
- Automatic `.gitignore` synchronization for collection secret files (`.apiclient/collection.secrets.json`).
- Sample collection (`examples/variable-resolution`) for verifying variable resolution and precedence rules.

## [0.6.0] — 2026-11-01

### Added

- Choose and switch the active workspace from the app title bar.
- Store app settings separately from workspace collections, environments, secrets, and request history.
- Migrate existing workspace data into the default workspace folder while preserving conflicting files.

### Changed

- Keep each workspace folder self-contained and open selected folders without adding starter content.

## [0.5.0] — 2026-11-01

### Added

- Import Postman environment exports and switch the active environment from the Variables menu.
- Import Postman collection variables and use them as the highest-priority variable scope.
- Upload files with multipart form requests and save file responses to disk.
- Add a live desktop app preview and the shipped application icon to the GitHub Pages site.

### Changed

- The Variables control now uses a compact label while showing the active environment.
- Document variable resolution order: collection variables, selected environment, then workspace values and secrets.
