# Codex AirPods

*You can just ask for things*

---

Press your AirPods to mute/unmute the mic in ChatGPT/Codex Voice on macOS.

## Set up

```sh
git clone https://github.com/scf4/codex-airpod.git
cd codex-airpod
```

Fully quit ChatGPT before using the Terminal command. Then either run
`npm run launch` in Terminal, or double-click `launch.command` in Finder.

Start Codex Voice and use the configured AirPods mute gesture.

## Disable Codex AirPods

Quit ChatGPT and open `/Applications/ChatGPT.app` normally.

Nothing is installed or written into the app bundle, Login Items,
LaunchAgents, or system configuration. The shim applies only to ChatGPT
started by either launch option.

## Development

```sh
npm test
npm run check
```

The runtime has no npm dependencies. It uses the `objc-js` bridge already
bundled and signed inside ChatGPT.

Licensed under the [MIT License](LICENSE).
