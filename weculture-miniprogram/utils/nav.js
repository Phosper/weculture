function getNavMetrics() {
  const info = wx.getSystemInfoSync();
  const statusBarHeight = Number.isFinite(info.statusBarHeight) ? info.statusBarHeight : 24;
  let navBarHeight = statusBarHeight + 44;
  let navRightInset = 100;
  try {
    const capsule = wx.getMenuButtonBoundingClientRect();
    if (capsule && Number.isFinite(capsule.top) && Number.isFinite(capsule.bottom) && capsule.top >= statusBarHeight && capsule.bottom > capsule.top) {
      navBarHeight = capsule.bottom + capsule.top - statusBarHeight;
      if (capsule.left > 0 && capsule.left < info.windowWidth) navRightInset = info.windowWidth - capsule.left + 12;
    }
  } catch (_) { /* simulator fallback */ }
  return { statusBarHeight, navBarHeight, navContentHeight: navBarHeight - statusBarHeight, navRightInset };
}

function selectTab(page, index) {
  page.setData(getNavMetrics());
  if (typeof page.getTabBar === 'function') {
    const tabBar = page.getTabBar();
    if (tabBar) tabBar.setData({ selected: index });
  }
}

module.exports = { getNavMetrics, selectTab };
