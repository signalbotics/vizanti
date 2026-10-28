#!/usr/bin/env python3

# rosbridge_server's websocket node with a longer wait for action servers.
# rosbridge makes a new action client for every goal and gives it a fixed 1 s to discover the
# server (rosbridge_library.internal.actions.SendGoal, not a parameter). A fresh client can need most
# of that on its own (Nav2's /follow_waypoints: ~0.75 s), so on a busy graph the goal fails with
# "No action server available" every time. The RViz panels wait 5 s; so does this.

import os
import runpy

from ament_index_python.packages import get_package_prefix
from rosbridge_library.internal import actions

ACTION_SERVER_WAIT = 5.0

_init = actions.SendGoal.__init__

def _patient_init(self, *args, **kwargs):
	_init(self, *args, **kwargs)
	self.server_timeout_time = max(self.server_timeout_time, ACTION_SERVER_WAIT)

actions.SendGoal.__init__ = _patient_init

if __name__ == '__main__':
	runpy.run_path(os.path.join(get_package_prefix('rosbridge_server'), 'lib', 'rosbridge_server', 'rosbridge_websocket'), run_name='__main__')
