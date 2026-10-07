#!/usr/bin/env python3
"""Builds an apt repository from Vizanti .deb files, ready to put on any static web host.

    packaging/build_apt_repo.py packaging/debs/*/ --out packaging/apt-repo [--sign-key KEYID]

Layout (the standard one apt expects):

    dists/<codename>/Release, InRelease, Release.gpg       (signed when --sign-key is given)
    dists/<codename>/main/binary-<arch>/Packages, Packages.gz
    pool/main/<codename>/<package>.deb
    vizanti-archive-keyring.gpg                             (the public key, when signed)

The Ubuntu codename comes from the .deb's version (bloom builds end it with "-0<codename>",
for example 0.1.2-0noble). An existing --out is added to, so older versions stay installable.
Needs apt-ftparchive (apt-utils) and, for signing, gpg. See docs/packaging.md.
"""

import argparse
import gzip
import re
import shutil
import subprocess
import sys
from pathlib import Path

COMPONENT = "main"
ORIGIN = "Signalbotics"
LABEL = "Vizanti"
KEYRING_NAME = "vizanti-archive-keyring.gpg"


def control_fields(deb):
    out = subprocess.run(["dpkg-deb", "-f", str(deb), "Package", "Version", "Architecture"],
                         check=True, capture_output=True, text=True).stdout
    fields = {}
    for line in out.splitlines():
        key, _, value = line.partition(":")
        fields[key.strip()] = value.strip()
    return fields


def codename_of(version):
    # bloom: <upstream>-<debian inc><codename>, e.g. 0.1.2-0noble
    match = re.search(r"-\d+([a-z]+)$", version)
    return match.group(1) if match else None


def find_debs(paths):
    debs = []
    for path in map(Path, paths):
        if path.is_dir():
            debs.extend(sorted(path.rglob("*.deb")))
        elif path.suffix == ".deb":
            debs.append(path)
        else:
            sys.exit(f"Not a .deb or a folder: {path}")
    return debs


def write_packages(repo, codename, arch):
    pool = f"pool/{COMPONENT}/{codename}"
    out = subprocess.run(["apt-ftparchive", "--arch", arch, "packages", pool],
                         cwd=repo, check=True, capture_output=True, text=True).stdout
    target = repo / "dists" / codename / COMPONENT / f"binary-{arch}"
    target.mkdir(parents=True, exist_ok=True)
    (target / "Packages").write_text(out)
    with gzip.open(target / "Packages.gz", "wt") as f:
        f.write(out)
    return len(re.findall(r"^Package: ", out, re.M))


def write_release(repo, codename, archs):
    options = {
        "Origin": ORIGIN, "Label": LABEL, "Suite": codename, "Codename": codename,
        "Architectures": " ".join(sorted(archs)), "Components": COMPONENT,
        "Description": "Vizanti, a web UI for ROS 2",
    }
    dist = repo / "dists" / codename
    # the old ones must not be hashed into the new Release
    for stale in ("Release", "InRelease", "Release.gpg"):
        (dist / stale).unlink(missing_ok=True)
    args = ["apt-ftparchive"]
    for key, value in options.items():
        args += ["-o", f"APT::FTPArchive::Release::{key}={value}"]
    release = subprocess.run(args + ["release", "."], cwd=dist, check=True, capture_output=True, text=True).stdout
    (dist / "Release").write_text(release)


def sign(repo, codename, key):
    dist = repo / "dists" / codename
    gpg = ["gpg", "--batch", "--yes", "--local-user", key]
    subprocess.run(gpg + ["--clearsign", "-o", "InRelease", "Release"], cwd=dist, check=True)
    subprocess.run(gpg + ["--armor", "--detach-sign", "-o", "Release.gpg", "Release"], cwd=dist, check=True)


def export_key(repo, key):
    # binary (dearmored) form, as /usr/share/keyrings and signed-by= expect
    key_data = subprocess.run(["gpg", "--batch", "--export", key], check=True, capture_output=True).stdout
    if not key_data:
        sys.exit(f"gpg has no public key {key}")
    (repo / KEYRING_NAME).write_bytes(key_data)


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("debs", nargs="+", help=".deb files or folders holding them")
    parser.add_argument("--out", default="packaging/apt-repo", help="repository folder (added to if it exists)")
    parser.add_argument("--sign-key", help="gpg key id or e-mail to sign the Release files with")
    args = parser.parse_args()

    for tool in ["apt-ftparchive", "dpkg-deb"] + (["gpg"] if args.sign_key else []):
        if not shutil.which(tool):
            sys.exit(f"{tool} is missing (sudo apt install apt-utils dpkg-dev gnupg)")

    repo = Path(args.out).resolve()
    debs = find_debs(args.debs)
    if not debs:
        sys.exit("No .deb files found.")

    for deb in debs:
        fields = control_fields(deb)
        codename = codename_of(fields["Version"])
        if not codename:
            sys.exit(f"{deb.name}: version {fields['Version']} does not end in -0<codename>; build it with packaging/build_debs.sh")
        pool = repo / "pool" / COMPONENT / codename
        pool.mkdir(parents=True, exist_ok=True)
        shutil.copy2(deb, pool / deb.name)

    for codename_dir in sorted((repo / "pool" / COMPONENT).iterdir()):
        codename = codename_dir.name
        archs = {control_fields(deb)["Architecture"] for deb in codename_dir.glob("*.deb")}
        # "all" packages are listed under every architecture
        listed = sorted(archs - {"all"}) or ["amd64"]
        for arch in listed:
            count = write_packages(repo, codename, arch)
            print(f"{codename}/{arch}: {count} packages")
        write_release(repo, codename, listed)
        if args.sign_key:
            sign(repo, codename, args.sign_key)

    if args.sign_key:
        export_key(repo, args.sign_key)
    print(f"Repository in {repo}" + ("" if args.sign_key else " (unsigned: clients need [trusted=yes])"))


if __name__ == "__main__":
    main()
