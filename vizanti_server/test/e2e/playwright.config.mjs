import { defineConfig } from '@playwright/test';

// Runs against a Vizanti server that is already up (with rosbridge), by default the one
// `ros2 launch vizanti_server vizanti_server.launch.py` starts. See README.md.
export default defineConfig({
	testDir: '.',
	testMatch: '*.spec.mjs',
	timeout: 60000,
	retries: process.env.CI ? 1 : 0,
	workers: 1, // they share one rosbridge
	reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
	use: {
		baseURL: process.env.VIZANTI_URL ?? 'http://localhost:5000',
		viewport: { width: 1440, height: 900 },
		trace: 'retain-on-failure',
		screenshot: 'only-on-failure',
	},
});
