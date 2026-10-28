"""Finds Vizanti plugins installed by other ROS packages.

A package declares its classes the way RViz plugins do, in a pluginlib-style XML file:

    <library path="my_package">
      <class name="my_package/Battery Graph" type="displays/battery_graph.js#BatteryGraph"
             base_class_type="vizanti::Display" rviz_class="other_pkg/BatteryGraph">
        <description>Plots the battery voltage.</description>
      </class>
    </library>

and exports it from CMakeLists.txt with

    pluginlib_export_plugin_description_file(vizanti_server vizanti_plugins.xml)

which registers the ament resource "vizanti_server__pluginlib__plugin". `type` is a JavaScript
module under share/<package>/vizanti/ and, after "#", the exported class. Icons follow RViz:
share/<package>/icons/classes/<class name after the "/">.svg or .png.

The older form, the resource "vizanti_displays" with share/<package>/vizanti/displays/*.js,
still works; those modules are listed without a description.
"""

import os
import xml.etree.ElementTree as ET

PLUGIN_RESOURCE = 'vizanti_server__pluginlib__plugin'
LEGACY_RESOURCE = 'vizanti_displays'
KINDS = {'vizanti::Display': 'display', 'vizanti::Panel': 'panel', 'vizanti::Tool': 'tool'}
ICON_EXTENSIONS = ('.svg', '.png')


def _resources(resource_type):
	from ament_index_python.resources import get_resources
	return get_resources(resource_type)


def _resource_content(resource_type, package):
	from ament_index_python.resources import get_resource
	content, _ = get_resource(resource_type, package)
	return content


def parse_description(package, share_dir, xml_text):
	"""The classes in one plugin description, as dicts; problems as a list of strings."""
	classes, problems = [], []
	try:
		root = ET.fromstring(xml_text)
	except ET.ParseError as e:
		return [], [f'{package}: the plugin description is not valid XML ({e})']
	# a single <library> or several inside <class_libraries>
	for element in root.iter('class'):
		name = (element.get('name') or '').strip()
		kind = KINDS.get((element.get('base_class_type') or '').strip())
		module, _, export = (element.get('type') or '').strip().partition('#')
		if not name or kind is None or not module.endswith('.js') or '..' in module.split('/'):
			problems.append(f'{package}: class "{name or "?"}" needs a name, type="<file>.js#<Class>" '
				'and base_class_type vizanti::Display, vizanti::Panel or vizanti::Tool')
			continue
		if not os.path.isfile(os.path.join(share_dir, 'vizanti', module)):
			problems.append(f'{package}: class "{name}": {module} is not installed in share/{package}/vizanti/')
			continue
		short = name.split('/', 1)[-1]
		icon = None
		for extension in ICON_EXTENSIONS:
			if os.path.isfile(os.path.join(share_dir, 'icons', 'classes', short + extension)):
				icon = f'{package}/classes/{short}{extension}'
				break
		description = element.findtext('description') or ''
		classes.append({
			'package': package,
			'name': name,
			'kind': kind,
			'module': f'{package}/{module}',
			'export': export or None,
			'description': ' '.join(description.split()),
			'icon': icon,
			'rviz_class': (element.get('rviz_class') or '').strip() or None,
		})
	return classes, problems


def find_plugins(resources=_resources, resource_content=_resource_content):
	"""Every installed plugin class, the older display modules, and any problems found."""
	classes, legacy, problems = [], [], []
	for package, prefix in sorted(resources(PLUGIN_RESOURCE).items()):
		share_dir = os.path.join(prefix, 'share', package)
		for line in resource_content(PLUGIN_RESOURCE, package).splitlines():
			relative = line.strip()
			if not relative:
				continue
			path = os.path.join(prefix, relative)
			try:
				with open(path, encoding='utf-8') as f:
					found, issues = parse_description(package, share_dir, f.read())
			except OSError as e:
				problems.append(f'{package}: {relative} could not be read ({e.strerror})')
				continue
			classes.extend(found)
			problems.extend(issues)
	described = set(resources(PLUGIN_RESOURCE))
	for package, prefix in sorted(resources(LEGACY_RESOURCE).items()):
		if package in described:
			continue  # its plugin description lists its modules
		folder = os.path.join(prefix, 'share', package, 'vizanti', 'displays')
		if os.path.isdir(folder):
			legacy.extend(f'{package}/displays/{file}' for file in sorted(os.listdir(folder)) if file.endswith('.js'))
	return {'classes': classes, 'legacy': legacy, 'problems': problems}


def plugin_share_dir(package, resources=_resources):
	"""share/<package> of a package that provides plugins, or None."""
	for resource_type in (PLUGIN_RESOURCE, LEGACY_RESOURCE):
		found = resources(resource_type)
		if package in found:
			return os.path.join(found[package], 'share', package)
	return None
