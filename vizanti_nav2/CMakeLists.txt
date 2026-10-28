cmake_minimum_required(VERSION 3.20)
project(vizanti_nav2)

find_package(ament_cmake REQUIRED)
find_package(pluginlib REQUIRED)

# Vizanti plugins are JavaScript: install them, and declare them the way RViz plugins are declared
install(DIRECTORY vizanti icons DESTINATION share/${PROJECT_NAME}/)
pluginlib_export_plugin_description_file(vizanti_server vizanti_plugins.xml)

ament_package()
