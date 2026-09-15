"""Verify the real distributable and its relative links survive catalog packaging."""
from pathlib import Path
from test_build_pages_index import load_builder_module


def test_video_workbench_is_published_with_its_assets(tmp_path: Path) -> None:
    root = Path(__file__).resolve().parents[1]
    module = load_builder_module()
    entries = module.build_site(
        repo_root=root, output_dir=tmp_path / "site",
        repo_url="https://github.com/sensein/utils",
        pages_base_url="https://sensein.github.io/utils/", branch="main",
    )
    video = next(e for e in entries if e["slug"] == "video-workbench")
    assert video["live_url"].endswith("/utils/utilities/video-workbench/index.html")
    assert any(e["slug"] == "streaming-audio-workbench" for e in entries)
    packaged = tmp_path / "site" / "utilities" / "video-workbench"
    for name in ["index.html", "workbench.css", "workbench.js", "metrics.mjs", "models.js", "inference.worker.js", "audio.worker.js", "live.mjs", "overlay-recording.js", "timeline.mjs", "audio.mjs"]:
        assert (packaged / name).read_bytes() == (root / "utilities" / "video-workbench" / name).read_bytes()
    html = (packaged / "index.html").read_text()
    assert (packaged / "../../index.html").resolve().is_file()
    assert (packaged / "../streaming-audio-workbench/streaming_audio_workbench.html").resolve().is_file()
    assert 'src="http' not in html
