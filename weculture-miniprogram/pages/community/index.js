const { withTypography } = require('../../utils/typography');
const { api } = require('../../services/api');
const { requireLogin } = require('../../utils/guard');
const { formatPost } = require('../../utils/format');
const { getNavMetrics, selectTab } = require('../../utils/nav');
const { CIRCLES, normalizeCity, cityFromRegion, readCity, readCityRegion, saveCity } = require('../../utils/circles');
const { getCurrentCity, LOCATION_SCOPE } = require('../../utils/location');
const { FEATURES } = require('../../utils/features');

const TYPES = ['all', 'dynamic', 'event', 'market'];
const EVENT_TIMES = [
  { key: 'all', label: '全部时间' }, { key: 'upcoming', label: '尚未开始' },
  { key: 'today', label: '今天' }, { key: 'week', label: '近7天' }
];

Page(withTypography({
  data: { ...getNavMetrics(), automaticCityLocationEnabled: FEATURES.automaticCityLocation, circle: 'city', circleInfo: CIRCLES.city, city: '', cityRegion: [], locating: false, locationError: '', locationSettings: false, posts: [], type: 'all', eventTime: 'all', eventTimes: EVENT_TIMES, page: 0, hasMore: false, loading: false, error: '', user: null, filters: [{ key: 'all', label: '全部' }, { key: 'dynamic', label: '动态' }, { key: 'event', label: '活动' }, { key: 'market', label: '闲置' }] },
  async onShow() {
    const version = this._showVersion = (this._showVersion || 0) + 1;
    this._requestVersion = (this._requestVersion || 0) + 1;
    this.cancelLocation();
    this.setData({ posts: [], page: 0, hasMore: false, loading: false });
    selectTab(this, 1);
    const user = await requireLogin(this);
    if (version !== this._showVersion) return;
    if (!user) { this.setData({ user: null, circle: 'city', circleInfo: CIRCLES.city, type: 'all', eventTime: 'all', locationError: '', locationSettings: false }); return; }
    const entry = getApp().globalData.communityEntry;
    delete getApp().globalData.communityEntry;
    const city = normalizeCity(entry && entry.city) || readCity();
    const changedAccount = this.data.user && this.data.user.id !== user.id;
    this.setData({ user, city, cityRegion: readCityRegion(city), ...(changedAccount ? { circle: 'city', circleInfo: CIRCLES.city, type: 'all', eventTime: 'all', locationError: '', locationSettings: false } : {}), ...(entry && CIRCLES[entry.circle] ? { circle: entry.circle, circleInfo: CIRCLES[entry.circle], type: TYPES.includes(entry.type) ? entry.type : 'all', eventTime: 'all' } : {}) });
    return this.load();
  },
  async load(reset = true) {
    if (!reset && (this.data.loading || !this.data.hasMore)) return;
    const version = reset ? (this._requestVersion || 0) + 1 : this._requestVersion;
    this._requestVersion = version;
    const { circle, city, type, user, eventTime } = this.data;
    const page = reset ? 1 : this.data.page + 1;
    this.setData({ loading: true, error: '', ...(reset ? { posts: [], page: 0, hasMore: false } : {}) });
    try {
      if (!user || (circle === 'campus' && !user.verified) || (circle === 'city' && !city)) return;
      const query = [`circle=${circle}`, `page=${page}`, 'pageSize=20'];
      if (circle === 'city') query.push(`city=${encodeURIComponent(city)}`);
      if (type !== 'all') query.push(`type=${type}`);
      if (type === 'event' && eventTime !== 'all') query.push(`eventTime=${eventTime}`);
      const result = await api.get(`/posts?${query.join('&')}`);
      if (version !== this._requestVersion) return;
      if (!result || !Array.isArray(result.items)) throw new Error('圈层内容暂时无法加载，请稍后重试');
      const items = result.items.map(formatPost);
      const posts = reset ? items : this.data.posts.concat(items.filter(item => !this.data.posts.some(post => post.id === item.id)));
      this.setData({ posts, page, hasMore: !!result.hasMore });
    } catch (error) { if (version === this._requestVersion) this.setData({ error: error.message || '加载失败，请重试' }); }
    finally { if (version === this._requestVersion) this.setData({ loading: false }); }
  },
  changeCircle(e) { const circle = e.currentTarget.dataset.circle; if (!CIRCLES[circle] || circle === this.data.circle) return; this.cancelLocation(); this.setData({ circle, circleInfo: CIRCLES[circle], type: 'all', eventTime: 'all', locationError: '', locationSettings: false }); return this.load(); },
  changeType(e) {
    const type = e.currentTarget.dataset.type;
    if (!TYPES.includes(type) || type === this.data.type) return;
    this.setData({ type, ...(type !== 'event' ? { eventTime: 'all' } : {}) });
    return this.load();
  },
  changeEventTime(e) {
    const eventTime = e.currentTarget.dataset.eventTime;
    if (this.data.type !== 'event' || !EVENT_TIMES.some(item => item.key === eventTime) || eventTime === this.data.eventTime) return;
    this.setData({ eventTime });
    return this.load();
  },
  chooseCity(e) {
    const cityRegion = e.detail.value;
    const city = cityFromRegion(cityRegion);
    if (!city || city.length > 50) { this.setData({ error: '请选择有效的城市' }); return; }
    this.cancelLocation();
    try { saveCity(city, cityRegion); }
    catch (_) { this.setData({ error: '城市选择未保存，请重试' }); return; }
    this.setData({ city, cityRegion, locationError: '', locationSettings: false });
    return this.load();
  },
  cancelLocation() { this._locationVersion = (this._locationVersion || 0) + 1; this.setData({ locating: false }); },
  onHide() { this._showVersion = (this._showVersion || 0) + 1; this._requestVersion = (this._requestVersion || 0) + 1; this.cancelLocation(); this.setData({ loading: false }); },
  onUnload() { this.onHide(); },
  async locateCity() {
    if (!FEATURES.automaticCityLocation || this.data.locating || this.data.circle !== 'city' || !this.data.user) return;
    const version = (this._locationVersion || 0) + 1;
    this._locationVersion = version;
    this.setData({ locating: true, locationError: '', locationSettings: false });
    try {
      const { city, cityRegion } = await getCurrentCity(() => version === this._locationVersion);
      if (version !== this._locationVersion) return;
      try { saveCity(city, cityRegion); }
      catch (_) { throw new Error('城市未保存，请重试或手动选择。'); }
      this.setData({ city, cityRegion });
      return await this.load();
    } catch (error) {
      if (version === this._locationVersion) this.setData({ locationError: error.message || '定位失败，请手动选择城市。', locationSettings: error.code === 'LOCATION_PERMISSION' });
    } finally { if (version === this._locationVersion) this.setData({ locating: false }); }
  },
  openLocationSettings() {
    if (!FEATURES.automaticCityLocation) return;
    wx.openSetting({ success: result => { if (result.authSetting && result.authSetting[LOCATION_SCOPE]) this.locateCity(); } });
  },
  loadMore() { return this.load(false); },
  retry() { return this.load(this.data.page === 0); },
  onReachBottom() { return this.loadMore(); },
  async onPullDownRefresh() { try { await this.load(); } finally { wx.stopPullDownRefresh(); } },
  publish() { getApp().globalData.publishEntry = { circle: this.data.circle, city: this.data.city }; wx.switchTab({ url: '/pages/publish/index' }); },
  verify() { wx.navigateTo({ url: '/pages/verify/index' }); }
}));
