const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

function metrics(info, capsule) {
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../utils/nav.js'), 'utf8'), {
    module, wx: { getSystemInfoSync: () => info, getMenuButtonBoundingClientRect: () => capsule },
  });
  return module.exports.getNavMetrics();
}

test('narrow Android header reserves the actual capsule width and stays below the status bar', () => {
  const value = metrics({ windowWidth: 360, statusBarHeight: 28 }, { left: 266, top: 34, bottom: 66 });
  assert.equal(value.navRightInset, 106);
  assert.equal(value.navBarHeight, 72);
  assert.equal(value.navContentHeight, 44);
});

test('zero-height status bar and missing capsule still produce a usable header', () => {
  const value = metrics({ windowWidth: 320, statusBarHeight: 0 }, { left: 0, top: 0, bottom: 0 });
  assert.equal(value.statusBarHeight, 0);
  assert.equal(value.navContentHeight, 44);
  assert.equal(value.navRightInset, 100);
});
