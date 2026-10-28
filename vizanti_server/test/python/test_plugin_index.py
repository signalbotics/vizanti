import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', '..', 'scripts'))
import plugin_index  # noqa: E402

XML = '''<library path="my_pkg">
  <class name="my_pkg/Battery Graph" type="displays/graph.js#BatteryGraph" base_class_type="vizanti::Display"
         rviz_class="other/Battery">
    <description>  Plots the
      battery voltage. </description>
  </class>
  <class name="my_pkg/Stop" type="tools/stop.js" base_class_type="vizanti::Tool"/>
  <class name="my_pkg/Missing" type="panels/missing.js#Missing" base_class_type="vizanti::Panel"/>
  <class name="my_pkg/Cpp" type="my_pkg::Thing" base_class_type="rviz_common::Display"/>
  <class name="my_pkg/Escape" type="../../evil.js" base_class_type="vizanti::Panel"/>
</library>'''


def make_package(root, package='my_pkg'):
	share = root / 'share' / package
	for path in ('vizanti/displays/graph.js', 'vizanti/tools/stop.js', 'icons/classes/Battery Graph.svg'):
		(share / path).parent.mkdir(parents=True, exist_ok=True)
		(share / path).write_text('//')
	(share / 'vizanti_plugins.xml').write_text(XML)
	return share


def test_parse_description_reads_classes_and_reports_problems(tmp_path):
	share = make_package(tmp_path)
	classes, problems = plugin_index.parse_description('my_pkg', str(share), XML)
	assert [c['name'] for c in classes] == ['my_pkg/Battery Graph', 'my_pkg/Stop']
	graph, stop = classes
	assert graph == {
		'package': 'my_pkg', 'name': 'my_pkg/Battery Graph', 'kind': 'display',
		'module': 'my_pkg/displays/graph.js', 'export': 'BatteryGraph',
		'description': 'Plots the battery voltage.', 'icon': 'my_pkg/classes/Battery Graph.svg',
		'rviz_class': 'other/Battery',
	}
	assert stop['kind'] == 'tool' and stop['export'] is None and stop['icon'] is None
	assert len(problems) == 3  # the missing file, the C++ class, the path escaping the folder
	assert any('missing.js is not installed' in p for p in problems)


def test_parse_description_rejects_bad_xml():
	classes, problems = plugin_index.parse_description('p', '/nowhere', '<library><class')
	assert classes == [] and 'not valid XML' in problems[0]


def test_find_plugins_uses_the_pluginlib_resource_and_the_old_one(tmp_path):
	make_package(tmp_path)
	old = tmp_path / 'share' / 'old_pkg' / 'vizanti' / 'displays'
	old.mkdir(parents=True)
	(old / 'b.js').write_text('//')
	(old / 'a.js').write_text('//')
	(old / 'notes.txt').write_text('')
	prefix = str(tmp_path)

	def resources(kind):
		# my_pkg also still has the old resource: its description wins
		return {'my_pkg': prefix} if kind == plugin_index.PLUGIN_RESOURCE else {'old_pkg': prefix, 'my_pkg': prefix}

	def content(kind, package):
		return 'share/my_pkg/vizanti_plugins.xml\n\nshare/my_pkg/absent.xml\n'

	found = plugin_index.find_plugins(resources, content)
	assert [c['name'] for c in found['classes']] == ['my_pkg/Battery Graph', 'my_pkg/Stop']
	assert found['legacy'] == ['old_pkg/displays/a.js', 'old_pkg/displays/b.js']
	assert any('absent.xml could not be read' in p for p in found['problems'])
	assert plugin_index.plugin_share_dir('old_pkg', resources) == os.path.join(prefix, 'share', 'old_pkg')
	assert plugin_index.plugin_share_dir('nobody', resources) is None
