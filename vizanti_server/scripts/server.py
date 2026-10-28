#!/usr/bin/env python3

import os
import threading
import logging
import json
import gzip
import hashlib
import re
import rclpy

from flask import Flask, render_template, send_from_directory, make_response, request, abort
from waitress.server import create_server
from ament_index_python.packages import get_package_share_directory
from ament_index_python.resources import get_resources

from pathlib import Path

import plugin_index

GZIP_CACHE_MAX_ENTRIES = 256
COMPRESSIBLE_MIMETYPES = {'application/javascript', 'text/javascript', 'text/css', 'text/html', 'application/json', 'image/svg+xml', 'text/plain'}
gzip_cache = {}

node = None
param_base_url = ""
param_port = 5000
param_port_rosbridge = 5001
param_compression = "none"
param_default_widget_config = ""
param_config_dir = ""
param_default_config = ""

CONFIG_NAME = re.compile(r'^[\w-]{1,64}$')
CONFIG_MAX_BYTES = 2 * 1024 * 1024

def get_public_dir():
	p = Path(__file__).resolve()
	path = p.parents[1] / 'public'
	if path.exists():
		return path #for --symlink-install
	return get_package_share_directory('vizanti_server')+ '/public/'

app = Flask(__name__, static_folder=get_public_dir(), template_folder=get_public_dir())

def get_file(path):
	with open(param_default_widget_config, 'r') as f:
		file_content = f.read()
		js_module = f"const content = {json.dumps(file_content)};\nexport default content;"
		response = make_response(js_module)
		response.headers['Content-Type'] = 'application/javascript'
		return response

def get_files(path, valid_extensions):
	templates_dir = os.path.join(app.static_folder, path)
	file_list = []

	for root, dirs, files in os.walk(templates_dir):
		for file in files:
			if os.path.splitext(file)[1] in valid_extensions:
				file_path = os.path.join(root, file)
				with open(file_path, 'r') as f:
					file_content = f.read()
				file_list.append({'path': os.path.relpath(file_path, templates_dir), 'content': file_content})

	js_module = f"const files = {json.dumps(file_list)};\nexport default files;"

	#fetch workaround hackery for webkit support on HTTP
	response = make_response(js_module)
	response.headers['Content-Type'] = 'application/javascript'
	return response

def get_paths(path, valid_extensions):
	templates_dir = os.path.join(app.static_folder, path)
	file_list = []

	for root, dirs, files in os.walk(templates_dir):
		for file in files:
			if os.path.splitext(file)[1] in valid_extensions:
				file_list.append(os.path.relpath(os.path.join(root, file), templates_dir))

	js_module = f"const paths = {json.dumps(file_list)};\nexport default paths;"

	response = make_response(js_module)
	response.headers['Content-Type'] = 'application/javascript'
	return response

def index():
	return render_template('index.html', base_url=param_base_url)

def list_template_files():
	return get_files("templates", ['.html', '.js', '.css'])

def list_display_files():
	return get_paths("js/displays", ['.js'])

def list_robot_model_files():
	templates_dir = os.path.join(app.static_folder, "assets/robot_model")
	categorized_files = {
		'ground': [],
		'air': [],
		'sea': [],
		'misc': []
	}
	
	for root, dirs, files in os.walk(templates_dir):
		for file in files:
			if os.path.splitext(file)[1] == '.png':
				rel_path = os.path.relpath(root, templates_dir)
				category = rel_path if rel_path in categorized_files else 'misc'
				if category == '.':  # files in root directory
					category = 'misc'
				categorized_files[category].append(file)
	
	js_module = f"const categorizedPaths = {json.dumps(categorized_files)};\nexport default categorizedPaths;"
	response = make_response(js_module)
	response.headers['Content-Type'] = 'application/javascript'
	return response


def get_default_widget_config():
	return get_file(param_default_widget_config)

def list_ros_launch_params():
	params = {
		"port": param_port,
		"port_rosbridge": param_port_rosbridge,
		"compression": param_compression,
		"default_config": param_default_config
	}
	js_module = f"const params = {json.dumps(params)};\nexport default params;"
	response = make_response(js_module)
	response.headers['Content-Type'] = 'application/javascript'
	return response

def json_response(data, status=200):
	response = make_response(json.dumps(data), status)
	response.headers['Content-Type'] = 'application/json'
	return response

# Named layouts saved on the robot, shared by every browser that connects.
def list_configs():
	names = []
	if os.path.isdir(param_config_dir):
		for file in sorted(os.listdir(param_config_dir)):
			name, extension = os.path.splitext(file)
			if extension == '.json' and CONFIG_NAME.match(name):
				names.append(name)
	return json_response({'configs': names})

def config_file(name):
	if not CONFIG_NAME.match(name):
		return json_response({'error': 'A config name may only contain letters, digits, - and _.'}, 400)
	path = os.path.join(param_config_dir, name + '.json')

	if request.method == 'GET':
		if not os.path.isfile(path):
			return json_response({'error': f'There is no config named "{name}".'}, 404)
		with open(path, 'r') as f:
			response = make_response(f.read())
		response.headers['Content-Type'] = 'application/json'
		return response

	if request.method == 'DELETE':
		if os.path.isfile(path):
			os.remove(path)
		return json_response({'deleted': name})

	# PUT: store the layout exactly as sent, after checking it is a JSON object of sane size
	data = request.get_data(cache=False)
	if len(data) > CONFIG_MAX_BYTES:
		return json_response({'error': 'The config is larger than 2 MB.'}, 413)
	try:
		parsed = json.loads(data)
	except ValueError:
		return json_response({'error': 'The config is not valid JSON.'}, 400)
	if not isinstance(parsed, dict):
		return json_response({'error': 'The config must be a JSON object.'}, 400)
	try:
		os.makedirs(param_config_dir, exist_ok=True)
		temporary = path + '.tmp'
		with open(temporary, 'w') as f:
			json.dump(parsed, f, indent=2)
		os.replace(temporary, path)
	except OSError as e:
		return json_response({'error': f'The config could not be written: {e.strerror}.'}, 507)
	return json_response({'saved': name})

# Plugins from other packages (see plugin_index.py): pluginlib-style descriptions, and the older
# "vizanti_displays" folders.
PLUGIN_EXTENSIONS = {'.js', '.css', '.svg', '.png', '.json'}
ICON_FILE_EXTENSIONS = {'.svg', '.png'}

def js_module(value, name):
	response = make_response(f"const {name} = {json.dumps(value)};\nexport default {name};")
	response.headers['Content-Type'] = 'application/javascript'
	return response

def list_plugin_displays():
	return js_module(plugin_index.find_plugins()['legacy'], 'paths')

def plugin_manifest():
	found = plugin_index.find_plugins()
	for problem in found['problems']:
		node.get_logger().warn(f"Plugin: {problem}")
	return js_module(found, 'manifest')

def serve_plugin_file(package, path):
	share_dir = plugin_index.plugin_share_dir(package)
	if share_dir is None or os.path.splitext(path)[1].lower() not in PLUGIN_EXTENSIONS:
		abort(404)
	return send_from_directory(os.path.join(share_dir, 'vizanti'), path)

def serve_plugin_icon(package, path):
	share_dir = plugin_index.plugin_share_dir(package)
	if share_dir is None or os.path.splitext(path)[1].lower() not in ICON_FILE_EXTENSIONS:
		abort(404)
	return send_from_directory(os.path.join(share_dir, 'icons'), path)

# files a robot description may refer to with package:// URIs
MESH_EXTENSIONS = {'.stl', '.dae', '.obj', '.mtl', '.png', '.jpg', '.jpeg', '.tga', '.bmp'}

def serve_package_file(package, path):
	if os.path.splitext(path)[1].lower() not in MESH_EXTENSIONS:
		abort(404)
	try:
		share_dir = get_package_share_directory(package)
	except Exception:
		abort(404)
	# send_from_directory refuses paths that step outside the package's share directory
	return send_from_directory(share_dir, path)

def serve_static(path):
	return send_from_directory(app.static_folder, path)

@app.after_request
def add_caching_and_compression(response):
	if response.status_code != 200:
		return response

	# images and other binary assets are safe to cache for a day,
	# text content stays no-cache so the browser revalidates via ETag and gets cheap 304s
	if response.mimetype in COMPRESSIBLE_MIMETYPES:
		response.headers['Cache-Control'] = 'no-cache'
	else:
		response.headers['Cache-Control'] = 'public, max-age=86400'
		return response

	response.direct_passthrough = False
	data = response.get_data()

	content_hash = hashlib.md5(data).hexdigest()
	accepts_gzip = 'gzip' in request.headers.get('Accept-Encoding', '').lower()

	if accepts_gzip and len(data) > 512:
		compressed = gzip_cache.get(content_hash)
		if compressed is None:
			compressed = gzip.compress(data, 6)
			if len(gzip_cache) >= GZIP_CACHE_MAX_ENTRIES:
				gzip_cache.clear()
			gzip_cache[content_hash] = compressed

		if len(compressed) < len(data):
			response.set_data(compressed)
			response.headers['Content-Encoding'] = 'gzip'
			response.headers['Vary'] = 'Accept-Encoding'
			response.set_etag(content_hash + '-gz')
		else:
			response.set_etag(content_hash)
	else:
		response.set_etag(content_hash)

	# turns the response into a 304 if the client's If-None-Match matches
	return response.make_conditional(request)

class ServerThread(threading.Thread):
	def __init__(self, app, host='0.0.0.0', port=5000):
		threading.Thread.__init__(self)
		self.daemon = True

		self.log = logging.getLogger('waitress')
		self.log.setLevel(logging.INFO)
		handler = logging.StreamHandler()
		handler.setFormatter(logging.Formatter(
			'[%(levelname)s] [%(asctime)s] [waitress]: %(message)s '
		))
		self.log.addHandler(handler)

		self.app = app
		self.host = host
		self.port = port
		self.ctx = app.app_context()
		self.ctx.push()
		
		self._server = None
		self._stop_event = threading.Event()

	def run(self):
		self._server = create_server(self.app, host=self.host, port=self.port)
		try:
			self._server.run()
		except KeyboardInterrupt:
			self.shutdown()
		
	def shutdown(self):
		if self._server:
			self._server.close()  # This triggers waitress to stop accepting new connections
			self._stop_event.set()  # Signal that we're stopping
			if node is not None:
				node.get_logger().info("Waitress server shutting down...")

def main(args=None):
	global node, param_base_url, param_port, param_port_rosbridge, param_compression, param_default_widget_config, param_config_dir, param_default_config

	rclpy.init(args=args)
	node = rclpy.create_node('vizanti_flask_node')

	node.declare_parameter('host', '0.0.0.0')
	node.declare_parameter('port', param_port)
	node.declare_parameter('port_rosbridge', param_port_rosbridge)
	node.declare_parameter('flask_debug', False)
	node.declare_parameter('base_url', param_base_url)
	node.declare_parameter('compression', param_compression)
	node.declare_parameter('default_widget_config',param_default_widget_config)
	node.declare_parameter('config_dir', '~/.vizanti/configs')
	node.declare_parameter('default_config', '')

	param_host = node.get_parameter('host').value
	param_port = node.get_parameter('port').value
	param_port_rosbridge = node.get_parameter('port_rosbridge').value
	param_base_url = node.get_parameter('base_url').value
	param_compression = node.get_parameter('compression').value
	param_default_widget_config = node.get_parameter('default_widget_config').value

	if param_default_widget_config != "":
		param_default_widget_config = os.path.expanduser(param_default_widget_config)
	else:
		param_default_widget_config = os.path.join(app.static_folder, "assets/default_layout.json")

	node.get_logger().info(f"Default widget config set to {param_default_widget_config}")

	param_config_dir = os.path.expanduser(node.get_parameter('config_dir').value or '~/.vizanti/configs')
	node.get_logger().info(f"Saved configs are kept in {param_config_dir}")

	# a config saved on the robot that browsers without a layout of their own start from
	param_default_config = node.get_parameter('default_config').value or ""
	if param_default_config and not CONFIG_NAME.match(param_default_config):
		node.get_logger().warn(f"default_config '{param_default_config}' is not a valid config name; ignored")
		param_default_config = ""
	elif param_default_config:
		node.get_logger().info(f"Browsers without a layout start from the saved config '{param_default_config}'")

	app.debug = node.get_parameter('flask_debug').value
	app.add_url_rule(param_base_url + '/', 'index', index)
	app.add_url_rule(param_base_url + '/templates/files', 'list_template_files', list_template_files)
	app.add_url_rule(param_base_url + '/assets/robot_model/paths', 'list_robot_model_files', list_robot_model_files)
	app.add_url_rule(param_base_url + '/ros_launch_params', 'ros_launch_params', list_ros_launch_params)
	app.add_url_rule(param_base_url + '/default_widget_config', 'get_default_widget_config', get_default_widget_config)
	app.add_url_rule(param_base_url + '/displays/paths', 'list_display_files', list_display_files)
	app.add_url_rule(param_base_url + '/plugins/paths', 'list_plugin_displays', list_plugin_displays)
	app.add_url_rule(param_base_url + '/plugins/manifest', 'plugin_manifest', plugin_manifest)
	app.add_url_rule(param_base_url + '/plugin_icons/<package>/<path:path>', 'serve_plugin_icon', serve_plugin_icon)
	app.add_url_rule(param_base_url + '/plugins/<package>/<path:path>', 'serve_plugin_file', serve_plugin_file)
	app.add_url_rule(param_base_url + '/configs', 'list_configs', list_configs)
	app.add_url_rule(param_base_url + '/configs/<name>', 'config_file', config_file, methods=['GET', 'PUT', 'DELETE'])
	app.add_url_rule(param_base_url + '/package/<package>/<path:path>', 'serve_package_file', serve_package_file)
	app.add_url_rule(param_base_url + '/<path:path>', 'serve_static', serve_static)

	server = ServerThread(app, param_host, param_port)
	server.start()

	node.get_logger().info(f"Flask server running at http://{param_host}:{param_port}{param_base_url}")
	node.get_logger().info(f"Public directory set as {get_public_dir()}")

	rclpy.spin(node)

	server.shutdown()
	server.join()
	node.destroy_node()
	rclpy.shutdown()

if __name__ == '__main__':
	main()