# Desktop Pet Agent

<p align="center">
  <img src="src/assets/logo.png" width="128" height="128" alt="Desktop Pet Agent logo" />
</p>

<p align="center">
  A standalone Electron desktop pet runtime for Codex-compatible pets and real agent hooks.
</p>

<p align="center">
  <a href="README.zh-CN.md">中文文档</a>
</p>

Desktop Pet Agent shows a draggable always-on-top desktop companion, plays Codex-compatible pet spritesheets, displays an edge-aware message bubble, and reacts to lifecycle hooks from Codex, Claude Code, and CodeBuddy.

The project has two goals:

- keep the desktop pet runtime independent from any single agent product;
- normalize different agent hook payloads into one small visual state machine.

## Features

- Standalone Electron desktop pet window with a tray icon; the pet window stays out of the main taskbar.
- Ships with bundled pets from `src/assets/pets`, so the app has usable pets on first launch.
- Loads Codex-compatible pet packages from one selected pets directory, defaulting to `~/.codex/pets`.
- Links to compatible pet galleries:
  - [Petdex](https://petdex.crafter.run/zh)
  - [Codex Pets](https://codex-pets.net/)
  - [SpriteYard](https://spriteyard.com/)
  - [Codex Pet Shop](https://www.codexpetshop.com/)
- Supports `.codex` pets and a custom pets folder.
- Supports the fixed 8-column x 9-row Codex pet atlas.
- Draggable pet with left/right running animation while moving.
- Idle-only resize handle and independently configurable message bubble scale.
- Edge-aware bubble placement near screen boundaries.
- Real hook installer for Codex, Claude Code, and CodeBuddy.
- Single active hook source selection to keep one coherent pet state.
- Local HTTP API for state updates, pet selection, hook status, and external integrations.
- Session aggregation and debounced `working -> thinking` transitions to avoid flicker during tool chains.

## Requirements

- Node.js 18+
- npm
- Electron-supported Windows, macOS, or Linux

Real hook support requires the target agent to be installed and able to load its own hook configuration.

## Quick Start

Install dependencies:

```bash
npm install
```

Start the app:

```bash
npm start
```

Run tests:

```bash
npm test
```

The local API listens on:

```text
http://127.0.0.1:17861
```

Optional environment variables:

```bash
PET_PORT=17862 npm start
PET_ID=boba npm start
```

PowerShell:

```powershell
$env:PET_PORT = "17862"
$env:PET_ID = "boba"
npm start
```

## Pet Storage

By default, Desktop Pet Agent reads pets from:

```text
~/.codex/pets
```

On Windows:

```text
C:\Users\<you>\.codex\pets
```

The settings window can switch the active storage location:

| Storage | Purpose |
| --- | --- |
| `.codex` pets | Default Codex-compatible pets directory. |
| Custom folder | A user-selected folder. |

Only the selected pets directory is loaded. Generated pet runs under `~/.codex/pet-runs` are not loaded automatically.

Bundled pets under `src/assets/pets` are always available and are shown separately from pets in the selected user directory.

## Pet Sources

Open settings by double-clicking the pet or from the tray menu. The settings page keeps links to compatible pet galleries.

Download a pet package from one of these sites, unzip it, then put the folder into the current pets directory or switch to a custom folder.

| Site | Notes |
| --- | --- |
| Petdex | Browse and install/download Codex-compatible pets. |
| Codex Pets | Browse shared Codex pet pages. |
| SpriteYard | Browse animated Codex companion packages. |
| Codex Pet Shop | Download zip packages and copy them into `~/.codex/pets`. |

Please use only pets you have the right to use. Artwork remains owned by its original author or rights holder.

## Pet Format

Each pet is a folder containing `pet.json` and a spritesheet:

```text
my-pet/
  pet.json
  spritesheet.webp
```

Expected atlas layout:

```text
1536 x 1872 image
8 columns x 9 rows
192 x 208 per cell
transparent background
WebP or PNG
```

Rows map to the fixed Codex states:

| Row | State | Meaning |
| --- | --- | --- |
| 0 | `idle` | idle / standing |
| 1 | `running-right` | moving right while dragged |
| 2 | `running-left` | moving left while dragged |
| 3 | `waving` | reminder / notification |
| 4 | `jumping` | done / happy jump |
| 5 | `failed` | sleeping / failed |
| 6 | `waiting` | waiting for input or permission |
| 7 | `running` | working / coding |
| 8 | `review` | thinking / reviewing |

Accepted aliases:

| Alias | Normalized state |
| --- | --- |
| `start`, `remind` | `waving` |
| `success`, `done` | `jumping` |
| `sleeping` | `failed` |
| `working` | `running` |
| `thinking` | `review` |

Example `pet.json`:

```json
{
  "id": "my-pet",
  "displayName": "My Pet",
  "description": "A Codex-compatible desktop pet.",
  "spritesheetPath": "spritesheet.webp"
}
```

## Agent Hooks

Supported hook integrations:

| Agent | Status | Config path | Events |
| --- | --- | --- | --- |
| Codex | Supported | `~/.codex/hooks.json`, `~/.codex/config.toml` | 10 |
| Claude Code | Supported | `~/.claude/settings.json` | 6 |
| CodeBuddy | Supported | `~/.codebuddy/settings.json` | 9 |

Start the app before installing hooks:

```bash
npm start
```

Check hook status:

```bash
npm run hooks:doctor
```

Preview hook changes without writing config:

```bash
npm run hooks:preview
```

Install all supported hooks:

```bash
npm run hooks:install
```

Install one agent:

```bash
npm run hooks:install -- --agent codex
npm run hooks:install -- --agent claude-code
npm run hooks:install -- --agent codebuddy
```

Uninstall only hooks managed by this project:

```bash
npm run hooks:uninstall
```

Managed hooks contain this marker:

```text
--desktop-pet-agent-managed
```

Existing config files are backed up before writes:

```text
*.desktop-pet-agent-backup-<timestamp>
```

## Hook Event Mapping

Agent events are normalized into the fixed pet states:

| Incoming event | Pet state |
| --- | --- |
| `SessionStart` | `waving`, then `review` |
| `UserPromptSubmit` | `review` |
| `PreToolUse` | `running`, or `waiting` for test-like commands |
| `PostToolUse` | delayed `review` |
| `PermissionRequest` | `waiting` |
| `Notification` | `waving` |
| `Stop` | `jumping`, then idle or aggregate state |
| `StopFailure` | `failed`, then idle or aggregate state |
| `SessionEnd` | clears the session |

OpenPets-style reactions are also accepted:

| Reaction | Pet state |
| --- | --- |
| `thinking` | `review` |
| `working`, `editing`, `running` | `running` |
| `testing`, `waiting` | `waiting` |
| `waving` | `waving` |
| `success`, `done`, `celebrating` | `jumping` |
| `error`, `failed` | `failed` |

## HTTP API

Health check:

```bash
curl http://127.0.0.1:17861/health
```

List pets:

```bash
curl http://127.0.0.1:17861/pets
```

Select pet storage:

```bash
curl -X POST http://127.0.0.1:17861/pets/storage \
  -H "Content-Type: application/json" \
  -d '{"storage":"codex"}'
```

List actions:

```bash
curl http://127.0.0.1:17861/actions
```

Show a manual state:

```bash
curl -X POST http://127.0.0.1:17861/state \
  -H "Content-Type: application/json" \
  -d '{"state":"working","message":"Agent is working"}'
```

Send a generic agent event:

```bash
curl -X POST http://127.0.0.1:17861/events \
  -H "Content-Type: application/json" \
  -d '{"source":"claude-code","event":"tool_start","sessionId":"demo","message":"Claude is using a tool"}'
```

Select active hook source:

```bash
curl -X POST http://127.0.0.1:17861/hooks/select \
  -H "Content-Type: application/json" \
  -d '{"agent":"codebuddy"}'
```

Resize bubble independently:

```bash
curl -X POST http://127.0.0.1:17861/bubble/resize \
  -H "Content-Type: application/json" \
  -d '{"bubbleScale":1.2}'
```

Clear sessions:

```bash
curl -X POST http://127.0.0.1:17861/sessions/clear
```

## Project Structure

```text
src/main.js                  Electron main process, windows, settings, HTTP API
src/pet-library.js           Pet discovery and storage selection
src/agent-events.js          Agent event normalization and state mapping
src/session-manager.js       Session aggregation and priority state selection
src/hook-bridge.js           Hook stdin JSON -> local /events bridge
src/hook-installer.js        Codex, Claude Code, CodeBuddy hook installer
src/preload.js               Safe IPC bridge
src/renderer/index.html      Transparent pet window
src/renderer/renderer.js     Spritesheet player, dragging, resizing
src/renderer/bubble.html     Independent message bubble window
src/renderer/settings.html   Settings window
test/pet-library.test.js     Pet loading and storage tests
```

## Security And Privacy

- The runtime listens on `127.0.0.1` by default.
- Hook payloads may include prompts, tool names, paths, or command summaries depending on the agent.
- Payloads are forwarded only to the local runtime; this project does not upload hook data.
- Recent hook events are kept in memory for the settings panel and are not persisted by this app.
- The hook installer modifies only managed hook entries marked by this project.
- Existing agent config files are backed up before writes.

## Troubleshooting

### No pet appears

Check that at least one pet package exists under the currently selected pets directory. The default is:

```text
~/.codex/pets
```

Then open:

```text
http://127.0.0.1:17861/pets
```

### Downloaded pet does not appear

Confirm the pet folder is inside the currently selected pets directory and contains both `pet.json` and a valid `spritesheet.webp` or `spritesheet.png`.

### Hook status is green but no event appears

Restart the target agent after installing hooks. Claude Code and CodeBuddy may not reload changed hook config in already-running sessions.

For Claude Code and CodeBuddy, run:

```text
/hooks
```

and confirm the external hook configuration is enabled.

### CodeBuddy does not trigger on Windows

CodeBuddy runs hooks through Git Bash on Windows. Reinstall hooks with:

```bash
npm run hooks:install -- --agent codebuddy
```

The generated command should quote Windows paths.

### Tray icon does not show

The app keeps its persistent entry in the system tray instead of the main taskbar. If the tray icon does not update immediately on Windows, quit the app completely and start it again so Electron reloads the icon and AppUserModelID.

### Bubble flickers between working and thinking

The runtime debounces `PostToolUse -> review` transitions. If flicker still occurs, check whether another active hook source is sending events. The settings page shows the currently selected source.

## Development

Start in dev mode:

```bash
npm run dev
```

Run tests:

```bash
npm test
```

Run syntax checks manually:

```bash
node --check src/main.js
node --check src/pet-library.js
node --check src/hook-installer.js
node --check src/hook-bridge.js
```

## Contributing

Useful PRs include:

- new agent hook installers;
- hook detection fixes for existing agents;
- Windows, macOS, or Linux compatibility fixes;
- packaged release support;
- tests for hook installer and pet loading edge cases;
- better Codex-compatible pet validation.

For a new agent integration, include config path documentation, install/doctor/preview/uninstall behavior, event mapping into the 9 fixed states, and restart or approval notes for the target agent.

## License

MIT. See [LICENSE](LICENSE).
