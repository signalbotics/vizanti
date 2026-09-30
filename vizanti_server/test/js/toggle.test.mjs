import test from 'node:test';
import assert from 'node:assert/strict';
import { chooseShell, UI_KEY } from '../../public/js/ui/toggle.js';

const desktop = { query: "", stored: null, width: 1600, coarsePointer: false };

test('the choice is remembered under its own storage key', () => {
	assert.equal(UI_KEY, "vizanti_ui");
});

test('first visit: wide screen with a mouse gets the RViz UI', () => {
	assert.equal(chooseShell(desktop), "rviz");
});

test('first visit: a narrow screen or a touch pointer gets the touch UI', () => {
	assert.equal(chooseShell({ ...desktop, width: 600 }), "touch");
	assert.equal(chooseShell({ ...desktop, coarsePointer: true }), "touch");
});

test('a remembered choice beats the device guess', () => {
	assert.equal(chooseShell({ ...desktop, stored: "touch" }), "touch");
	assert.equal(chooseShell({ ...desktop, width: 400, stored: "rviz" }), "rviz");
});

test('the URL parameter beats everything', () => {
	assert.equal(chooseShell({ ...desktop, stored: "rviz", query: "?ui=touch" }), "touch");
	assert.equal(chooseShell({ ...desktop, width: 400, stored: "touch", query: "?a=1&ui=rviz" }), "rviz");
});

test('unknown values are ignored', () => {
	assert.equal(chooseShell({ ...desktop, query: "?ui=fancy" }), "rviz");
	assert.equal(chooseShell({ ...desktop, stored: "fancy", width: 400 }), "touch");
});
