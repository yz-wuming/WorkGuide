"""Unit tests for on-upload zip extraction in the uploads router.

Covers safe flattening (no traversal/symlink escapes), directory skipping,
encrypted-members rejection, and per-member/aggregate size caps.
"""

from __future__ import annotations

import zipfile

from app.gateway.routers.uploads import _extract_zip_to_uploads


def _write_zip(path, entries: dict[str, bytes], *, symlink: set[str] | None = None):
    symlink = symlink or set()
    with zipfile.ZipFile(str(path), "w") as zf:
        for name, data in entries.items():
            zi = zipfile.ZipInfo(name)
            if name in symlink:
                zi.external_attr = (0o120000 << 16) | 0o777
            zf.writestr(zi, data)


def _mark_encrypted(path):
    """Flip the encrypted flag bit in a real archive's headers.

    Single-member archives only. Sets general-purpose bit 0x1 in both the local
    file header (offset 6) and the first central-directory entry — exactly what
    an encrypted zip produced by external tools carries on disk.
    """
    from pathlib import Path

    data = bytearray(Path(path).read_bytes())
    lflag = int.from_bytes(data[6:8], "little") | 0x1
    data[6:8] = lflag.to_bytes(2, "little")
    eocd = data.rfind(b"PK\x05\x06")
    cd_offset = int.from_bytes(data[eocd + 16 : eocd + 20], "little")
    cflag = int.from_bytes(data[cd_offset + 8 : cd_offset + 10], "little") | 0x1
    data[cd_offset + 8 : cd_offset + 10] = cflag.to_bytes(2, "little")
    Path(path).write_bytes(data)


def _extract(zip_path, uploads_dir, *, max_single_size=10**6, max_total=10**6):
    return _extract_zip_to_uploads(
        zip_path,
        uploads_dir=uploads_dir,
        sandbox_uploads=str(uploads_dir),
        thread_id="t-1",
        seen_filenames=set(),
        max_single_file_size=max_single_size,
        max_total_size=max_total,
        total_size=0,
    )


def test_extracts_members_and_skips_directories(tmp_path):
    zip_path = tmp_path / "p.zip"
    _write_zip(
        zip_path,
        {"02_students.csv": b"name\nAlice\n", "05_bug_report.md": b"# Bug\n", "sub/03_events.json": b"[]"},
    )
    entries, total = _extract(zip_path, tmp_path)
    names = {e["filename"] for e in entries}
    # directory entry "sub/" dropped; inner file flattened to basename
    assert names == {"02_students.csv", "05_bug_report.md", "03_events.json"}
    assert (tmp_path / "03_events.json").is_file()
    assert total == sum(e["size"] for e in entries)


def test_flattens_unsafe_paths_staying_inside_uploads_dir(tmp_path):
    zip_path = tmp_path / "bad.zip"
    _write_zip(zip_path, {"../evil.txt": b"x", "/etc/passwd": b"y", "ok.txt": b"z"})
    entries, _ = _extract(zip_path, tmp_path)
    for e in entries:
        # every extracted destination must be a direct child of uploads_dir
        assert (tmp_path / e["filename"]).resolve().parent == tmp_path.resolve()
    names = {e["filename"] for e in entries}
    assert names == {"evil.txt", "passwd", "ok.txt"}


def test_skips_symlink_members(tmp_path):
    zip_path = tmp_path / "s.zip"
    _write_zip(zip_path, {"link": b"", "real.txt": b"hi"}, symlink={"link"})
    entries, _ = _extract(zip_path, tmp_path)
    assert [e["filename"] for e in entries] == ["real.txt"]


def test_rejects_encrypted_archive(tmp_path):
    zip_path = tmp_path / "enc.zip"
    _write_zip(zip_path, {"a.txt": b"secret"})
    _mark_encrypted(zip_path)
    entries, _ = _extract(zip_path, tmp_path)
    assert entries == []


def test_enforces_per_member_and_aggregate_size_caps(tmp_path):
    # per-member cap: big.bin (500) skipped; small.txt survives
    zip_path = tmp_path / "big.zip"
    _write_zip(zip_path, {"big.bin": b"x" * 500, "small.txt": b"ok"})
    entries, _ = _extract(zip_path, tmp_path, max_single_size=100)
    assert [e["filename"] for e in entries] == ["small.txt"]

    # aggregate cap with small member first: it fits, then big breaks the budget
    zip_order = tmp_path / "agg.zip"
    _write_zip(zip_order, {"small.txt": b"ok", "big.bin": b"x" * 500})
    entries2, _ = _extract(zip_order, tmp_path, max_total=300)
    assert [e["filename"] for e in entries2] == ["small.txt"]