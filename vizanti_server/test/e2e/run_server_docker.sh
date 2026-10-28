#!/usr/bin/env bash
# Starts a throwaway Vizanti server in a ros:<distro>-ros-base container, built from this
# checkout, for the browser tests; waits until it serves the page. Its own ROS domain keeps it
# apart from any ROS graph on the host.
#
#   vizanti_server/test/e2e/run_server_docker.sh [distro] [port] [rosbridge_port]
#   IMAGE=my-image:tag ...   another base image with that distro (e.g. one with Nav2 installed)
#   VIZANTI_URL=http://localhost:5080 npx playwright test
#   docker rm -f vizanti-e2e        # stop it
set -euo pipefail

DISTRO=${1:-jazzy}
PORT=${2:-5080}
ROSBRIDGE_PORT=${3:-5081}
NAME=${NAME:-vizanti-e2e}
IMAGE=${IMAGE:-ros:${DISTRO}-ros-base}
REPO=$(cd "$(dirname "$0")/../../.." && pwd)

docker rm -f "$NAME" >/dev/null 2>&1 || true
docker run -d --name "$NAME" --network host -e ROS_DOMAIN_ID=77 \
	-v "$REPO":/src/vizanti:ro "$IMAGE" bash -c "
set -e
mkdir -p /ws/src && cp -r /src/vizanti /ws/src/vizanti && cd /ws
rm -rf src/vizanti/vizanti_server/test/e2e/node_modules
apt-get update -qq
rosdep update -q >/dev/null
rosdep install -y -q --from-paths src --ignore-src >/dev/null
source /opt/ros/${DISTRO}/setup.bash
colcon build --packages-up-to vizanti_server vizanti_cpp vizanti_demos vizanti_nav2 --event-handlers console_cohesion- >/dev/null
source install/setup.bash
exec ros2 launch vizanti_server vizanti_server.launch.py port:=${PORT} port_rosbridge:=${ROSBRIDGE_PORT}
" >/dev/null

echo "Building and starting Vizanti (${DISTRO}) in container ${NAME}..."
for _ in $(seq 1 180); do
	if curl -fs "http://localhost:${PORT}/" >/dev/null; then
		echo "Vizanti is up at http://localhost:${PORT}"
		exit 0
	fi
	if [ "$(docker inspect -f '{{.State.Running}}' "$NAME")" != "true" ]; then
		docker logs --tail 50 "$NAME"
		echo "The container stopped." >&2
		exit 1
	fi
	sleep 5
done
docker logs --tail 50 "$NAME"
echo "Vizanti did not come up within 15 minutes." >&2
exit 1
