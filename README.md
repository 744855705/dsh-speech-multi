# dsh-speech-multi

Four local speech-to-text models behind one plugin, each decoded in the window it handles best.
Audio never leaves the machine, and a model is downloaded only when you prepare that model.

## Models

Priority is the measured order, best first. The first one is the default selection.

| Priority | Provider id | Model | Window | Shortest | Hard cap |
|---|---|---|---|---|---|
| 1 | `multi-xasr` | X-ASR zh-en (int8, punctuation) | 34 s | 20 s | 38 s |
| 2 | `multi-funasr` | Fun-ASR-Nano (int8, 1024 context) | 20 s | 6 s | 30 s |
| 3 | `multi-qwen3` | Qwen3-ASR 0.6B (int8) | 40 s | 8 s | 100 s |
| 4 | `multi-firered` | FireRedASR2-AED (int8) | 40 s | 8 s | 55 s |

Each model is a separate provider, so an unused model is never downloaded, and each one runs in
its own worker process with its own preparation state and idle reclaimer.

**Window** is the recording length that measured best, not the largest the model survives.
**Hard cap** is the length past which output becomes unusable; for X-ASR it terminates the
process, so the plan is rejected before decoding.

## Install from GitHub

This package is not published to npm, but it installs straight from the repository. In
**Settings → Plugins → Add plugin**, enter:

```
github:744855705/dsh-speech-multi
```

That is the same form the previous FireRed plugin used. `lib/` is committed and there is no
build step, so the tarball works as-is. Installing requires Node 22 or newer, because the worker
uses `zlib` zstd decompression and WebAssembly.

The manifest declares `engines.dsh: >=0.2.2-rc.1 <=0.5.0`, the same floor the previous FireRed
plugin used. This plugin calls a subset of that plugin's DSH surface — it registers providers and
drives `subprocess`, but no longer observes the speech catalog — so it does not need a newer
release. Outside the range, installation is refused with a readable reason instead of failing at
runtime.

The full URL and a plain git checkout work too, if your build prefers them:

```
git+https://github.com/744855705/dsh-speech-multi.git
```

```bash
mkdir -p ~/plugins && cd ~/plugins
git clone git@github.com:744855705/dsh-speech-multi.git
# then Add plugin and pick ~/plugins/dsh-speech-multi
```

A `github:` install pins a tarball per install, so updating means adding it again; the checkout
form updates with `git pull` plus a reload.

### After installing

1. Restart DSH so the four providers are registered.
2. Pick a recognizer in **Settings → Voice**, for example `multi-xasr`.
3. Press **Prepare** for that model. It downloads from the release pinned in
   `runtime/assets.json` and verifies every archive against its SHA-256 before using it.

Nothing is downloaded until you prepare a model, so installing all four providers costs no disk
or bandwidth by itself.

### Removing the plugin

Disable or remove the bundle, then delete the model cache if you no longer need it:

```bash
rm -rf "${DSH_HOME:-$HOME/.dsh}/speech-to-text/multi"
```

The plugin never writes the profile's `cordis.patch.yml`. Its selection lock intercepts reads
only — it reports the locked provider from `snapshot()` and routes `resolve()` to it — because
persisting a selection through `configure()` outlives an uninstall and leaves the profile
pointing at a provider that no longer exists. If you hand-write a `defaultProvider` for this
plugin in your own profile patch, remember to remove that line when you uninstall it.

## Configuration

| Key | Default | Purpose |
|---|---|---|
| `enabledModels` | all four | Models to register, in registration order |
| `dataRoot` | `~/.dsh/speech-to-text/multi` | Verified models and the archive cache |
| `releaseBaseUrl` | placeholder | Release serving the archives listed in `runtime/assets.json` |
| `lockFile` | `~/.dsh/speech-multi-lock.json` | Selection lock, read-only for the plugin |
| `deviceTier` | `auto` | `light` / `standard` / `large`, or derived from total memory |
| `threads` | `8` | CPU threads per worker |
| `maxRecordingSeconds` | tier default | Overrides the tier ceiling |
| `idleTimeoutMs` | `14400000` | Four hours before an idle worker is reclaimed |

`releaseBaseUrl` must be set to your own release before any download can succeed; the shipped
value is a placeholder and startup rejects it.

## Selection lock

`~/.dsh/speech-multi-lock.json`, read once at activation. A missing or malformed file leaves the
plugin unlocked rather than failing to start.

```json
{
  "schema": 2,
  "mode": "hard",
  "modelId": "multi-xasr",
  "allow": ["multi-xasr", "multi-funasr", "multi-qwen3", "multi-firered"]
}
```

- `soft` reports `modelId` from `snapshot()` and routes `resolve()` to it.
- `hard` also rejects selections outside `allow`.
- Omitting `allow` permits every model this plugin registers.

The lock never calls `configure()`. That matters: `configure()` persists the selection through
the settings service into the profile's `cordis.patch.yml`, so a lock that reasserted itself
that way would outlive its own uninstall and leave the profile pointing at a provider that no
longer exists — which disables speech input entirely. Intercepting reads only gives the same
behaviour with no disk write, so removing the plugin restores whatever was selected before.

## Device tiers

| Tier | Memory | Models | Recording ceiling |
|---|---|---|---|
| `light` | under 8 GiB | X-ASR, Fun-ASR-Nano | 60 s |
| `standard` | under 16 GiB | + Qwen3-ASR 0.6B | 120 s |
| `large` | 16 GiB and above | + FireRedASR2-AED | 300 s |

The split follows measured peak memory at each ceiling rather than model size: at 60 s Qwen3
peaks near 3.0 GB and FireRed near 3.5 GB, and at 120 s they are 4.3 GB and 3.6 GB. Qwen3 is
cheaper where the mid tier lives, so it opens there and FireRed opens on the top tier. The top
tier keeps a five-minute ceiling because a small model on a large machine is the cheapest way to
transcribe a long recording.

A model the tier cannot run is skipped with a warning; recordings past the ceiling are rejected
before decoding instead of exhausting memory.

## Transcript inspection

A decode that produces no text, a leaked control token (`<sil>`, `<unk>`, `language`), far fewer
characters than the recording warrants, or a repeated passage is rejected and reported instead of
returned. There is no automatic retry: a result that fails inspection is a recording to redo, not
a model to switch.

## Voice activity detection

Speech regions come from two neural detectors in a chain, both driven by the same Kaldi-style
80-bin log-mel frontend in `src/vad/`:

1. **FSMN-VAD** is tried first. It is a DFSMN over LFR-stacked frames and threads four recurrent
   caches through the utterance.
2. **FireRedVAD** is tried when the first model is missing or throws. It is stateless, so it needs
   only its own normalisation on top of the shared frontend.
3. **Energy detection** is the last resort, used when neither model is installed.

Both networks were trained on 16 kHz mono audio whose samples carry int16 scale rather than the
`[-1, 1]` range the WAV decoder returns; the frontend applies that scale, because without it the
models keep returning plausible-looking scores that mean nothing.

The two detectors disagree about what their score means, which is why each declares its own
polarity: FSMN reports a silence score, FireRedVAD a speech score.

## Known gaps in this build

- Both neural detectors are trained on 16 kHz mono audio. A recording at another rate falls back
  to the energy detector rather than being resampled.
- The VAD thresholds are fixed in configuration and are not tuned per microphone.

## License

Apache-2.0. Redistributed model weights and their upstream licenses are listed in
`THIRD_PARTY_NOTICES.md`.
