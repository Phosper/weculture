const STORAGE_KEY = 'wecultureTypography';
const SERIF_FAMILY = 'WecultureReadingSerif';
const DEFAULT_FAMILY = '"PingFang SC", "Microsoft YaHei", sans-serif';
const FONTS = [
  { id: 'default', label: '默认字体', description: '笔画简洁，适合日常浏览', family: DEFAULT_FAMILY, sample: '文化，让生活多一种可能。' },
  { id: 'serif', label: '宋体风格', description: '中文笔画有粗细，更有书卷气', family: `"${SERIF_FAMILY}", ${DEFAULT_FAMILY}`, sample: '文化，让生活多一种可能。' },
  { id: 'mono', label: '等宽英文', description: '只改变英文与数字，中文保持默认', family: '"SFMono-Regular", Consolas, "Courier New", monospace', sample: 'Weculture · Aa Bb 0123456789' }
];
const SIZES = [
  { id: 'standard', label: '标准', scale: 1 },
  { id: 'large', label: '大', scale: 1.1 },
  { id: 'larger', label: '更大', scale: 1.2 }
];
const previewPreferences = new WeakMap();
let serifStatus = 'idle';
let serifError = '';
let serifPromise;
let fontLoader;

function normalize(value) {
  const source = value && typeof value === 'object' ? value : {};
  return {
    font: FONTS.some(item => item.id === source.font) ? source.font : 'default',
    size: SIZES.some(item => item.id === source.size) ? source.size : 'standard'
  };
}
function readPreferences() {
  try { return normalize(wx.getStorageSync(STORAGE_KEY)); }
  catch (_) { return normalize(); }
}
function typographyData(preferences = readPreferences()) {
  const value = normalize(preferences);
  const font = FONTS.find(item => item.id === value.font);
  const size = SIZES.find(item => item.id === value.size);
  const ready = value.font !== 'serif' || serifStatus === 'ready';
  return {
    typographyPreferences: value,
    typographySummary: `${font.label} · ${size.label}`,
    typographyFontReady: ready,
    serifStatus,
    serifError,
    defaultFontFamily: DEFAULT_FAMILY,
    fontPageStyle: `font-family:${ready ? font.family : DEFAULT_FAMILY};--font-scale:${size.scale};`
  };
}
function renderTypography(target, preferences) {
  target.setData(typographyData(preferences));
  if (typeof target.getTabBar === 'function') {
    const bar = target.getTabBar();
    if (bar) bar.setData(typographyData(preferences));
  }
}
function updateFontStatus(status, error = '') {
  serifStatus = status;
  serifError = error;
  // Preserve the settings page's unsaved preview while the font is loading.
  getCurrentPages().forEach(page => renderTypography(page, previewPreferences.get(page) || readPreferences()));
}
function supportsBundledFont() {
  try {
    const info = typeof wx.getAppBaseInfo === 'function' ? wx.getAppBaseInfo() : wx.getSystemInfoSync();
    const version = String(info.SDKVersion || '').split('.').map(Number);
    const minimum = [3, 7, 9];
    for (let index = 0; index < minimum.length; index += 1) {
      const current = version[index] || 0;
      if (current !== minimum[index]) return current > minimum[index];
    }
    return true;
  } catch (_) { return false; }
}
function ensureSerifFont(retry = false) {
  if (serifStatus === 'ready') return Promise.resolve(true);
  if (serifStatus === 'loading' && serifPromise) return serifPromise;
  if ((serifStatus === 'error' || serifStatus === 'unsupported') && !retry) return Promise.resolve(false);
  if (!supportsBundledFont() || typeof require.async !== 'function') {
    updateFontStatus('unsupported', '当前微信版本暂不支持宋体，请更新微信后再试。');
    return Promise.resolve(false);
  }
  if (!fontLoader) {
    updateFontStatus('error', '宋体暂时加载失败，请重新打开小程序后再试。');
    return Promise.resolve(false);
  }
  updateFontStatus('loading');
  serifPromise = new Promise(resolve => {
    let finished = false;
    const timeout = setTimeout(() => finish(false), 15000);
    function finish(success) {
      if (finished) return;
      finished = true;
      clearTimeout(timeout);
      updateFontStatus(success ? 'ready' : 'error', success ? '' : '宋体暂时加载失败，当前仍显示默认字体。请重试。');
      resolve(success);
    }
    try {
      // Mini programs load a subpackage through require.async; loadSubpackage is a game API.
      require.async('../pages/typography/serif-resource.js').then(resource => {
        if (finished) return;
        try {
          if (resource.family !== SERIF_FAMILY || resource.format !== 'woff2' || !resource.base64) return finish(false);
          // Data URL support starts at 3.7.9. Native font loading does not accept it.
          fontLoader({
            global: true, scopes: ['webview'], family: SERIF_FAMILY,
            source: `url("data:font/woff2;base64,${resource.base64}")`,
            desc: { style: 'normal', weight: 'normal' },
            success: () => finish(true), fail: () => finish(false)
          });
        } catch (_) { finish(false); }
      }, () => finish(false));
    } catch (_) { finish(false); }
  });
  return serifPromise;
}
function initializeTypography(loader) {
  // Register the global loader in App.onLaunch, as required by WeChat.
  fontLoader = loader;
  if (readPreferences().font === 'serif') ensureSerifFont();
}
function applyTypography(target, preferences = readPreferences()) {
  const value = normalize(preferences);
  previewPreferences.set(target, value);
  renderTypography(target, value);
  if (value.font === 'serif') ensureSerifFont();
}
function savePreferences(value) {
  const preferences = normalize(value);
  if (preferences.font === 'serif' && serifStatus !== 'ready') throw new Error(serifError || '宋体还在加载，请稍后再保存。');
  // Commit storage first. A failed save must not change the other pages.
  wx.setStorageSync(STORAGE_KEY, preferences);
  getCurrentPages().forEach(page => applyTypography(page, preferences));
  return preferences;
}
function withTypography(options) {
  const { onLoad, onShow } = options;
  return {
    ...options,
    data: { ...typographyData(), ...options.data },
    onLoad(...args) { applyTypography(this); if (onLoad) return onLoad.apply(this, args); },
    onShow(...args) { applyTypography(this); if (onShow) return onShow.apply(this, args); }
  };
}
module.exports = { FONTS, SIZES, STORAGE_KEY, normalize, readPreferences, typographyData, applyTypography, savePreferences, withTypography, initializeTypography, ensureSerifFont, supportsBundledFont };
