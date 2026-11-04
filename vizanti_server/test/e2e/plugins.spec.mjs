import { test, expect } from '@playwright/test';

// The example plugins of vizanti_demos (a display, a panel and a tool), declared like RViz
// plugins. Needs vizanti_demos installed next to the server.
test.beforeEach(async ({ page }) => {
	page.errors = [];
	page.on('pageerror', (error) => page.errors.push(error.message));
	await page.goto('/');
	await expect(page.locator('.status_connection')).toContainText(/connected/i, { timeout: 20000 });
});

test.afterEach(async ({ page }) => {
	expect(page.errors, 'uncaught errors in the page').toEqual([]);
});

// publishes / listens over the page's own rosbridge connection
const publish = (page, topic, type, msg) => page.evaluate(async ([topic, type, msg]) => {
	const { rosbridge } = await import('/js/modules/rosbridge.js');
	const t = new ROSLIB.Topic({ ros: rosbridge.ros, name: topic, messageType: type });
	t.publish(new ROSLIB.Message(msg));
}, [topic, type, msg]);

const listen = (page, topic, type) => page.evaluate(async ([topic, type]) => {
	const { rosbridge } = await import('/js/modules/rosbridge.js');
	window.__heard = [];
	new ROSLIB.Topic({ ros: rosbridge.ros, name: topic, messageType: type }).subscribe((m) => window.__heard.push(m));
}, [topic, type]);

test('a plugin display is listed under its package with its icon, and can be added', async ({ page }) => {
	await page.locator('.rviz_toolbar').getByRole('button', { name: 'Add display' }).click();
	const section = page.locator('.add_section', { has: page.locator('.add_section_title', { hasText: 'vizanti_demos' }) });
	const entry = section.locator('.widget_entry', { hasText: 'Frame Label' });
	await expect(entry).toBeVisible();
	await expect(entry.locator('img')).toHaveAttribute('src', /plugin_icons\/vizanti_demos\/classes\/Frame Label\.svg/);
	await expect(section).not.toContainText('Text Log'); // panels are not displays
	await entry.click();
	await expect(page.locator('details.tree_item .tree_name', { hasText: /^Frame Label$/ })).toHaveCount(1);
});

test('a plugin panel opens as a dock panel, shows its data, and closing it removes it', async ({ page }) => {
	await page.locator('.rviz_toolbar').getByRole('button', { name: 'Main menu' }).click();
	await page.getByRole('menuitem', { name: 'Add panel…' }).click();
	await page.locator('.widget_entry', { hasText: 'Text Log' }).click();
	const tab = page.locator('.dv-tab', { hasText: 'Text Log' });
	await expect(tab).toBeVisible();
	await page.waitForTimeout(1500); // the subscription is set up
	await publish(page, '/chatter', 'std_msgs/msg/String', { data: 'hello from the test' });
	await expect(page.locator('.widget_panel')).toContainText('hello from the test', { timeout: 10000 });
	// no toolbar button and no Displays row for a panel; its settings are in the panel
	await expect(page.locator('.rviz_widgets .widget_button[aria-label="Text Log"]')).toHaveCount(0);
	await expect(page.locator('details.tree_item .tree_name', { hasText: /^Text Log$/ })).toHaveCount(0);
	await page.locator('.panel_settings > summary').click();
	await expect(page.locator('.panel_settings .prop_row', { hasText: 'Lines kept' })).toBeVisible();
	await tab.locator('.dv-default-tab-action, [class*="close"]').first().click();
	await expect(tab).toHaveCount(0);
	expect(await page.evaluate(() => window.vizanti.registry.items.some((i) => i.constructor.isPanel && i.constructor.type !== 'plot'))).toBe(false); // the default Plot tab stays
});

test('a plugin tool is added with "+", gets the pointer, and can be removed', async ({ page }) => {
	const toolbar = page.locator('.rviz_toolbar');
	await toolbar.getByRole('button', { name: 'Add tool' }).click();
	await page.getByRole('menuitem', { name: 'Drop Pin' }).click();
	const pin = toolbar.locator('button[data-tool="vizanti_demos/Drop Pin"]');
	await expect(pin).toBeVisible();
	await listen(page, '/dropped_pins', 'geometry_msgs/msg/PointStamped');
	await page.waitForTimeout(1000);
	await pin.click();
	await expect(pin).toHaveAttribute('aria-pressed', 'true');
	const view = await page.locator('.scene_container').boundingBox();
	await page.mouse.click(view.x + view.width / 2, view.y + view.height / 2);
	await expect.poll(() => page.evaluate(() => window.__heard.length), { timeout: 10000 }).toBeGreaterThan(0);
	const heard = await page.evaluate(() => window.__heard[0]);
	expect(Number.isFinite(heard.point.x)).toBe(true);
	// kept in the layout, and removable with a right-click
	await page.reload();
	await expect(pin).toBeVisible();
	await pin.click({ button: 'right' });
	await page.getByRole('menuitem', { name: /Remove tool/ }).click();
	await expect(pin).toHaveCount(0);
});

test('importing a .rviz keeps widgets and panels, and brings RViz groups along', async ({ page }) => {
	await page.locator('.rviz_toolbar').getByRole('button', { name: 'Add display' }).click();
	await page.locator('.add_search').fill('battery');
	await page.locator('.widget_entry', { hasText: 'Battery' }).first().click();
	const rviz = `Panels:
  - Class: rviz_common/Displays
    Name: Displays
Visualization Manager:
  Global Options:
    Fixed Frame: map
  Displays:
    - Class: rviz_common/Group
      Name: Navigation
      Enabled: true
      Displays:
        - Class: rviz_default_plugins/Grid
          Name: Floor grid
          Enabled: true
`;
	await page.evaluate((text) => window.vizanti.importLayout(text), rviz);
	await page.waitForLoadState('load');
	await expect(page.locator('.status_connection')).toContainText(/connected/i, { timeout: 20000 });
	const items = await page.evaluate(() => window.vizanti.registry.items.map((i) => [i.constructor.type, i.name, i.container]));
	expect(items.some(([type]) => type === 'battery')).toBe(true); // the widget stayed
	const group = items.find(([type]) => type === 'folder');
	expect(group?.[1]).toBe('Navigation');
	expect(items.find(([, name]) => name === 'Floor grid')?.[2]).toMatch(/_widget_container$/);
});
