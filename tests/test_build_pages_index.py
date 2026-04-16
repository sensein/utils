from __future__ import annotations

import importlib.util
import json
from pathlib import Path


def load_builder_module() -> object:
    module_path = Path(__file__).resolve().parents[1] / "scripts" / "build_pages_index.py"
    spec = importlib.util.spec_from_file_location("build_pages_index", module_path)
    module = importlib.util.module_from_spec(spec)
    assert spec is not None and spec.loader is not None
    spec.loader.exec_module(module)
    return module


def test_build_pages_index_creates_catalog_and_copies_live_utility(tmp_path: Path) -> None:
    module = load_builder_module()
    repo_root = tmp_path / "repo"
    utility_dir = repo_root / "utilities" / "demo-tool"
    utility_dir.mkdir(parents=True)
    (utility_dir / "README.md").write_text("# Demo Tool\n\nSmall demo utility.\n", encoding="utf-8")
    (utility_dir / "utility.json").write_text(
        json.dumps(
            {
                "title": "Demo Tool",
                "summary": "Small demo utility.",
                "live_page": "demo.html",
            }
        ),
        encoding="utf-8",
    )
    (utility_dir / "demo.html").write_text("<!doctype html><title>demo</title>", encoding="utf-8")

    output_dir = repo_root / "site"
    utilities = module.build_site(
        repo_root=repo_root,
        output_dir=output_dir,
        repo_url="https://github.com/sensein/utils",
        pages_base_url="https://sensein.github.io/utils/",
        branch="main",
    )

    assert len(utilities) == 1
    assert utilities[0]["live_url"] == "https://sensein.github.io/utils/utilities/demo-tool/demo.html"
    assert (output_dir / "utilities" / "demo-tool" / "demo.html").exists()

    index_html = (output_dir / "index.html").read_text(encoding="utf-8")
    assert "Demo Tool" in index_html
    assert "Live exploration" in index_html
    assert "https://github.com/sensein/utils/tree/main/utilities/demo-tool" in index_html
