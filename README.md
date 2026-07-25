# Codex AirPod

*You can just ask for things*

---

Press your Airpods to mute/unmute the mic in ChatGPT/Codex Voice on macOS.

## Set up

```sh
git clone https://github.com/scf4/codex-airpod.git
cd codex-airpod
```

Fully quit ChatGPT, then run:

```sh
npm run launch
```

Start Codex Voice and use the configured AirPods mute gesture.

## Disable Codex Airpod

Quit ChatGPT and open `/Applications/ChatGPT.app` normally.

Nothing is installed or written into the app bundle, Login Items,
LaunchAgents, or system configuration. The shim applies only to ChatGPT
started by `npm run launch`.

## Development

```sh
npm test
npm run check
```

The runtime has no npm dependencies. It uses the `objc-js` bridge already
bundled and signed inside ChatGPT.
