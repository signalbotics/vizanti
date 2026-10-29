#!/usr/bin/env bash
# Builds .deb packages (ros-<distro>-vizanti-*) of the Vizanti ROS 2 packages with bloom.
# Nothing is installed and no system configuration is touched: rosdep runs against a private
# copy of its sources, and packages built earlier in the run are unpacked into a staging
# directory so later packages can build against them.
#
# Usage: packaging/build_debs.sh [--distro NAME] [--out DIR] [--keep-work] [PACKAGE...]
# Builds for the ROS installed here; for another distro use build_debs_docker.sh.
# See docs/packaging.md.
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
META="$REPO/packaging/debian_meta.py"
DISTRO="${ROS_DISTRO:-}"
OUT=""  # default: packaging/debs/<distro>
KEEP_WORK=0
PACKAGES=()
# dependency order: each package only needs the ones before it
ALL_PACKAGES=(vizanti_msgs vizanti_server vizanti vizanti_cpp vizanti_demos vizanti_nav2 vizanti_moveit)

while [ $# -gt 0 ]; do
	case "$1" in
		--distro) DISTRO="$2"; shift 2 ;;
		--out) OUT="$2"; shift 2 ;;
		--keep-work) KEEP_WORK=1; shift ;;
		-h|--help) sed -n '2,9p' "$0"; exit 0 ;;
		-*) echo "Unknown option $1" >&2; exit 2 ;;
		*) PACKAGES+=("$1"); shift ;;
	esac
done
[ ${#PACKAGES[@]} -gt 0 ] || PACKAGES=("${ALL_PACKAGES[@]}")

if [ -z "$DISTRO" ]; then
	DISTRO="$(ls /opt/ros 2>/dev/null | head -n1)"
fi
if [ -z "$DISTRO" ] || [ ! -f "/opt/ros/$DISTRO/setup.bash" ]; then
	echo "No ROS 2 installation found; pass --distro or source /opt/ros/<distro>/setup.bash." >&2
	exit 1
fi
for tool in bloom-generate fakeroot dpkg-buildpackage dh rosdep; do
	command -v "$tool" >/dev/null || {
		echo "Missing $tool. Install: sudo apt install python3-bloom python3-rosdep fakeroot debhelper dh-python" >&2
		exit 1
	}
done

for wanted in "${PACKAGES[@]}"; do
	[[ " ${ALL_PACKAGES[*]} " == *" $wanted "* ]] || { echo "Unknown package $wanted" >&2; exit 2; }
done
# build them in dependency order whatever order they were given in
ORDERED=()
for pkg in "${ALL_PACKAGES[@]}"; do
	for wanted in "${PACKAGES[@]}"; do
		[ "$pkg" = "$wanted" ] && ORDERED+=("$pkg")
	done
done

WORK="$(mktemp -d -t vizanti-debs.XXXXXX)"
cleanup() {
	if [ "$KEEP_WORK" = 1 ]; then
		echo "Work directory kept: $WORK"
	else
		rm -rf "$WORK"
	fi
}
trap cleanup EXIT

set +u
# shellcheck disable=SC1090
source "/opt/ros/$DISTRO/setup.bash"
set -u
[ -n "$OUT" ] || OUT="$REPO/packaging/debs/$DISTRO"
mkdir -p "$OUT" "$WORK/src" "$WORK/stage" "$WORK/rosdep" "$WORK/ros_home"
OUT="$(cd "$OUT" && pwd)"

echo "==> rosdep rules for distro $DISTRO"
python3 "$META" rosdep-yaml "$DISTRO" "$REPO" > "$WORK/rosdep/vizanti.yaml"
# ours first, then the system's sources (or the public default ones)
echo "yaml file://$WORK/rosdep/vizanti.yaml" > "$WORK/rosdep/05-vizanti.list"
if compgen -G "/etc/ros/rosdep/sources.list.d/*.list" >/dev/null; then
	cp /etc/ros/rosdep/sources.list.d/*.list "$WORK/rosdep/"
else
	curl -fsSL https://raw.githubusercontent.com/ros/rosdistro/master/rosdep/sources.list.d/20-default.list \
		-o "$WORK/rosdep/20-default.list"
fi
export ROSDEP_SOURCE_PATH="$WORK/rosdep"
export ROS_HOME="$WORK/ros_home"
rosdep update --rosdistro "$DISTRO" >/dev/null

STAGE_PREFIX="$WORK/stage/opt/ros/$DISTRO"
BUILT=()
for pkg in "${ORDERED[@]}"; do
	echo "==> $pkg"
	cp -a "$REPO/$pkg" "$WORK/src/$pkg"
	rm -rf "$WORK/src/$pkg/debian" "$WORK/src/$pkg/node_modules"
	find "$WORK/src/$pkg" -name __pycache__ -prune -exec rm -rf {} +
	(
		cd "$WORK/src/$pkg"
		bloom-generate rosdebian --ros-distro "$DISTRO" >/dev/null
		python3 "$META" fix-debian debian "$REPO"
		# packages built earlier in this run, unpacked but not installed
		export AMENT_PREFIX_PATH="$STAGE_PREFIX${AMENT_PREFIX_PATH:+:$AMENT_PREFIX_PATH}"
		export CMAKE_PREFIX_PATH="$STAGE_PREFIX${CMAKE_PREFIX_PATH:+:$CMAKE_PREFIX_PATH}"
		export LD_LIBRARY_PATH="$STAGE_PREFIX/lib${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
		if fakeroot debian/rules binary > "$WORK/$pkg.build.log" 2>&1; then
			exit 0
		fi
		echo "Build of $pkg failed; last lines of $WORK/$pkg.build.log:" >&2
		tail -n 40 "$WORK/$pkg.build.log" >&2
		exit 1
	) || { KEEP_WORK=1; exit 1; }
	for deb in "$WORK"/src/*.deb "$WORK"/src/*.ddeb; do
		[ -e "$deb" ] || continue
		case "$deb" in *.ddeb) rm -f "$deb"; continue ;; esac
		dpkg -x "$deb" "$WORK/stage"
		mv "$deb" "$OUT/"
		BUILT+=("$OUT/$(basename "$deb")")
	done
done

echo
echo "Built into $OUT:"
for deb in "${BUILT[@]}"; do
	echo "  $(basename "$deb")"
done
echo "Install with: sudo apt install ${BUILT[*]}"
