const { withTypography } = require('../../utils/typography');
const { api } = require('../../services/api'); const { requireLogin } = require('../../utils/guard'); const { getNavMetrics, selectTab } = require('../../utils/nav');
const { submissionData, reviewInfo } = require('../../utils/publication');
const { CIRCLES, CONTENT_LANGUAGES, normalizeCity, cityFromRegion, readCity, readCityRegion, saveCity } = require('../../utils/circles');
const { getCurrentCity, LOCATION_SCOPE } = require('../../utils/location');
const { FEATURES } = require('../../utils/features');
const pad = (value) => String(value).padStart(2, '0');
const datePart = (date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
const timePart = (date) => `${pad(date.getHours())}:${pad(date.getMinutes())}`;
Page(withTypography({
  data: { ...getNavMetrics(), automaticCityLocationEnabled: FEATURES.automaticCityLocation, user: null, circle: 'campus', circles: CIRCLES, city: '', cityRegion: [], locating: false, locationError: '', locationSettings: false, contentLanguage: 'zh', languageIndex: 0, languages: CONTENT_LANGUAGES, type: 'dynamic', title: '', content: '', tag: '', price: '', location: '', startDate: '', startTime: '', endDate: '', endTime: '', deadlineDate: '', deadlineTime: '', capacity: 30, imageTempPath: '', error: '', submitting: false },
  onLoad() { const start = new Date(Date.now() + 24 * 60 * 60 * 1000); start.setHours(9, 0, 0, 0); const end = new Date(start.getTime() + 3 * 60 * 60 * 1000); const deadline = new Date(start.getTime() - 2 * 60 * 60 * 1000); this.setData({ startDate: datePart(start), startTime: timePart(start), endDate: datePart(end), endTime: timePart(end), deadlineDate: datePart(deadline), deadlineTime: timePart(deadline) }); },
  async onShow() {
    selectTab(this, 2);
    const user = await requireLogin(this);
    if (!user) { this.setData({ user: null }); return; }
    const entry = getApp().globalData.publishEntry;
    delete getApp().globalData.publishEntry;
    const circle = entry && CIRCLES[entry.circle] ? entry.circle : this.data.circle;
    const city = normalizeCity(entry && entry.city) || this.data.city || readCity();
    this.setData({ user, circle: !user.verified && circle === 'campus' && !entry ? 'city' : circle, city, cityRegion: city === this.data.city && this.data.cityRegion.length ? this.data.cityRegion : readCityRegion(city) });
    if (this.publishedResult) { this.publishedResult = null; this.setData({ submitting: false }); }
  },
  selectCircle(e) { const circle = e.currentTarget.dataset.circle; if (!this.data.submitting && CIRCLES[circle]) { this.cancelLocation(); this.setData({ circle, error: '', locationError: '', locationSettings: false }); } },
  chooseCity(e) {
    if (this.data.submitting) return;
    const cityRegion = e.detail.value;
    const city = cityFromRegion(cityRegion);
    if (!city || city.length > 50) { this.setData({ error: '请选择有效的城市' }); return; }
    this.cancelLocation();
    this.setData({ city, cityRegion, error: '', locationError: '', locationSettings: false });
  },
  cancelLocation() { this._locationVersion = (this._locationVersion || 0) + 1; this.setData({ locating: false }); },
  onHide() { this.cancelLocation(); },
  onUnload() { this.cancelLocation(); },
  async locateCity() {
    if (!FEATURES.automaticCityLocation || this.data.locating || this.data.submitting || this.data.circle !== 'city' || !this.data.user) return;
    const version = (this._locationVersion || 0) + 1;
    this._locationVersion = version;
    this.setData({ locating: true, locationError: '', locationSettings: false });
    try {
      const { city, cityRegion } = await getCurrentCity(() => version === this._locationVersion);
      if (version !== this._locationVersion) return;
      this.setData({ city, cityRegion, error: '' });
    } catch (error) {
      if (version === this._locationVersion) this.setData({ locationError: error.message || '定位失败，请手动选择城市。', locationSettings: error.code === 'LOCATION_PERMISSION' });
    } finally { if (version === this._locationVersion) this.setData({ locating: false }); }
  },
  openLocationSettings() {
    if (!FEATURES.automaticCityLocation || this.data.submitting) return;
    wx.openSetting({ success: result => { if (result.authSetting && result.authSetting[LOCATION_SCOPE]) this.locateCity(); } });
  },
  selectLanguage(e) { const languageIndex = Number(e.detail.value); if (!this.data.submitting && CONTENT_LANGUAGES[languageIndex]) this.setData({ languageIndex, contentLanguage: CONTENT_LANGUAGES[languageIndex].value }); },
  verify() { if (!this.data.submitting) wx.navigateTo({ url: '/pages/verify/index' }); },
  selectType(e) { if (!this.data.submitting) this.setData({ type: e.currentTarget.dataset.type }); }, input(e) { if (!this.data.submitting) this.setData({ [e.currentTarget.dataset.field]: e.detail.value }); }, pick(e) { if (!this.data.submitting) this.setData({ [e.currentTarget.dataset.field]: e.detail.value }); },
  chooseImage() { if (this.data.submitting) return; wx.chooseMedia({ count: 1, mediaType: ['image'], sourceType: ['album', 'camera'], success: (result) => { if (!this.data.submitting && result.tempFiles && result.tempFiles[0]) this.setData({ imageTempPath: result.tempFiles[0].tempFilePath }); } }); },
  removeImage() { if (!this.data.submitting) this.setData({ imageTempPath: '' }); },
  async uploadImage(imageTempPath) {
    if (!imageTempPath) return '';
    if (!getApp().globalData.cloudConfig || !wx.cloud || typeof wx.cloud.uploadFile !== 'function') throw new Error('当前环境尚未配置图片存储，请移除图片后提交');
    const cloudPath = `weculture/posts/${Date.now()}-${Math.random().toString(36).slice(2, 9)}.jpg`;
    const result = await new Promise((resolve, reject) => wx.cloud.uploadFile({ cloudPath, filePath: imageTempPath, success: resolve, fail: () => reject(new Error('图片上传失败，请检查网络后重试')) }));
    if (!result.fileID) throw new Error('图片上传未完成，请重试');
    return result.fileID;
  },
  async submit() {
    if (this.data.submitting || this.data.locating) return;
    if (this.publishedResult) { this.showResult(this.publishedResult); return; }
    this.setData({ error: '', submitting: true });
    try {
      const user = getApp().globalData.user;
      if (!user) throw new Error('请先登录');
      if (this.data.circle === 'campus' && !user.verified) throw new Error('发布校园圈内容前，请先完成学校认证');
      const data = submissionData(this.data);
      const imageTempPath = this.data.imageTempPath;
      const storageKey = `postSubmission:${user.id}`;
      const fingerprint = JSON.stringify({ ...data, imageTempPath });
      let attempt = wx.getStorageSync(storageKey);
      if (!attempt || attempt.fingerprint !== fingerprint) {
        attempt = { fingerprint, clientRequestId: `post_${Date.now()}_${Math.random().toString(36).slice(2, 12)}` };
        wx.setStorageSync(storageKey, attempt);
      }
      if (attempt.imageUrl === undefined) {
        attempt.imageUrl = await this.uploadImage(imageTempPath);
        wx.setStorageSync(storageKey, attempt);
      }
      const result = await api.post('/posts', { ...data, imageUrl: attempt.imageUrl, clientRequestId: attempt.clientRequestId });
      if (!result || !result.id || !['pending', 'approved', 'rejected', 'offline'].includes(result.status)) throw new Error('暂未确认投稿结果，请重试或到“我的投稿”查看');
      wx.removeStorageSync(storageKey);
      this.publishedResult = result;
      this.publishedCircle = { circle: result.circle || data.circle, city: result.city || data.city || '' };
      if (data.circle === 'city') { try { saveCity(data.city, this.data.cityRegion); } catch (_) {} }
      this.setData({ title: '', content: '', tag: '', price: '', location: '', imageTempPath: '' });
      this.showResult(result);
    } catch (error) { this.setData({ error: error.message || '提交失败，请检查网络后重试', submitting: false }); }
  },
  showResult(result) {
    const approved = result.status === 'approved';
    const target = this.publishedCircle || { circle: result.circle || this.data.circle, city: result.city || this.data.city };
    const label = CIRCLES[target.circle].label;
    const visibility = target.circle === 'campus' ? '仅本校认证成员可见。' : '内容公开可见。';
    const pendingMessage = result.status === 'pending' ? `投稿已保存，审核通过后将展示在${label}。可在“我的投稿”查看最新审核结果。` : `投稿已保存。${reviewInfo(result).statusHint}请到“我的投稿”查看审核原因。`;
    wx.showModal({ title: approved ? '发布成功' : reviewInfo(result).statusLabel, content: approved ? `内容已发布到${label}，${visibility}` : pendingMessage, confirmText: approved ? `查看${label}` : '查看我的投稿', showCancel: false,
      success: () => {
        const app = getApp();
        if (approved) app.globalData.communityEntry = { ...target, type: 'all' };
        else app.globalData.profileEntry = { tab: 'notes' };
        wx.switchTab({ url: approved ? '/pages/community/index' : '/pages/profile/index', fail: () => this.setData({ submitting: false, error: '跳转失败，请点击下方按钮重试' }) });
      },
      fail: () => this.setData({ submitting: false, error: '投稿已保存，请到“我的投稿”查看结果' })
    });
  }
}));
