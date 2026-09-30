#!/usr/bin/env bash
# Builds the Vizanti .deb packages for another ROS 2 distro inside the official ros:<distro>
# Docker image (Ubuntu release included), e.g. Jazzy on a Lyrical machine.
#
# Usage: packaging/build_debs_docker.sh DISTRO [build_debs.sh options and packages...]
#   packaging/build_debs_docker.sh jazzy
#   packaging/build_debs_docker.sh humble vizanti_msgs vizanti_server vizanti
# Output: packaging/debs/<distro>/ (or --out DIR). See docs/packaging.md.
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
if [ $# -lt 1 ] || [[ "$1" == -* ]]; then
	sed -n '2,8p' "$0"
	exit 2
fi
DISTRO="$1"
shift

OUT="$REPO/packaging/debs/$DISTRO"
ARGS=()
while [ $# -gt 0 ]; do
	case "$1" in
		--out) OUT="$2"; shift 2 ;;
		--distro) echo "Give the distro as the first argument." >&2; exit 2 ;;
		*) ARGS+=("$1"); shift ;;
	esac
done
mkdir -p "$OUT"
OUT="$(cd "$OUT" && pwd)"

IMAGE="vizanti-deb-builder:$DISTRO"
echo "==> builder image $IMAGE"
docker build -q -t "$IMAGE" --build-arg ROS_DISTRO="$DISTRO" -f "$REPO/packaging/Dockerfile.build" "$REPO" >/dev/null

echo "==> building in the container"
# the source is mounted read-only; files written to /out are handed back to the caller's user
docker run --rm \
	-v "$REPO:/src:ro" \
	-v "$OUT:/out" \
	"$IMAGE" \
	bash -c 'status=0; /src/packaging/build_debs.sh --distro "$0" --out /out "${@:2}" || status=$?; chown -R "$1" /out; exit $status' \
	"$DISTRO" "$(id -u):$(id -g)" "${ARGS[@]}"
