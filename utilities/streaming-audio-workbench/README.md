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
