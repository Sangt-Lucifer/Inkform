# Writes one export package without ever following a path a second time.
#
# Called by werkstatt/export.mjs (python3 from the macOS Command Line Tools, standard library
# only). Node has no functions that work relative to an open folder; Python does (dir_fd). Every
# folder is opened once with O_NOFOLLOW | O_DIRECTORY, every file is created with
# O_CREAT | O_EXCL | O_NOFOLLOW inside such an open folder, and the finished package gets its final
# name with renameatx_np(RENAME_EXCL), which fails instead of replacing anything. So no write can be
# redirected by swapping a path for a link, no existing file or folder is ever replaced, and
# cleaning up only touches what this run created.
#
# Protocol: one JSON object on stdin (first line), then "go" or "abort" on a second line.
#   stdout line 1: {"written": true} or {"error": "..."}      (package written under the hidden name)
#   stdout line 2: {"ok": true, "zip": ..., "warning": ...} or {"error": "..."}
import base64
import ctypes
import errno
import hashlib
import io
import json
import os
import re
import sys
import time
import zipfile

DIR = os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW
NEW_FILE = os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW
RENAME_EXCL = 0x00000004
libc = ctypes.CDLL(None, use_errno=True)
# Entries an export folder may hold: packages, their ZIPs, hidden work names of this tool.
ALLOWED_IN_PARENT = re.compile(r"^(inkform-[a-z0-9-]+-\d+\.\d+\.\d+-p\d+-\d{4}-\d{2}-\d{2}(\.zip)?|\.inkform-[0-9a-f]{32}\.(tmp|zip\.tmp)|\.DS_Store)$")


def say(obj):
    sys.stdout.write(json.dumps(obj) + "\n")
    sys.stdout.flush()


def open_real(real):
    # Walks the real path from / with O_NOFOLLOW: if any part is (now) a link, this fails.
    fd = os.open("/", DIR)
    for part in [p for p in real.split("/") if p]:
        nxt = os.open(part, DIR, dir_fd=fd)
        os.close(fd)
        fd = nxt
    return fd


def rename_excl(src_fd, src, dst_fd, dst):
    if libc.renameatx_np(src_fd, src.encode(), dst_fd, dst.encode(), RENAME_EXCL) != 0:
        e = ctypes.get_errno()
        raise OSError(e, os.strerror(e), dst)


def same_entry(dir_fd, name, ino):
    try:
        return os.stat(name, dir_fd=dir_fd, follow_symlinks=False).st_ino == ino
    except OSError:
        return False


def main():
    job = json.loads(sys.stdin.readline())
    started = job["started"]
    parent_fd = open_real(job["parent"])
    st = os.fstat(parent_fd)
    if (st.st_ino, st.st_dev) != (job["parentIno"], job["parentDev"]):
        return say({"error": "Der Exportordner ist nicht mehr derselbe."})
    foreign = [n for n in os.listdir(parent_fd) if not ALLOWED_IN_PARENT.match(n)]
    if foreign:
        return say({"error": "Der Exportordner enthält fremde Einträge (" + ", ".join(sorted(foreign)[:5]) + "). Dort wird nichts geschrieben."})

    created_files = []  # (dir_fd, name)
    created_dirs = []  # (parent_fd, name, fd, ino)
    staging = job["staging"]

    def fresh_dir(pfd, name):
        os.mkdir(name, 0o700, dir_fd=pfd)
        fd = os.open(name, DIR, dir_fd=pfd)
        s = os.fstat(fd)
        # Must be the folder just made: new, empty, ours. A folder swapped in meanwhile that holds
        # anything, or existed before this run, is never written to.
        if os.listdir(fd) or s.st_uid != os.getuid() or getattr(s, "st_birthtime", started) < started - 0.5 or not same_entry(pfd, name, s.st_ino):
            os.close(fd)
            raise OSError(errno.EEXIST, "Ordner wurde ausgetauscht", name)
        created_dirs.append((pfd, name, fd, s.st_ino))
        return fd

    def cleanup():
        for pfd, name, fd, ino in created_dirs:
            try:
                os.fchmod(fd, 0o700)
            except OSError:
                pass
        for dfd, name in reversed(created_files):
            try:
                os.unlink(name, dir_fd=dfd)
            except OSError:
                pass
        for pfd, name, fd, ino in reversed(created_dirs):
            try:
                if same_entry(pfd, name, ino):
                    os.rmdir(name, dir_fd=pfd)
            except OSError:
                pass

    try:
        pkg_fd = fresh_dir(parent_fd, staging)
        pkg_ino = created_dirs[-1][3]
        dirs = {"": pkg_fd}
        for rel, b64 in job["files"]:
            data = base64.b64decode(b64)
            parts = rel.split("/")
            here = ""
            for part in parts[:-1]:
                sub = (here + "/" + part) if here else part
                if sub not in dirs:
                    dirs[sub] = fresh_dir(dirs[here], part)
                here = sub
            dfd = dirs[here]
            fd = os.open(parts[-1], NEW_FILE, 0o444, dir_fd=dfd)
            created_files.append((dfd, parts[-1]))
            with os.fdopen(fd, "wb") as f:
                f.write(data)
                f.flush()
                os.fsync(f.fileno())
            rfd = os.open(parts[-1], os.O_RDONLY | os.O_NOFOLLOW, dir_fd=dfd)
            with os.fdopen(rfd, "rb") as f:
                if hashlib.sha256(f.read()).hexdigest() != hashlib.sha256(data).hexdigest():
                    raise OSError(errno.EIO, "Prüfsumme stimmt nicht", rel)
        for sub, fd in sorted(dirs.items(), key=lambda kv: -kv[0].count("/")):
            if sub:
                os.fchmod(fd, 0o555)
    except Exception as e:
        cleanup()
        return say({"error": "Schreiben fehlgeschlagen: " + str(e)})

    say({"written": True})
    answer = sys.stdin.readline().strip()
    try:
        if answer != "go":
            raise OSError(errno.ECANCELED, "abgebrochen: " + (answer or "keine Antwort"))
        # Still the same place, and still our folder under the hidden name?
        again = open_real(job["parent"])
        same_place = os.fstat(again).st_ino == os.fstat(parent_fd).st_ino
        os.close(again)
        if not same_place or not same_entry(parent_fd, staging, pkg_ino):
            raise OSError(errno.ESTALE, "Der Exportordner hat sich während des Exports verändert")
        rename_excl(parent_fd, staging, parent_fd, job["final"])
    except Exception as e:
        cleanup()
        if isinstance(e, OSError) and e.errno == errno.EEXIST:
            return say({"error": job["final"] + " gibt es inzwischen (EEXIST). Nichts überschrieben."})
        return say({"error": str(e)})
    os.fchmod(pkg_fd, 0o555)

    result = {"ok": True, "zip": None, "warning": None}
    if job.get("zip"):
        # Built in memory from the very same bytes, written exclusively, renamed exclusively.
        buf = io.BytesIO()
        with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
            for rel, b64 in job["files"]:
                info = zipfile.ZipInfo(job["final"] + "/" + rel, date_time=time.localtime(started)[:6])
                info.external_attr = 0o444 << 16
                info.compress_type = zipfile.ZIP_DEFLATED
                z.writestr(info, base64.b64decode(b64))
        tmp = job["zipTmp"]
        zfd = os.open(tmp, NEW_FILE, 0o444, dir_fd=parent_fd)
        with os.fdopen(zfd, "wb") as f:
            f.write(buf.getvalue())
            os.fsync(f.fileno())
        zino = os.stat(tmp, dir_fd=parent_fd, follow_symlinks=False).st_ino
        try:
            rename_excl(parent_fd, tmp, parent_fd, job["final"] + ".zip")
            result["zip"] = job["final"] + ".zip"
        except OSError as e:
            if same_entry(parent_fd, tmp, zino):
                os.unlink(tmp, dir_fd=parent_fd)
            result["warning"] = (job["final"] + ".zip gab es schon, kein neues ZIP angelegt.") if e.errno == errno.EEXIST else ("ZIP nicht angelegt: " + str(e))
    say(result)


if __name__ == "__main__":
    try:
        main()
    except Exception as e:  # never a traceback with paths of other folders on stdout
        say({"error": "Export fehlgeschlagen: " + str(e)})
