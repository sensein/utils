# Streaming Audio Workbench

Single-file browser workbench for streaming microphone analysis.

## Features

- live microphone capture with pause and reset controls
- persistent in-memory history with panning backward and forward
- selectable analysis rate at 8, 10, or 16 kHz
- waveform with a low-passed Hilbert envelope overlay
- spectrogram with optional preemphasis
- spectrum and MFCC / CPP analysis for the selected slice
- WAV export and PNG snapshot export
- capture provenance details in the page for browser, OS, and microphone

## Files

- `streaming_audio_workbench.html`: distributable single-file page
- `utility.json`: metadata used by the catalog generator

## Usage

Open the HTML page in a modern browser. For microphone access, `http://localhost` is often more reliable than `file://`.

If you publish this repository with GitHub Pages, the catalog page will expose a direct live link to this utility.

## Update Checklist

Use this checklist for every shipped update to the workbench:

- [ ] Make the change in the source page at `shbt205-speech-foundations/assets/streaming_audio_workbench.html`
- [ ] Bump the calver in the page title badge and `buildVersion` constant using `yy.mm.dd-hhmmss`
- [ ] If behavior changed, update `shbt205-speech-foundations/tests/test_streaming_audio_workbench_page.py`
- [ ] If the design or interaction model changed, update `shbt205-speech-foundations/analysis/streaming_audio_workbench_design.md`
- [ ] Run `uv run pytest tests/test_streaming_audio_workbench_page.py tests/test_hilbert_filterbank.py` in `shbt205-speech-foundations`
- [ ] Run `node --check` on the extracted inline script from the source HTML page
- [ ] Copy the updated source page into `utilities/streaming-audio-workbench/streaming_audio_workbench.html`
- [ ] If layout changed, capture a fresh Playwright screenshot to verify the packaged page
- [ ] Commit and push the `utils` repo after the packaged copy is in sync

## Future agent prompt

Use this prompt when handing the utility to a future coding agent:

```text
Continue work on the single-file browser utility at `utilities/streaming-audio-workbench/streaming_audio_workbench.html`.

This page is a distributable live microphone analysis workbench and should remain easy to ship as a standalone HTML file.

Current feature set:
- live microphone streaming with pause/resume
- persistent in-memory audio history so older audio can be revisited after it scrolls out of view
- pan controls plus a viewport slider
- full wipe reset that stops capture, clears memory, and restores defaults
- WAV export and PNG snapshot export
- analysis-rate selection at 8, 10, or 16 kHz
- waveform with a low-passed Hilbert-envelope overlay
- fixed-window spectrogram with optional preemphasis
- draggable selection window on the waveform that controls only the spectrum and MFCC / CPP panels
- waveform autoscale toggle
- CPP location marked in the cepstral view
- browser, OS, and microphone metadata shown in the status area

Important implementation details from prior work:
- the Hilbert envelope should be computed as the fullband analytic magnitude `|x + jH{x}|`, then low-passed at 50 Hz, without the earlier subband approach
- the spectrogram STFT window is fixed and should not change when the spectrum/MFCC selection width changes
- the spectrum and MFCC panels are driven by the movable waveform selection
- CPP was stabilized by estimating a plausible pitch period from normalized autocorrelation and then searching for the cepstral peak near that period
- selection drag math uses the actual visible audio span so the window can move across the full viewport
- PNG export first tries DOM rasterization and then falls back to display capture when canvases are tainted

Working constraints:
- preserve the single-file distributable nature of this HTML page whenever possible
- keep the landscape-friendly left control sidebar layout
- if behavior changes, update the lightweight contract test in `tests/test_streaming_audio_workbench_page.py` in the source project where this page originated
- bump the calver on every shipped update using `yy.mm.dd-hhmmss`
- prefer concise inline documentation and avoid introducing unnecessary external dependencies
```
