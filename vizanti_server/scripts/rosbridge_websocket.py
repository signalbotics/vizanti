#!/usr/bin/env python3

# rosbridge_server's websocket node, with two fixes to how rosbridge_library talks to servers:
#
# - A longer wait for action servers. rosbridge makes a new action client for every goal and gives
#   it a fixed 1 s to discover the server (rosbridge_library.internal.actions.SendGoal, not a
#   parameter). A fresh client can need most of that on its own (Nav2's /follow_waypoints:
#   ~0.75 s), so on a busy graph the goal fails with "No action server available" every time. The
#   RViz panels wait 5 s; so does this.
#
# - One service client per service, kept, instead of a new client for every call that is
#   destroyed after it. A client that is only moments old can have its request dropped: the graph
#   already lists the server, so wait_for_service() returns at once, but DDS has not matched the
#   new client to it yet. On Jazzy (rosbridge 2.7, Fast DDS) every other Nav2 Pause / Resume
#   (/lifecycle_manager_navigation/manage_nodes) never reached the lifecycle manager and timed out;
#   with the client kept, every call arrives. RViz's panels keep their clients too.

import os
import runpy
import threading

from ament_index_python.packages import get_package_prefix
from rosbridge_library.internal import actions, services

ACTION_SERVER_WAIT = 5.0

_init = actions.SendGoal.__init__

def _patient_init(self, *args, **kwargs):
	_init(self, *args, **kwargs)
	self.server_timeout_time = max(self.server_timeout_time, ACTION_SERVER_WAIT)

actions.SendGoal.__init__ = _patient_init


class _KeptClients:
	"""The node, as services.call_service sees it: create_client() hands back the client already
	made for that service and type, and destroy_client() leaves kept clients alone."""

	_clients = {}
	_lock = threading.Lock()

	def __init__(self, node):
		self._node = node

	def __getattr__(self, name):
		return getattr(self._node, name)

	def create_client(self, srv_type, srv_name, **kwargs):
		key = (id(self._node), srv_name, srv_type)
		with self._lock:
			client = self._clients.get(key)
			if client is None:
				client = self._node.create_client(srv_type, srv_name, **kwargs)
				self._clients[key] = client
			return client

	def destroy_client(self, client):
		with self._lock:
			if client in self._clients.values():
				return True
		return self._node.destroy_client(client)


_call_service = services.call_service

def _call_service_kept_client(node_handle, *args, **kwargs):
	return _call_service(_KeptClients(node_handle), *args, **kwargs)

services.call_service = _call_service_kept_client

if __name__ == '__main__':
	runpy.run_path(os.path.join(get_package_prefix('rosbridge_server'), 'lib', 'rosbridge_server', 'rosbridge_websocket'), run_name='__main__')
