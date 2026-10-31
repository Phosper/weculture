const CITY_STORAGE_KEY = 'wecultureCity';
const CITY_REGION_STORAGE_KEY = 'wecultureCityRegion';
const CIRCLES = {
  city: { title: '同城动态', label: '同城', subtitle: '发现同一座城市的文化生活', notice: '审核通过后公开展示在所选城市。' },
  international: { title: '国际圈动态', label: '国际圈', subtitle: '一起认识世界', notice: '审核通过后公开展示在国际圈。' },
  campus: { title: '校园圈动态', label: '校园圈', subtitle: '本校生活互助', notice: '仅本校认证成员可见。' }
};
const CONTENT_LANGUAGES = [
  { value: 'zh', label: '中文' }, { value: 'en', label: 'English' },
  { value: 'ru', label: 'Русский' }, { value: 'fr', label: 'Français' },
  { value: 'es', label: 'Español' }, { value: 'ar', label: 'العربية' },
  { value: 'other', label: '其他语言' }
];
function normalizeCity(value) { return typeof value === 'string' ? value.trim().replace(/市$/, '') : ''; }
function cityFromRegion(region) {
  if (!Array.isArray(region) || region.length < 2 || !region.every(value => typeof value === 'string')) return '';
  const province = region[0];
  if (['北京市', '天津市', '上海市', '重庆市'].includes(province)) return normalizeCity(province);
  if (province === '香港特别行政区') return '香港';
  if (province === '澳门特别行政区') return '澳门';
  const city = /^(省|自治区)直辖/.test(region[1]) ? region[2] : region[1];
  return normalizeCity(city);
}
function readCityRegion(city) {
  try {
    const region = wx.getStorageSync(CITY_REGION_STORAGE_KEY);
    if (city && cityFromRegion(region) === normalizeCity(city)) return region;
  } catch (_) {}
  const name = normalizeCity(city);
  return ['北京', '天津', '上海', '重庆'].includes(name) ? [`${name}市`, `${name}市`, ''] : [];
}
function saveCity(city, region) {
  if (cityFromRegion(region) === normalizeCity(city)) wx.setStorageSync(CITY_REGION_STORAGE_KEY, region);
  wx.setStorageSync(CITY_STORAGE_KEY, normalizeCity(city));
}
function readCity() {
  try { const city = normalizeCity(wx.getStorageSync(CITY_STORAGE_KEY)); return city.length <= 50 ? city : ''; }
  catch (_) { return ''; }
}
function circleLabel(post) {
  const circle = post.circle || (post.scope === 'school' ? 'campus' : '');
  if (circle === 'city') return `同城${post.city ? ' · ' + normalizeCity(post.city) : ''}`;
  if (circle === 'international') {
    const language = CONTENT_LANGUAGES.find(item => item.value === post.contentLanguage);
    return `国际圈${language ? ' · ' + language.label : ''}`;
  }
  return circle === 'campus' ? '校园圈 · 仅本校可见' : '平台精选';
}
module.exports = { CITY_STORAGE_KEY, CITY_REGION_STORAGE_KEY, CIRCLES, CONTENT_LANGUAGES, normalizeCity, cityFromRegion, readCity, readCityRegion, saveCity, circleLabel };
