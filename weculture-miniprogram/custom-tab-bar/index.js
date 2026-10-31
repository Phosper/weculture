const { typographyData, applyTypography } = require('../utils/typography');
Component({
  lifetimes: { attached() { applyTypography(this); } },
  pageLifetimes: { show() { applyTypography(this); } },
  data: {
    ...typographyData(),
    selected: 0,
    tabs: [
      { pagePath: '/pages/home/index', text: '发现', icon: 'discover' },
      { pagePath: '/pages/community/index', text: '社区', icon: 'community' },
      { pagePath: '/pages/publish/index', text: '发布' },
      { pagePath: '/pages/travel/index', text: '旅行', icon: 'travel' },
      { pagePath: '/pages/profile/index', text: '我的', icon: 'profile' }
    ]
  },
  methods: {
    switchTab(event) {
      const index = Number(event.currentTarget.dataset.index);
      if (index === this.data.selected) return;
      wx.switchTab({ url: this.data.tabs[index].pagePath });
    }
  }
});
