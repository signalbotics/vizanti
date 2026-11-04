import { test, expect } from '@playwright/test';

// The Plot panel against a live rosbridge. The page itself publishes the signal it plots (a sine
// on /e2e_plot_signal), so no other node is needed.
test.beforeEach(async ({ page }) => {
	page.errors = [];
	page.on('pageerror', (error) => page.errors.push(error.message));
	await page.goto('/');
	await expect(page.locator('.status_connection')).toContainText(/connected/i, { timeout: 20000 });
});

test.afterEach(async ({ page }) => {
	await page.evaluate(() => clearInterval(window.__plotSignal));
	expect(page.errors, 'uncaught errors in the page').toEqual([]);
});

async function addPlotPanel(page) {
	await page.locator('.rviz_toolbar button').first().click();
	await page.getByText('Add panel…').click();
	await page.locator('.add_search').fill('Plot');
	await page.locator('.widget_entry', { hasText: 'Plot' }).first().click();
	await expect(page.locator('.plot_widget .plot_cell')).toHaveCount(1);
	// it opens as a tab beside the 3D view, in the same dock group, and is the shown tab
	const dock = await page.evaluate(() => {
		const api = window.vizanti.shell.api;
		const plot = api.panels.find((p) => p.id.startsWith('display:plot'));
		return { sameGroup: plot.group.id === api.getPanel('view').group.id, active: plot.api.isActive };
	});
	expect(dock).toEqual({ sameGroup: true, active: true });
}

async function publishSignal(page) {
	await page.evaluate(() => {
		const t0 = performance.now();
		window.__plotSignal = setInterval(() => {
			const t = (performance.now() - t0) / 1000;
			window.vizanti.registry.context.publish('/e2e_plot_signal', 'geometry_msgs/msg/Vector3', { x: Math.sin(t * 3), y: Math.cos(t * 3), z: t });
		}, 50);
	});
}

const plot = (page) => page.evaluate(() => {
	const p = window.vizanti.registry.items.find((i) => i.constructor.type === 'plot');
	const views = [...p.views.values()];
	return { follow: p.axis.follow, views: views.map((v) => ({ curves: v.node.curves.length, points: v.lastFrame?.curves.map((c) => c.count) ?? [] })) };
});

test('plot: record a topic, drag its fields onto plots, split, and keep it all after a reload', async ({ page }) => {
	await publishSignal(page);
	await addPlotPanel(page);
	const topic = page.locator('.plot_topic_name', { hasText: /^\/e2e_plot_signal$/ });
	await expect(async () => {
		await page.locator('.plot_sidebar_top button').click(); // refresh the topic list
		await expect(topic).toBeVisible({ timeout: 1000 });
	}).toPass({ timeout: 20000 });
	await topic.click(); // expands it, and records it
	const leaf = (field) => page.locator(`.plot_leaf_row[data-topic="/e2e_plot_signal"][data-field="${field}"]`);
	await expect(leaf('x')).toBeVisible({ timeout: 15000 });

	// drag one field, then two selected ones
	const first = page.locator('.plot_cell').first();
	await leaf('x').dragTo(first);
	await leaf('y').click();
	await leaf('z').click({ modifiers: ['Control'] });
	await leaf('z').dragTo(first);
	await expect(first.locator('.plot_legend_row')).toHaveCount(3);
	await expect.poll(async () => (await plot(page)).views[0].points.every((n) => n > 5), { timeout: 10000 }).toBe(true);

	// split below; an XY plot of y against x
	await first.locator('button[title^="Split: new plot below"]').click();
	const second = page.locator('.plot_cell').nth(1);
	await second.locator('button[title^="Switch to an XY"]').click();
	await leaf('x').click();
	await leaf('y').click({ modifiers: ['Shift'] });
	await second.locator('button[title^="Add the fields"]').click();
	await expect(second.locator('.plot_legend_row')).toContainText('/e2e_plot_signal/y vs /e2e_plot_signal/x');

	// a second tab, renamed
	await page.locator('.plot_tab_add').click();
	await page.locator('.plot_tab_on .plot_tab_name').dblclick();
	await page.locator('.plot_tab_rename').fill('Second');
	await page.keyboard.press('Enter');
	await expect(page.locator('.plot_tab')).toHaveCount(2);
	await page.locator('.plot_tab .plot_tab_name', { hasText: 'Tab 1' }).click();

	// box zoom pauses the shared time axis; Follow resumes it
	const box = await first.locator('canvas').boundingBox();
	await page.mouse.move(box.x + box.width * 0.4, box.y + box.height * 0.3);
	await page.mouse.down();
	await page.mouse.move(box.x + box.width * 0.7, box.y + box.height * 0.6, { steps: 4 });
	await page.mouse.up();
	expect((await plot(page)).follow).toBe(false);
	await page.locator('.plot_follow').click();
	expect((await plot(page)).follow).toBe(true);

	// switching to the 3D view tab and back keeps the plots drawing
	await page.locator('.dv-tab', { hasText: '3D View' }).click();
	await expect(page.locator('.plot_widget')).toBeHidden();
	expect(await page.evaluate(() => window.vizanti.sceneElement.isConnected && window.vizanti.sceneElement.offsetWidth > 0)).toBe(true);
	await page.locator('.dv-tab', { hasText: /^Plot/ }).click();
	const before = (await plot(page)).views[0].points[0];
	await expect.poll(async () => (await plot(page)).views[0].points[0] !== before, { timeout: 5000 }).toBe(true);

	// saved with the layout
	await page.waitForTimeout(800);
	await page.reload();
	await expect(page.locator('.status_connection')).toContainText(/connected/i, { timeout: 20000 });
	await publishSignal(page);
	await expect(page.locator('.plot_tab')).toHaveCount(2);
	await expect(page.locator('.plot_cell')).toHaveCount(2);
	await expect(page.locator('.plot_cell').first().locator('.plot_legend_row')).toHaveCount(3);
	await expect.poll(async () => (await plot(page)).views[0].points.every((n) => n > 5), { timeout: 15000 }).toBe(true);
});

test('plot: a PlotJuggler layout file brings its tabs and curves, which then fill with data', async ({ page }) => {
	await publishSignal(page);
	await addPlotPanel(page);
	const xml = `<?xml version='1.0' encoding='UTF-8'?>
<root><tabbed_widget name="Main Window" parent="main_window">
 <Tab containers="1" tab_name="From PlotJuggler"><Container>
  <DockSplitter orientation="|" count="2" sizes="0.5;0.5">
   <DockArea name="a"><plot mode="TimeSeries" style="Lines"><range/><limitY/>
    <curve name="/e2e_plot_signal/x" color="#1f77b4"/><curve name="/e2e_plot_signal/y" color="#d62728"/></plot></DockArea>
   <DockArea name="b"><plot mode="XYPlot" style="Lines"><range/><limitY/>
    <curve name="c" curve_x="/e2e_plot_signal/x" curve_y="/e2e_plot_signal/y" color="#2ca02c"/></plot></DockArea>
  </DockSplitter></Container></Tab>
 <currentTabIndex index="0"/></tabbed_widget></root>`;
	await page.locator('.plot_toolbar input[type=file]').setInputFiles({ name: 'layout.xml', mimeType: 'text/xml', buffer: Buffer.from(xml) });
	await expect(page.locator('.plot_tab_on')).toContainText('From PlotJuggler');
	await expect(page.locator('.plot_cell')).toHaveCount(2);
	await expect(page.locator('.plot_cell').first().locator('.plot_legend_row')).toHaveCount(2);
	await expect(page.locator('.plot_cell').nth(1).locator('.plot_legend_row')).toContainText('/e2e_plot_signal/y vs /e2e_plot_signal/x');
	await expect.poll(async () => (await plot(page)).views.every((v) => v.points.length > 0 && v.points.every((n) => n > 5)), { timeout: 15000 }).toBe(true);
	// a file that is not a layout is refused with a notice, and nothing changes
	await page.locator('.plot_toolbar input[type=file]').setInputFiles({ name: 'other.xml', mimeType: 'text/xml', buffer: Buffer.from('<launch/>') });
	await expect(page.locator('.notice').last()).toContainText('not a PlotJuggler layout');
	await expect(page.locator('.plot_tab')).toHaveCount(2);
});
