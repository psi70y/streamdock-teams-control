# Teams Control

Control Microsoft Teams meetings from an **AJAZZ Stream Dock** or an **Elgato Stream Deck**: mute, camera, raise hand, blur, reactions, chat, screen sharing, push-to-talk and more, with keys that show the live meeting state.

> **Unofficial.** Teams Control is an independent project. It is not made, endorsed or supported by Microsoft, Elgato or AJAZZ. "Microsoft Teams" is a trademark of Microsoft; "Stream Deck" is a trademark of Elgato.

## Why this exists

The original Teams plugin for Stream Deck runs inside an embedded web browser. In late 2026 a Teams update started rejecting third-party API connections that come from a browser page: Teams answers `403 Forbidden` and the keys stop working. On AJAZZ Stream Dock, which still runs plugins that way, the official plugin no longer connects at all.

Teams Control is a standalone Node.js plugin. It talks to Teams' local API directly, the same way any other approved device does, so Teams accepts it. It has no npm dependencies.

## Actions

| Action | What it does |
|---|---|
| **Mute** | Mute / unmute. Red when muted. |
| **Camera** | Camera on / off. |
| **Raise hand** | Raise / lower your hand. Amber while raised. |
| **Background blur** | Blur on / off. |
| **Leave** | Leave the meeting. |
| **React: Applause, Laugh, Like, Love, Wow** | Send a reaction. |
| **Chat** | Open / close the meeting chat. |
| **Share screen** | Open the screen-share tray. |
| **Stop sharing** | Stop sharing your screen (only active while you're sharing). |
| **Push to talk** | Hold to unmute, release to mute again. Green "LIVE" while you're unmuted. |
| **Push to mute** | Hold to mute (a cough button), release to unmute again. |
| **Privacy** | Mute and turn your camera off in one press. Never turns them back on. |
| **Hold to leave** | Leaves only after you hold the key for about a second, so a stray tap can't drop the call. |
| **Meeting status** | Display key: in a meeting or not, a **REC** badge while the meeting is recorded, and a badge for unread chat. Press it to bring Teams to the front. |

Keys are greyed out whenever Teams says that action isn't available, for example outside a meeting.

## Requirements

- **New Microsoft Teams** (the "Teams 2" client) on macOS or Windows, signed in with a work or school account.
- **AJAZZ Stream Dock** or **Elgato Stream Deck 6.4 or later**.
- **Node.js 18 or later** for AJAZZ Stream Dock on macOS (the plugin's launcher finds it automatically). Elgato Stream Deck brings its own Node.js runtime.
  - macOS: `brew install node` (with [Homebrew](https://brew.sh)), or the installer from [nodejs.org](https://nodejs.org).
  - Windows: the installer from [nodejs.org](https://nodejs.org) (needed for Stream Dock, harmless for Stream Deck).

## 1. Turn on the Teams third-party app API

Teams only lets devices like this connect when its third-party app API is on.

### Option A: in Teams settings

In Teams, open **Settings → Privacy → Third-party app API → Manage API** and turn on **Enable API**.

If that option is missing or greyed out, use option B. If your organisation has turned the API off by policy, neither option will work; ask your IT admin.

### Option B: in Teams' settings file

Teams keeps its app preferences in a file called `app_settings.json`. The API is controlled by the setting `enable_third_party_devices_service`.

1. **Quit Teams completely.**
   - macOS: Teams menu → Quit Microsoft Teams (or ⌘Q).
   - Windows: right-click the Teams icon in the system tray (bottom-right, near the clock) → **Quit**.
   Teams rewrites this file while it's running, so editing it with Teams open won't stick.

2. **Open the file.**

   **macOS:** the file is at
   `~/Library/Containers/com.microsoft.teams2/Data/Library/Application Support/Microsoft/MSTeams/app_settings.json`

   Open it in TextEdit from Terminal:

   ```bash
   open -e ~/Library/Containers/com.microsoft.teams2/Data/Library/Application\ Support/Microsoft/MSTeams/app_settings.json
   ```

   If macOS asks whether Terminal may access data from other apps, click **Allow**.

   **Windows:** the file is at
   `%LOCALAPPDATA%\Packages\MSTeams_8wekyb3d8bbwe\LocalCache\Microsoft\MSTeams\app_settings.json`

   Open it in Notepad: press **Win + R**, paste the line below, press Enter.

   ```
   notepad "%LOCALAPPDATA%\Packages\MSTeams_8wekyb3d8bbwe\LocalCache\Microsoft\MSTeams\app_settings.json"
   ```

3. **Add or change the setting.** The file is one JSON object: `{ ... }` with `"name": value` pairs separated by commas.
   - If `"enable_third_party_devices_service"` is already there, change its value to `true`.
   - If it isn't, add it straight after the opening `{`, followed by a comma:

   ```json
   {
     "enable_third_party_devices_service": true,
     "open_app_in_background": false,
     ...
   }
   ```

   Make a copy of the file first if you're unsure. Keep the quotes, colon and comma exactly as shown; a broken file makes Teams reset its preferences.

4. **Save, then start Teams again.** Settings → Privacy → Third-party app API should now show the API as enabled.

**To check it's working:** while Teams is running, it listens on port 8124 on your own computer.
- macOS: `lsof -nP -iTCP:8124 -sTCP:LISTEN` should list `MSTeams`.
- Windows (PowerShell): `Get-NetTCPConnection -LocalPort 8124 -State Listen` should return a result.

## 2. Install the plugin manually

### Download

Download this repository (**Code → Download ZIP** on GitHub, then unzip it) or clone it:

```bash
git clone https://github.com/psi70y/streamdock-teams-control.git
```

The plugin is the folder **`com.psi70y.teamscontrol.sdPlugin`**. Copy that whole folder (not just its contents) into your app's plugins folder, as below.

### macOS

1. **Quit** Stream Dock or Stream Deck.
2. Copy `com.psi70y.teamscontrol.sdPlugin` into:
   - **AJAZZ Stream Dock:** `~/Library/Application Support/HotSpot/StreamDock/plugins/`
   - **Elgato Stream Deck:** `~/Library/Application Support/com.elgato.StreamDeck/Plugins/`

   In Finder, use **Go → Go to Folder…** (⇧⌘G) and paste the path.
3. If you downloaded a ZIP, clear macOS's download quarantine and make sure the launcher can run. In Terminal, using the folder you copied to:

   ```bash
   cd ~/Library/Application\ Support/HotSpot/StreamDock/plugins/com.psi70y.teamscontrol.sdPlugin
   ```

   ```bash
   xattr -dr com.apple.quarantine . && chmod +x bin/launch.sh
   ```

   (For Elgato Stream Deck, `cd` into `~/Library/Application Support/com.elgato.StreamDeck/Plugins/com.psi70y.teamscontrol.sdPlugin` instead.)
4. Start Stream Dock or Stream Deck again.

### Windows

1. **Quit** Stream Dock or Stream Deck (right-click its tray icon → Quit).
2. Copy `com.psi70y.teamscontrol.sdPlugin` into:
   - **Elgato Stream Deck:** `%APPDATA%\Elgato\StreamDeck\Plugins\`
   - **AJAZZ Stream Dock:** its `plugins` folder, normally `%APPDATA%\HotSpot\StreamDock\plugins\`

   Paste the path into File Explorer's address bar. If the Stream Dock path doesn't exist on your PC, look for the folder that contains its other `*.sdPlugin` folders.
3. If Windows blocked the downloaded ZIP, right-click the ZIP → **Properties** → tick **Unblock** before unzipping.
4. Start Stream Dock or Stream Deck again.

### Pair with Teams (first time only)

1. Drag the **Teams Control** actions onto your keys. They are in their own **Teams Control** category.
2. Join a Teams meeting (a test meeting with just yourself is fine).
3. Press a Teams Control key, such as **Mute**. Teams shows a request from a new device, **"Teams Control: Stream Deck"**. Click **Allow**.
4. Press the key again. It now works, and the plugin remembers the pairing.

You can see and remove paired devices in Teams under **Settings → Privacy → Third-party app API → Manage API**.

### Moving from the official Teams plugin

Teams Control has its own plugin ID, so it can sit alongside the official plugin without clashing. If the official plugin no longer works for you, remove its folder (`com.microsoft.teams.sdPlugin`) from the plugins folder and place Teams Control keys where the old ones were.

## Troubleshooting

The plugin writes a log to `logs/plugin.log` inside its own folder.

| Symptom | Cause and fix |
|---|---|
| All keys greyed out, Meeting status shows **TEAMS OFFLINE** | Teams isn't running, or its API is off. See [step 1](#1-turn-on-the-teams-third-party-app-api). |
| Keys greyed out even in a meeting | Not paired yet. Press a key during a meeting and click **Allow** in Teams. |
| Log says `token rejected; clearing it` | Teams forgot the pairing (this can happen after a Teams update). Press a key in a meeting and **Allow** again. |
| No log file at all on macOS | Node.js wasn't found. Install it (see Requirements), then restart Stream Dock. |
| Keys do nothing on Stream Dock for Windows | Make sure Node.js is installed and on your PATH, then restart Stream Dock. |

## How it works

- Teams' third-party API is a WebSocket server at `ws://127.0.0.1:8124`, reachable only from your own computer.
- Each key press sends a small JSON message such as `{"action":"toggle-mute","parameters":{},"requestId":1}`.
- Teams pushes `meetingUpdate` messages back (muted, camera on, recording, and so on), and the plugin redraws the keys from them.
- The first approved connection receives a pairing token. It's stored in `teams-token.json` inside the plugin folder and sent on later connections.

## Development

- `com.psi70y.teamscontrol.sdPlugin/bin/plugin.js`: the whole plugin, one dependency-free file.
- `com.psi70y.teamscontrol.sdPlugin/bin/launch.sh`: macOS launcher that finds Node.js for apps started from the Dock.

Tested on macOS with AJAZZ Stream Dock (AKP03E) and new Teams. Windows and Elgato Stream Deck follow the same plugin format but haven't been tested yet; reports are welcome in [Issues](https://github.com/psi70y/streamdock-teams-control/issues).

## License

[MIT](LICENSE)
