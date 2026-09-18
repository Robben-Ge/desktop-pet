# Our Pets

<p align="center">
  <img src="src/assets/logo.svg" width="132" height="132" alt="Our Pets desktop pet logo" />
</p>

<p align="center">
  <strong>A small desktop companion for your daily rhythm.</strong><br />
  Switch characters, keep a gentle reminder nearby, and make your workspace feel a little more alive.
</p>

<p align="center">
  <a href="README.zh-CN.md">中文文档</a> ·
  <a href="https://github.com/Robben-Ge/desktop-pet/releases">Download the latest release</a>
</p>

<table>
  <tr>
    <td width="33%" align="center">
      <img src="docs/assets/readme/characters.svg" width="52" height="52" alt="Characters" /><br />
      <strong>Characters</strong><br />
      <sub>Three bundled pets plus your own sprite packs.</sub>
    </td>
    <td width="33%" align="center">
      <img src="docs/assets/readme/interaction.svg" width="52" height="52" alt="Greetings and reminders" /><br />
      <strong>Daily rhythm</strong><br />
      <sub>Greetings and thoughtful reminders when you want them.</sub>
    </td>
    <td width="33%" align="center">
      <img src="docs/assets/readme/control.svg" width="52" height="52" alt="Controls" /><br />
      <strong>In your control</strong><br />
      <sub>Drag, resize, use the tray, and tune the details in Settings.</sub>
    </td>
  </tr>
</table>

Our Pets is a standalone Electron desktop pet. It lives above your desktop without taking a taskbar slot, stays accessible from the system tray, and focuses on companionship, reminders, and customizable characters.

## Start here

### Install a release

Get the current Windows x64 installer or macOS zip from [GitHub Releases](https://github.com/Robben-Ge/desktop-pet/releases). Packaged builds can check GitHub Releases for updates from the Settings window.

### Run from source

```bash
npm install
npm start
```

Choose a bundled pet when starting locally:

```bash
PET_ID=danna-graduation npm start
```

Available bundled IDs are `danna-graduation`, `danna-dress`, `robben`, `robben-plaid`, and `dan-black-dress`.

## Everyday use

| What you want to do | How |
| --- | --- |
| Move the pet | Drag it with the primary mouse button. It runs in the direction of travel. |
| Give it a quick reaction | Click the pet to make it jump. |
| Change its size | Hover an idle pet, then drag the resize handle. The range is 65%–240%. |
| Open Settings | Double-click the pet, or choose **Settings** from the tray menu. |
| Hide, switch, or quit | Use the system-tray menu. It also offers **Say something**, start at login, and Do Not Disturb. |

Settings also controls the bubble scale (75%–160%), character library, update checks, greeting tasks, and reminder details. The bubble follows the pet and moves away from screen edges when necessary.

## Characters and custom pets

Five characters ship with the app:

| Character | ID | Description |
| --- | --- | --- |
| Danna · Graduation | `danna-graduation` | The default pet in a graduation gown. |
| Danna · Cream Coat | `danna-dress` | A softer everyday Danna look in a cream coat dress. |
| Robben · Tan Jacket | `robben` | A companion for coding, breaks, and quiet moments. |
| Robben · Plaid | `robben-plaid` | A casual plaid-shirt look with a crossbody bag. |
| Danna · Black Dress | `dan-black-dress` | An elegant black-dress look with a mint-green phone. |

To add a pet, open **Settings → Custom pets → Choose folder**. Each direct child folder is treated as one pet when it contains a valid manifest and spritesheet:

```text
my-pet/
  pet.json
  spritesheet.webp
```

```json
{
  "id": "my-pet",
  "displayName": "My Pet",
  "description": "A desktop companion.",
  "spritesheetPath": "spritesheet.webp"
}
```

The player uses a fixed V2 atlas: `1536 × 2288 px`, eight columns, eleven rows, and `192 × 208 px` cells. WebP and PNG spritesheets work. The current player uses rows 0–8 for these visible states; the final two atlas rows remain available in the file format.

| Row | State | Used for |
| --- | --- | --- |
| 0 | `idle` | Standing still |
| 1 | `running-right` | Dragging right |
| 2 | `running-left` | Dragging left |
| 3 | `waving` | Greetings and reminders |
| 4 | `jumping` | A click or a happy moment |
| 5 | `failed` | Resting / sleeping |
| 6 | `waiting` | Waiting |
| 7 | `running` | Busy |
| 8 | `review` | Thinking |

The Settings page includes an action grid for previewing every visible state.

## Greetings, reminders, and updates

The default greeting schedule includes startup, 09:00, 12:00, 18:00, and 21:00. You can enable or remove individual tasks, add scheduled greetings, and use **Say something** for an immediate message.

The default reminder set covers water, stretching, eye breaks, short breaks, and clocking out. Every reminder can be enabled, edited, scheduled or repeated at an interval, paired with an animation, and silenced with Do Not Disturb. Settings are stored locally in Electron's user-data directory.

Release builds check GitHub Releases shortly after launch and let you manually check, download, and install updates in Settings. Development builds leave automatic update checks off by default.

## Development and release

```bash
npm test
npm run test:renderer
npm run build:unpack
```

`npm test` covers the Node test suite. `npm run test:renderer` opens the real Electron renderer and verifies the pet's geometry, hit area, fallback rendering, click, drag, and resize behavior.

To publish a version from a clean branch:

```bash
./scripts/release-publish.sh 0.2.4
```

Pushing a `v*` tag triggers the release workflow. It runs the test suite, creates or updates the GitHub Release, builds a Windows x64 NSIS installer and a macOS zip, then uploads the installers and update manifests.

## Privacy and project history

Our Pets keeps its character choice, window placement, greeting, and reminder settings on the local machine. It does not run a local HTTP API or modify external agent configuration. Update checks contact GitHub Releases only.

This project is a customized fork of [yangbuyiya/desktop-pet](https://github.com/yangbuyiya/desktop-pet). It is released under the [MIT License](LICENSE).
