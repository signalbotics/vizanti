#!/usr/bin/env bash
# Builds the Vizanti .deb packages for another ROS 2 distro inside the official ros:<distro>
# Docker image (Ubuntu release included), e.g. Jazzy on a Lyrical machine.
#
# Usage: packaging/build_debs_docker.sh DISTRO [--arch amd64|arm64] [build_debs.sh options and packages...]
#   packaging/build_debs_docker.sh jazzy
#   packaging/build_debs_docker.sh jazzy --arch arm64      # Jetson, Raspberry Pi (QEMU-emulated, slower)
#   packaging/build_debs_docker.sh humble vizanti_msgs vizanti_server vizanti
# Output: packaging/debs/<distro>/ (or --out DIR). See docs/packaging.md.
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
if [ $# -lt 1 ] || [[ "$1" == -* ]]; then
	sed -n '2,9p' "$0"
	exit 2
fi
DISTRO="$1"
shift

OUT="$REPO/packaging/debs/$DISTRO"
HOST_ARCH="$(dpkg --print-architecture 2>/dev/null || echo amd64)"
ARCH="$HOST_ARCH"
ARGS=()
while [ $# -gt 0 ]; do
	case "$1" in
		--out) OUT="$2"; shift 2 ;;
		--arch) ARCH="$2"; shift 2 ;;
		--distro) echo "Give the distro as the first argument." >&2; exit 2 ;;
		*) ARGS+=("$1"); shift ;;
	esac
done
mkdir -p "$OUT"
OUT="$(cd "$OUT" && pwd)"

case "$ARCH" in
	amd64|arm64) ;;
	*) echo "Unsupported --arch $ARCH (use amd64 or arm64)" >&2; exit 2 ;;
esac
PLATFORM="linux/$ARCH"
if [ "$ARCH" != "$HOST_ARCH" ] && ! docker buildx ls 2>/dev/null | grep -q "$PLATFORM"; then
	echo "Docker cannot run $PLATFORM containers here. Install QEMU emulation: sudo apt install qemu-user-binfmt" >&2
	exit 1
fi

IMAGE="vizanti-deb-builder:$DISTRO"
[ "$ARCH" = "$HOST_ARCH" ] || IMAGE="$IMAGE-$ARCH"
echo "==> builder image $IMAGE ($PLATFORM)"
docker build -q --platform "$PLATFORM" -t "$IMAGE" --build-arg ROS_DISTRO="$DISTRO" -f "$REPO/packaging/Dockerfile.build" "$REPO" >/dev/null

echo "==> building in the container"
# the source is mounted read-only; files written to /out are handed back to the caller's user
docker run --rm --platform "$PLATFORM" \
	-v "$REPO:/src:ro" \
	-v "$OUT:/out" \
	"$IMAGE" \
	bash -c 'status=0; /src/packaging/build_debs.sh --distro "$0" --out /out "${@:2}" || status=$?; chown -R "$1" /out; exit $status' \
	"$DISTRO" "$(id -u):$(id -g)" "${ARGS[@]}"
