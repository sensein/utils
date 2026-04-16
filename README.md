# sensein/utils

Small, self-contained utilities that are easy to browse in the repository and easy to publish through GitHub Pages.

## Repository layout

- `utilities/<slug>/`: one utility per folder
- `utilities/<slug>/README.md`: purpose, usage, and any implementation notes
- `utilities/<slug>/utility.json`: metadata used to build the catalog page
- `scripts/build_pages_index.py`: generates the GitHub Pages summary site
- `.github/workflows/pages.yml`: deploys the generated catalog to GitHub Pages

## Add a new utility

1. Create a new folder under `utilities/` with a short, stable slug.
2. Add a `README.md` describing what the utility does, how to run it, and any constraints.
3. Add a `utility.json` file with at least:

```json
{
  "title": "Utility title",
  "summary": "One-paragraph summary for the catalog page.",
  "live_page": "index.html"
}
```

4. Put the distributable files for that utility in the same folder. If the utility has a browser demo or live exploration page, point `live_page` at the HTML entry file relative to the utility folder.
5. Rebuild the catalog locally:

```bash
python scripts/build_pages_index.py --output site
```

6. Run the lightweight regression test:

```bash
uv run pytest
```

## How the catalog works

- Every folder under `utilities/` is listed on the summary page.
- If `utility.json` includes `live_page`, the generator copies that utility folder into the Pages artifact and adds a live link.
- The catalog also links back to the repository folder so source and live exploration stay connected.

## Current utilities

- `streaming-audio-workbench`: a single-file microphone analysis page for waveform, spectrogram, spectrum, MFCC, and CPP exploration.
