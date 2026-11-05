# Debian packages

`packaging/build_debs.sh` builds the five Vizanti ROS 2 packages as .deb files, named the way the
ROS build farm names them:

| Package | .deb |
|---|---|
| vizanti_msgs | `ros-<distro>-vizanti-msgs` |
| vizanti_server | `ros-<distro>-vizanti-server` (web UI, server, launch files) |
| vizanti | `ros-<distro>-vizanti` (metapackage: msgs + server) |
| vizanti_cpp | `ros-<distro>-vizanti-cpp` |
| vizanti_demos | `ros-<distro>-vizanti-demos` |
| vizanti_nav2 | `ros-<distro>-vizanti-nav2` (Navigation 2 panel and Nav2 goal tool) |
| vizanti_moveit | `ros-<distro>-vizanti-moveit` (MoveIt displays: RobotState, Trajectory, PlanningScene, MotionPlanning) |

## Build

Needs a ROS 2 installation in `/opt/ros/<distro>` and the Debian tooling:

```bash
sudo apt install python3-bloom python3-rosdep fakeroot debhelper dh-python
```

Then, from the repository root:

```bash
packaging/build_debs.sh                       # all five packages, for the distro in /opt/ros
packaging/build_debs.sh vizanti_msgs vizanti_server vizanti   # only these (any order)
packaging/build_debs.sh --out /tmp/debs
packaging/build_debs.sh --keep-work           # keep the temporary build tree for debugging
```

The .deb files land in `packaging/debs/<distro>/` (ignored by git). They are built for this
machine's ROS distro, Ubuntu release and architecture, for example
`ros-lyrical-vizanti-server_0.1.1-0resolute_amd64.deb`.

### Other distros (Jazzy, Humble, ...)

`packaging/build_debs_docker.sh` builds for any ROS 2 distro that has an official
`ros:<distro>-ros-base` Docker image. That image also sets the Ubuntu release: Jazzy gives
24.04 (`noble`) and Humble gives 22.04 (`jammy`). It needs Docker and network access.

```bash
packaging/build_debs_docker.sh jazzy                  # -> packaging/debs/jazzy/
packaging/build_debs_docker.sh humble vizanti_msgs vizanti_server vizanti
```

It builds a builder image `vizanti-deb-builder:<distro>` from `packaging/Dockerfile.build`,
which contains the ROS base, bloom and the packages' dependencies. It then runs `build_debs.sh`
inside that image with the repository mounted read-only. The .deb files are owned by your user.
The first run for a distro takes a few minutes; later runs reuse the image. Remove the image
with `docker rmi vizanti-deb-builder:<distro>`.

Checked for Jazzy (2026-10-01) and Humble (2026-10-06, Ubuntu 22.04): all five packages
built, then `apt install`ed into a clean `ros:<distro>-ros-base` container. The server started
there and served the web UI.

### arm64 (Jetson, Raspberry Pi)

```bash
packaging/build_debs_docker.sh jazzy --arch arm64     # -> packaging/debs/jazzy/*_arm64.deb
```

This builds in an arm64 container under QEMU emulation, so it is slow (about an hour for all
five packages on the development machine, versus minutes natively). It needs QEMU user-mode
emulation registered with the kernel: `sudo apt install qemu-user-binfmt`. The script says so
if it is missing. The builder image is `vizanti-deb-builder:<distro>-arm64`.

Checked on 2026-10-06: Jazzy arm64 packages built. The binaries are aarch64 ELF, all five
installed with apt in an emulated arm64 `ros:jazzy-ros-base` container, and the server served
the UI there. Not checked on real arm64 hardware.

### Install

Install them on a machine with the matching distro and Ubuntu release, using apt, which pulls
in their dependencies:

```bash
sudo apt install ./packaging/debs/jazzy/*.deb     # or lyrical/, ...
```

and run as usual: `ros2 launch vizanti_server vizanti_server.launch.py`.

Remove them with `sudo apt remove 'ros-<distro>-vizanti*'`.

## How it works

For each package, in dependency order, the script:

1. copies the package to a temporary directory;
2. runs `bloom-generate rosdebian` to create `debian/` from `package.xml`;
3. runs `packaging/debian_meta.py fix-debian`, which rewrites the parts bloom leaves thin (below);
4. builds with `fakeroot debian/rules binary`;
5. unpacks the result into a staging prefix, so later packages (such as vizanti_server, which
   needs vizanti_msgs) build against it without anything being installed.

Two things make it self-contained:
- **rosdep:** the public rosdep database has no rules for the vizanti packages. On Lyrical it
  also has none for `nav2_msgs`, which vizanti_demos and vizanti_nav2 need. So the script runs rosdep against a
  private copy of its sources (`ROSDEP_SOURCE_PATH` and `ROS_HOME` point into the temporary
  directory), with an extra rules file.
  - That file (`debian_meta.py rosdep-yaml`) maps the vizanti packages to their .deb names.
  - It also maps any dependency rosdep cannot resolve, when a `ros-<distro>-<name>` package
    exists in apt.
  - `/etc/ros/rosdep` and `~/.ros` are not touched.
- **No sudo:** the script needs no root and installs nothing.

## Apt repository

`packaging/build_apt_repo.py` turns built .debs into a standard apt repository that any static
web host can serve (nginx, S3, GitHub Pages, an internal file server):

```bash
packaging/build_apt_repo.py packaging/debs/*/ --out packaging/apt-repo --sign-key KEYID
```

- One `dists/<codename>` per Ubuntu release, taken from the .deb version (`-0noble`,
  `-0jammy`, ...), with a `binary-<arch>` index per architecture found; the .debs go to
  `pool/main/<codename>/`.
- An existing `--out` is added to, so older versions stay installable: keep the folder (or
  sync it down from the host first) between releases.
- `--sign-key` signs `Release` (`InRelease` and `Release.gpg`) with that gpg key and writes
  its public part as `vizanti-archive-keyring.gpg` at the top. Without it the repository is
  unsigned and clients must add `[trusted=yes]`, which is only acceptable on a closed network.
- Needs `apt-utils` (apt-ftparchive) and `gnupg`.

Make a signing key once (keep the private key safe; CI needs it as a secret to sign there):

```bash
gpg --quick-gen-key "Signalbotics Vizanti packages <bruk@signalbotics.com>" ed25519 sign 3y
```

Publish: copy the whole `--out` folder to the host, e.g.
`rsync -a --delete packaging/apt-repo/ host:/var/www/apt/`.

On a robot (use your host's URL; the ROS apt repository must be set up too, since the
packages depend on ros-<distro>-* packages):

```bash
sudo curl -fsSL https://HOST/apt/vizanti-archive-keyring.gpg -o /usr/share/keyrings/vizanti-archive-keyring.gpg
echo "deb [signed-by=/usr/share/keyrings/vizanti-archive-keyring.gpg] https://HOST/apt $(. /etc/os-release; echo $VERSION_CODENAME) main" \
    | sudo tee /etc/apt/sources.list.d/vizanti.list
sudo apt update && sudo apt install ros-jazzy-vizanti
```

Checked on 2026-10-07: the Humble, Jazzy (amd64 + arm64) and Lyrical packages made into a
signed repository, served over HTTP, and `apt install ros-jazzy-vizanti` in a clean
`ros:jazzy-ros-base` container installed it with the signature verified; with a different key
apt refused the repository (NO_PUBKEY).

**Hosting is not decided yet.** The GitHub repository is public (since 2026-11-05), so the apt
repository could be served from GitHub Pages (a `gh-pages` branch) or release assets; other
options are an S3 / Cloudflare R2 bucket or a server on the robots' network.

## Authors and maintainers in the packages

`package.xml` of every package lists:
- **Maintainers:** Bruk (bruk@signalbotics.com) first, then the original maintainers, Vid
  Rijavec / MoffKalast (vid.rijavec@gmail.com) and Alastair Bradford.
- **Authors:** MoffKalast and Bruk.

bloom only copies the *first* maintainer into Debian's files, so `debian_meta.py` adds the rest.
In every .deb:

| Where | What |
|---|---|
| `Maintainer` (control) | Bruk Gebregziabher <bruk@signalbotics.com> |
| `Original-Maintainer` (control; written as `XSBC-Original-Maintainer`, the Ubuntu convention for packages built by someone other than upstream) | Vid Rijavec (MoffKalast) <vid.rijavec@gmail.com> |
| `/usr/share/doc/<package>/copyright` | DEP-5 file. `Upstream-Contact` is Vid Rijavec, and the copyright lists Vid Rijavec, Alastair Bradford and Bruk / Signalbotics. The license is BSD-3-Clause, from the repository's `LICENSE`. For vizanti_server there is also one stanza per vendored JavaScript library (three.js, dockview, roslibjs, nipplejs, numeric.js, quaternion.js), with the holders and text taken from its `*_LICENSE.txt` next to it in `public/js/lib/`. |
| `changelog` | Each entry credits Vizanti by Vid Rijavec with the upstream URL, and packaging by Bruk; it is signed by Bruk. |
| `Homepage` (control) | The repository URL from `package.xml`. |

The names and addresses are constants at the top of `packaging/debian_meta.py` (`PACKAGER`,
`UPSTREAM`, `UPSTREAM_CO`); change them there. The repository `LICENSE` and `ReadMe.md` carry
the same credits.

A new vendored library needs its `*_LICENSE.txt` and an entry in `THIRD_PARTY` in
`debian_meta.py`.

## Versions

The .deb version is the `<version>` of each `package.xml` plus `-0<ubuntu codename>`. Bump the
version in `package.xml` (and add a section to the package's `CHANGELOG.rst` if it has one) before
building a release, or apt will see the new build as the same version as the old one.

## Releases

**Automatic (CI):** `.github/workflows/ci.yml` runs the unit tests on every push to `main` and
on every pull request. Pushing a version tag (`v*`) also builds the packages for Humble, Jazzy
and Lyrical on amd64 and arm64 (arm64 under QEMU, so allow a few hours) and attaches all of
them to that tag's GitHub release, creating the release if needed:

```bash
git tag -a vX.Y.Z -m "..." && git push signalbotics vX.Y.Z
```

To try the package build without a release, run the CI workflow by hand (Actions → CI → Run
workflow, or `gh workflow run ci.yml --repo signalbotics/vizanti -f distro=jazzy -f arch=amd64`):
the packages are attached to the run as artifacts.

**By hand:**

Built packages are published as GitHub release assets on the public repository
https://github.com/signalbotics/vizanti (git remote `signalbotics`; `origin` is still upstream
MoffKalast/vizanti). Release `v0.1.1` holds the Lyrical and Jazzy packages.

To publish a new release from `main`:

```bash
# bump <version> in the package.xml files first
packaging/build_debs.sh                   # this machine's distro -> packaging/debs/<distro>/
packaging/build_debs_docker.sh jazzy      # -> packaging/debs/jazzy/
git tag -a vX.Y.Z -m "..." && git push signalbotics vX.Y.Z
gh release create vX.Y.Z --repo signalbotics/vizanti --target main \
    --title "Vizanti X.Y.Z" --notes "..." packaging/debs/*/*.deb
```

Keep the credits in the notes: Vizanti by Bruk Gebregziabher (Signalbotics) <bruk@signalbotics.com> (the
RViz-style 3D interface, plugins, Nav2 support and packaging), built on the original Vizanti by
Vid Rijavec (MoffKalast) <vid.rijavec@gmail.com>.
