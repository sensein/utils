from __future__ import annotations

import argparse
import html
import json
import shutil
from pathlib import Path


def load_metadata(utility_dir: Path) -> dict[str, str]:
    metadata_path = utility_dir / "utility.json"
    data: dict[str, str] = {}
    if metadata_path.exists():
        data = json.loads(metadata_path.read_text(encoding="utf-8"))
    readme_path = utility_dir / "README.md"
    summary = data.get("summary", "").strip()
    if not summary and readme_path.exists():
        lines = [
            line.strip()
            for line in readme_path.read_text(encoding="utf-8").splitlines()
            if line.strip() and not line.startswith("#")
        ]
        if lines:
            summary = lines[0]
    return {
        "slug": utility_dir.name,
        "title": data.get("title", utility_dir.name.replace("-", " ").title()),
        "summary": summary or "No summary provided yet.",
        "live_page": data.get("live_page", "").strip(),
    }


def discover_utilities(
    utilities_root: Path,
    repo_url: str,
    pages_base_url: str,
    branch: str,
) -> list[dict[str, str]]:
    utilities: list[dict[str, str]] = []
    for utility_dir in sorted(path for path in utilities_root.iterdir() if path.is_dir()):
        metadata = load_metadata(utility_dir)
        metadata["repo_url"] = f"{repo_url}/tree/{branch}/utilities/{metadata['slug']}"
        live_page = metadata.get("live_page", "")
        if live_page:
            candidate = utility_dir / live_page
            if candidate.exists():
                metadata["live_url"] = f"{pages_base_url}utilities/{metadata['slug']}/{live_page}"
            else:
                metadata["live_url"] = ""
        else:
            metadata["live_url"] = ""
        utilities.append(metadata)
    return utilities


def render_index(utilities: list[dict[str, str]], repo_url: str) -> str:
    cards = []
    for utility in utilities:
        title = html.escape(utility["title"])
        summary = html.escape(utility["summary"])
        slug = html.escape(utility["slug"])
        repo_link = html.escape(utility["repo_url"])
        live_url = utility.get("live_url", "")
        links = [
            f'<a href="{repo_link}">Repository folder</a>',
        ]
        if live_url:
            links.insert(0, f'<a href="{html.escape(live_url)}">Live exploration</a>')
        links_markup = " · ".join(links)
        cards.append(
            f"""
            <article class="card">
              <div class="eyebrow">{slug}</div>
              <h2>{title}</h2>
              <p>{summary}</p>
              <div class="links">{links_markup}</div>
            </article>
            """.strip()
        )

    cards_markup = "\n".join(cards) if cards else "<p>No utilities found.</p>"
    return f"""<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>SenseIn Utils</title>
    <style>
      :root {{
        color-scheme: light;
        --bg: #f4efe6;
        --paper: #fffaf2;
        --ink: #172126;
        --muted: #53636a;
        --accent: #b85c38;
        --border: rgba(23, 33, 38, 0.14);
      }}
      * {{
        box-sizing: border-box;
      }}
      body {{
        margin: 0;
        font-family: "Avenir Next", "Segoe UI", sans-serif;
        background:
          radial-gradient(circle at top left, rgba(184, 92, 56, 0.16), transparent 34%),
          linear-gradient(180deg, #f9f2e8 0%, var(--bg) 100%);
        color: var(--ink);
      }}
      main {{
        width: min(1120px, calc(100vw - 32px));
        margin: 0 auto;
        padding: 48px 0 72px;
      }}
      .hero {{
        margin-bottom: 32px;
      }}
      h1 {{
        margin: 0 0 12px;
        font-size: clamp(2.4rem, 5vw, 4rem);
        line-height: 0.95;
      }}
      .hero p {{
        width: min(64ch, 100%);
        color: var(--muted);
        font-size: 1.05rem;
        line-height: 1.55;
      }}
      .hero a {{
        color: var(--accent);
      }}
      .grid {{
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
        gap: 18px;
      }}
      .card {{
        background: color-mix(in srgb, var(--paper) 90%, white 10%);
        border: 1px solid var(--border);
        border-radius: 22px;
        padding: 22px;
        box-shadow: 0 20px 48px rgba(23, 33, 38, 0.08);
      }}
      .eyebrow {{
        text-transform: uppercase;
        letter-spacing: 0.16em;
        font-size: 0.72rem;
        color: var(--accent);
        margin-bottom: 10px;
      }}
      .card h2 {{
        margin: 0 0 10px;
        font-size: 1.2rem;
      }}
      .card p {{
        margin: 0 0 16px;
        color: var(--muted);
        line-height: 1.5;
      }}
      .links {{
        display: flex;
        flex-wrap: wrap;
        gap: 10px;
        color: var(--muted);
      }}
      .links a {{
        color: var(--accent);
        text-decoration: none;
        font-weight: 600;
      }}
      .links a:hover {{
        text-decoration: underline;
      }}
    </style>
  </head>
  <body>
    <main>
      <section class="hero">
        <h1>SenseIn Utils</h1>
        <p>
          A small catalog of reusable utilities and browser explorations. Source lives in
          <a href="{html.escape(repo_url)}">{html.escape(repo_url)}</a>, and any utility with a
          declared live page is linked directly from this index.
        </p>
      </section>
      <section class="grid">
        {cards_markup}
      </section>
    </main>
  </body>
</html>
"""


def build_site(
    repo_root: Path,
    output_dir: Path,
    repo_url: str,
    pages_base_url: str,
    branch: str,
) -> list[dict[str, str]]:
    utilities_root = repo_root / "utilities"
    output_dir.mkdir(parents=True, exist_ok=True)
    utilities_output = output_dir / "utilities"
    if utilities_output.exists():
        shutil.rmtree(utilities_output)
    utilities_output.mkdir(parents=True, exist_ok=True)

    utilities = discover_utilities(
        utilities_root,
        repo_url=repo_url,
        pages_base_url=pages_base_url,
        branch=branch,
    )

    for utility in utilities:
        source_dir = utilities_root / utility["slug"]
        destination_dir = utilities_output / utility["slug"]
        shutil.copytree(source_dir, destination_dir, dirs_exist_ok=True)

    index_html = render_index(utilities, repo_url=repo_url)
    (output_dir / "index.html").write_text(index_html, encoding="utf-8")
    return utilities


def main() -> None:
    parser = argparse.ArgumentParser(description="Build the GitHub Pages catalog for utilities.")
    parser.add_argument("--repo-root", default=Path(__file__).resolve().parents[1], type=Path)
    parser.add_argument("--output", default="site", type=Path)
    parser.add_argument("--repo-url", default="https://github.com/sensein/utils")
    parser.add_argument("--pages-base-url", default="https://sensein.github.io/utils/")
    parser.add_argument("--branch", default="main")
    args = parser.parse_args()

    output_dir = args.output
    if not output_dir.is_absolute():
        output_dir = args.repo_root / output_dir

    build_site(
        repo_root=args.repo_root,
        output_dir=output_dir,
        repo_url=args.repo_url.rstrip("/"),
        pages_base_url=args.pages_base_url.rstrip("/") + "/",
        branch=args.branch,
    )


if __name__ == "__main__":
    main()
