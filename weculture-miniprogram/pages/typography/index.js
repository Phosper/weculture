const { FONTS, SIZES, readPreferences, normalize, applyTypography, savePreferences, withTypography, ensureSerifFont } = require('../../utils/typography');

Page(withTypography({
  data: { fonts: FONTS, sizes: SIZES, draft: normalize(), error: '' },
  onShow() { const draft = readPreferences(); this.setData({ draft, error: '' }); applyTypography(this, draft); ensureSerifFont(); },
  chooseFont(event) { this.preview({ ...this.data.draft, font: event.currentTarget.dataset.id }); },
  chooseSize(event) { this.preview({ ...this.data.draft, size: event.currentTarget.dataset.id }); },
  preview(value) { const draft = normalize(value); this.setData({ draft, error: '' }); applyTypography(this, draft); },
  retryFont() { ensureSerifFont(true); },
  reset() { this.preview(normalize()); },
  save() {
    try { const draft = savePreferences(this.data.draft); this.setData({ draft, error: '' }); wx.showToast({ title: '字体设置已保存', icon: 'success' }); }
    catch (error) { this.setData({ error: !this.data.typographyFontReady ? error.message : '保存失败，请重试。其他页面仍使用之前的设置。' }); }
  }
}));
