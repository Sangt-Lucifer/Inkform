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
    expected = {rel: hashlib.sha256(base64.b64decode(b64)).hexdigest() for rel, b64 in job["files"]}

    def fresh_dir(pfd, name):
        os.mkdir(name, 0o700, dir_fd=pfd)
        fd = os.open(name, DIR, dir_fd=pfd)
        s = os.fstat(fd)
        # Must be the folder just made: new, empty, ours. A folder swapped in meanwhile that holds
        # anything, or existed before this run, is never written to.
        if os.listdir(fd) or s.st_uid != os.getuid() or getattr(s, "st_birthtime", started) < started - 0.5 or not same_entry(pfd, name, s.st_ino):
            os.close(fd)
            raise OSError(errno.EEXIST, "Ordner wurde ausgetauscht", name)
        return fd, s.st_ino

    # Export root and studio folder: opened (or created) part by part without following links.
    place = [p for p in job["root"].split("/") if p] + [job["id"]]

    def walk(create):
        fd = os.open("/", DIR)
        for part in place:
            try:
                nxt = os.open(part, DIR, dir_fd=fd)
            except FileNotFoundError:
                if not create:
                    raise
                nxt, _ = fresh_dir(fd, part)
            os.close(fd)
            fd = nxt
        return fd

    def still_there():
        # The path still leads (without links) to the very folder opened at the start.
        try:
            again = walk(False)
        except OSError:
            return False
        same = os.fstat(again).st_ino == os.fstat(parent_fd).st_ino
        os.close(again)
        return same

    parent_fd = walk(True)
    root_fd = os.open("..", DIR, dir_fd=parent_fd)
    studio_like = {"profile.json", "manifest.webmanifest", ".git", "package.json"}
    if studio_like & set(os.listdir(root_fd)):
        return say({"error": "Der Exportordner sieht aus wie ein Studio oder Repo. Dort wird nichts geschrieben."})
    foreign = [n for n in os.listdir(parent_fd) if not ALLOWED_IN_PARENT.match(n)]
    if foreign:
        return say({"error": "Der Exportordner enthält fremde Einträge (" + ", ".join(sorted(foreign)[:5]) + "). Dort wird nichts geschrieben."})

    created_files = []  # (dir_fd, name, ino)
    created_dirs = []  # (parent_fd, name, fd, ino)
    staging = job["staging"]

    def make_dir(pfd, name):
        dfd, ino = fresh_dir(pfd, name)
        created_dirs.append((pfd, name, dfd, ino))
        return dfd

    def cleanup():
        # Only entries that are still exactly the ones created here (same inode) are removed.
        for pfd, name, dfd, ino in created_dirs:
            try:
                os.fchmod(dfd, 0o700)
            except OSError:
                pass
        for dfd, name, ino in reversed(created_files):
            try:
                if same_entry(dfd, name, ino):
                    os.unlink(name, dir_fd=dfd)
            except OSError:
                pass
        for pfd, name, dfd, ino in reversed(created_dirs):
            try:
                if same_entry(pfd, name, ino):
                    os.rmdir(name, dir_fd=pfd)
            except OSError:
                pass

    def staged_matches(dirs):
        # Exactly the expected files, nothing else, every byte as handed over (read without links).
        seen = {}
        for sub, dfd in dirs.items():
            for name in os.listdir(dfd):
                rel = (sub + "/" + name) if sub else name
                if rel in dirs:
                    continue
                rfd = os.open(name, os.O_RDONLY | os.O_NOFOLLOW, dir_fd=dfd)
                with os.fdopen(rfd, "rb") as f:
                    seen[rel] = hashlib.sha256(f.read()).hexdigest()
        return seen == expected

    try:
        pkg_fd = make_dir(parent_fd, staging)
        pkg_ino = created_dirs[-1][3]
        dirs = {"": pkg_fd}
        for rel, b64 in job["files"]:
            data = base64.b64decode(b64)
            parts = rel.split("/")
            here = ""
            for part in parts[:-1]:
                sub = (here + "/" + part) if here else part
                if sub not in dirs:
                    dirs[sub] = make_dir(dirs[here], part)
                here = sub
            dfd = dirs[here]
            wfd = os.open(parts[-1], NEW_FILE, 0o444, dir_fd=dfd)
            created_files.append((dfd, parts[-1], os.fstat(wfd).st_ino))
            with os.fdopen(wfd, "wb") as f:
                f.write(data)
                f.flush()
                os.fsync(f.fileno())
        if not staged_matches(dirs):
            raise OSError(errno.EIO, "Geschriebene Dateien stimmen nicht")
        for sub, dfd in sorted(dirs.items(), key=lambda kv: -kv[0].count("/")):
            if sub:
                os.fchmod(dfd, 0o555)
    except Exception as e:
        cleanup()
        return say({"error": "Schreiben fehlgeschlagen: " + str(e)})

    say({"written": True})
    answer = sys.stdin.readline().strip()
    try:
        if answer != "go":
            raise OSError(errno.ECANCELED, "abgebrochen: " + (answer or "keine Antwort"))
        # Still our folder under the hidden name, with exactly the handed-over bytes?
        if not still_there() or not same_entry(parent_fd, staging, pkg_ino) or not staged_matches(dirs):
            raise OSError(errno.ESTALE, "Das Paket hat sich vor dem Umbenennen verändert")
        rename_excl(parent_fd, staging, parent_fd, job["final"])
    except Exception as e:
        cleanup()
        if isinstance(e, OSError) and e.errno == errno.EEXIST:
            return say({"error": job["final"] + " gibt es inzwischen (EEXIST). Nichts überschrieben."})
        return say({"error": str(e)})
    os.fchmod(pkg_fd, 0o555)
    # Checked once more under the final name. If anything differs now, the package is marked as
    # unusable (it can then never count as a valid export).
    if not still_there() or not same_entry(parent_fd, job["final"], pkg_ino) or not staged_matches(dirs):
        try:
            os.fchmod(pkg_fd, 0o755)
            mfd = os.open(".unvollstaendig", os.O_WRONLY | os.O_CREAT | os.O_NOFOLLOW, 0o444, dir_fd=pkg_fd)
            os.write(mfd, b"Nach dem Schreiben veraendert. Dieses Paket nicht verwenden.\n")
            os.close(mfd)
            os.fchmod(pkg_fd, 0o555)
        except OSError:
            pass
        return say({"error": "Das Paket wurde nach dem Schreiben verändert und ist als unbrauchbar markiert."})

    result = {"ok": True, "zip": None, "warning": None}
    if job.get("zip"):
        tmp = job["zipTmp"]
        zino = None
        try:
            # Built in memory from the very same bytes, written exclusively, checked by inode and
            # content, renamed exclusively.
            buf = io.BytesIO()
            with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
                for rel, b64 in job["files"]:
                    info = zipfile.ZipInfo(job["final"] + "/" + rel, date_time=time.localtime(started)[:6])
                    info.external_attr = 0o444 << 16
                    info.compress_type = zipfile.ZIP_DEFLATED
                    z.writestr(info, base64.b64decode(b64))
            content = buf.getvalue()
            want = hashlib.sha256(content).hexdigest()
            zfd = os.open(tmp, NEW_FILE, 0o444, dir_fd=parent_fd)
            zino = os.fstat(zfd).st_ino
            with os.fdopen(zfd, "wb") as f:
                f.write(content)
                os.fsync(f.fileno())
            if not same_entry(parent_fd, tmp, zino):
                raise OSError(errno.ESTALE, "ZIP wurde ausgetauscht")
            rename_excl(parent_fd, tmp, parent_fd, job["final"] + ".zip")
            rfd = os.open(job["final"] + ".zip", os.O_RDONLY | os.O_NOFOLLOW, dir_fd=parent_fd)
            with os.fdopen(rfd, "rb") as f:
                ok = os.fstat(f.fileno()).st_ino == zino and hashlib.sha256(f.read()).hexdigest() == want
            if not ok:
                if same_entry(parent_fd, job["final"] + ".zip", zino):
                    os.unlink(job["final"] + ".zip", dir_fd=parent_fd)
                raise OSError(errno.ESTALE, "ZIP wurde nach dem Schreiben verändert")
            result["zip"] = job["final"] + ".zip"
        except Exception as e:
            if zino is not None and same_entry(parent_fd, tmp, zino):
                try:
                    os.unlink(tmp, dir_fd=parent_fd)
                except OSError:
                    pass
            exists = isinstance(e, OSError) and e.errno == errno.EEXIST
            result["warning"] = (job["final"] + ".zip gab es schon, kein neues ZIP angelegt.") if exists else ("Paket fertig, ZIP nicht angelegt: " + str(e))
    say(result)


if __name__ == "__main__":
    try:
        main()
    except Exception as e:  # never a traceback with paths of other folders on stdout
        say({"error": "Export fehlgeschlagen: " + str(e)})
