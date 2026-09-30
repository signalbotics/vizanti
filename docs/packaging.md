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

## Build

Needs a ROS 2 installation in `/opt/ros/<distro>` and the Debian tooling:

```bash
sudo apt install python3-bloom python3-rosdep fakeroot debhelper dh-python
```

Then, from the repository root:

```bash
packaging/build_debs.sh                       # all five packages, for the distro in /opt/ros
packaging/build_debs.sh vizanti_msgs vizanti_server vizanti   # only these (any order)
packaging/build_debs.sh --distro jazzy --out /tmp/debs
packaging/build_debs.sh --keep-work           # keep the temporary build tree for debugging
```

The .deb files land in `packaging/debs/` (ignored by git). The packages are built for the
machine's Ubuntu release and architecture (for example `_0.1.1-0resolute_amd64.deb`); build
on the release you deploy to, or in a container of it.

Install them with apt, which pulls in their dependencies:

```bash
sudo apt install ./packaging/debs/*.deb
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
  also has none for `nav2_msgs`, which vizanti_demos needs. So the script runs rosdep against a
  private copy of its sources (`ROSDEP_SOURCE_PATH` and `ROS_HOME` point into the temporary
  directory), with an extra rules file.
  - That file (`debian_meta.py rosdep-yaml`) maps the vizanti packages to their .deb names.
  - It also maps any dependency rosdep cannot resolve, when a `ros-<distro>-<name>` package
    exists in apt.
  - `/etc/ros/rosdep` and `~/.ros` are not touched.
- **No sudo:** the script needs no root and installs nothing.

## Authors and maintainers in the packages

`package.xml` of every package lists:
- **Maintainers:** Bruk (bruk@signalbotics.com) first, then the original maintainers, Vid
  Rijavec / MoffKalast (vid.rijavec@gmail.com) and Alastair Bradford.
- **Authors:** MoffKalast and Bruk.

bloom only copies the *first* maintainer into Debian's files, so `debian_meta.py` adds the rest.
In every .deb:

| Where | What |
|---|---|
| `Maintainer` (control) | Bruk <bruk@signalbotics.com> |
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
