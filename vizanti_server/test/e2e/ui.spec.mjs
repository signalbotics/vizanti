import { test, expect } from '@playwright/test';

// Every test starts from a fresh browser profile (empty local storage), so it gets the default
// layout, and fails on any uncaught error in the page.
test.beforeEach(async ({ page }) => {
	page.errors = [];
	page.on('pageerror', (error) => page.errors.push(error.message));
	await page.goto('/');
	await expect(page.locator('.status_connection')).toContainText(/connected/i, { timeout: 20000 });
});

test.afterEach(async ({ page }) => {
	expect(page.errors, 'uncaught errors in the page').toEqual([]);
});

// a row by its own name (a group's row also holds its members' rows)
const rowByName = (page, name) => page.locator('details.tree_item', { has: page.locator(':scope > summary > .tree_name', { hasText: new RegExp(`^${name}$`) }) });

async function addDisplay(page, search, title) {
	await page.locator('.rviz_toolbar').getByRole('button', { name: 'Add display' }).click();
	await page.locator('.add_search').fill(search);
	await page.locator('.widget_entry', { has: page.locator('.card_title', { hasText: new RegExp(`^${title}$`) }) }).first().click();
	await expect(page.locator('.add_dialog')).toHaveCount(0);
}

test('the RViz UI loads with its panels and a connected rosbridge', async ({ page }) => {
	for (const title of ['Displays', '3D View', 'Views', 'Time'])
		await expect(page.locator('.dv-tab', { hasText: title }).first()).toBeVisible();
	await expect(page.locator('canvas').first()).toBeVisible();
});

test('a display added from the Add dialog shows in the list and is saved', async ({ page }) => {
	await addDisplay(page, 'axes', 'Axes');
	await expect(rowByName(page, 'Axes')).toHaveCount(1);
	await page.reload();
	await expect(rowByName(page, 'Axes')).toHaveCount(1);
});

test('groups: a new group holds the display and its switch hides it', async ({ page }) => {
	await addDisplay(page, 'axes', 'Axes');
	const axes = rowByName(page, 'Axes');
	await axes.locator('summary').click({ button: 'right' });
	await page.getByRole('menuitem', { name: 'New group with this display' }).click();
	const group = rowByName(page, 'Group');
	await expect(group).toHaveCount(1);
	await expect(group.locator(':scope > .tree_body > details.tree_item')).toHaveCount(1);
	await group.locator('summary input[type=checkbox]').first().uncheck();
	await expect(rowByName(page, 'Axes')).toHaveClass(/tree_inactive/);
	// its own switch is still on
	await expect(rowByName(page, 'Axes').locator('summary input[type=checkbox]')).toBeChecked();
});

test('widgets: the battery widget sits in the toolbar and opens its panel', async ({ page }) => {
	await addDisplay(page, 'battery', 'Battery');
	const button = page.locator('.rviz_widgets .widget_button[aria-label="Battery"]');
	await expect(button).toBeVisible();
	await button.click();
	await expect(page.locator('.dv-tab', { hasText: 'Battery' })).toBeVisible();
	await expect(page.locator('.widget_panel .readout')).toContainText('Percentage');
	await expect(button).toHaveAttribute('aria-pressed', 'true');
});

test('teleop: keyboard driving publishes, and keys typed in a field do not', async ({ page }) => {
	await addDisplay(page, 'teleop', 'Joystick Teleop');
	const teleop = rowByName(page, 'Joystick Teleop');
	await teleop.locator('summary').click();
	await teleop.locator('.prop_row', { hasText: 'Keyboard driving' }).locator('input').check();
	await expect(page.locator('.teleop_zone')).toBeVisible();
	await page.locator('canvas').first().click({ position: { x: 20, y: 20 } }); // focus out of the form
	await page.keyboard.down('w');
	await page.waitForTimeout(600);
	const driving = await page.evaluate(() => window.vizanti.registry.items.find((i) => i.constructor.type === 'teleop').lastTwist);
	await page.keyboard.up('w');
	expect(driving.linear.x).toBeGreaterThan(0);
	await page.waitForTimeout(1500);
	const stopped = await page.evaluate(() => window.vizanti.registry.items.find((i) => i.constructor.type === 'teleop').lastTwist);
	expect(stopped.linear.x).toBe(0);
	// typing a name does not drive
	await teleop.locator('.prop_row', { hasText: 'Topic' }).first().click();
	await page.locator('.tree_rename, input[type=text]').first().focus();
	await page.keyboard.down('w');
	await page.waitForTimeout(300);
	await page.keyboard.up('w');
	const idle = await page.evaluate(() => window.vizanti.registry.items.find((i) => i.constructor.type === 'teleop').drive.moving);
	expect(idle).toBe(false);
});

test('select tool: dragging a box selects the grid and opens the Selection panel', async ({ page }) => {
	await page.locator('.rviz_toolbar button[data-tool="select"]').click();
	const view = await page.locator('.scene_container').boundingBox();
	const cx = view.x + view.width / 2, cy = view.y + view.height / 2;
	await page.mouse.move(cx - 200, cy - 150);
	await page.mouse.down();
	await page.mouse.move(cx, cy, { steps: 5 });
	await page.mouse.move(cx + 200, cy + 150, { steps: 5 });
	await page.mouse.up();
	await expect(page.locator('.dv-tab', { hasText: 'Selection' })).toBeVisible();
	await expect(page.locator('.selection_panel')).toContainText(/Grid/);
	await page.locator('.selection_panel').getByRole('button', { name: 'Clear' }).click();
	await expect(page.locator('.selection_panel')).toContainText('Nothing selected');
});

test('the touch UI shows the same displays and can switch back', async ({ page }) => {
	await page.getByRole('button', { name: 'Switch to Touch UI' }).click();
	await expect(page.locator('#icon_bar')).toBeVisible();
	const ids = await page.evaluate(() => window.vizanti.registry.items.map((i) => i.id));
	for (const id of ids)
		await expect(page.locator(`#icon_container [data-uniqueid="${id}"]`)).toHaveCount(1);
	await page.locator('[data-uniqueid="switchbutton"] .icon').click();
	await expect(page.locator('.dv-tab', { hasText: 'Displays' })).toBeVisible();
});
