const { withTypography } = require('../../utils/typography');
const { api } = require('../../services/api');
const { requireLogin } = require('../../utils/guard');
const { formatRoute } = require('../../utils/format');
const { getNavMetrics, selectTab } = require('../../utils/nav');
const { MAX_COMPANIONS, readPlanMeta, planSessionKey, changeRoutePlan } = require('../../utils/route-planning');

function tomorrowDate() {
  const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000);
  return `${tomorrow.getFullYear()}-${String(tomorrow.getMonth() + 1).padStart(2, '0')}-${String(tomorrow.getDate()).padStart(2, '0')}`;
}

Page(withTypography({
  data: { ...getNavMetrics(), destination: '', days: '', departDate: tomorrowDate(), minDate: tomorrowDate(), budget: 'all', companions: 0, maxCompanions: MAX_COMPANIONS, preferences: ['文化'], routes: [], plannerOpen: false, loading: false, error: '', planBusyId: '', planErrorId: '', planError: '', retryPlanned: false, options: [{ label: '文化', selected: true }, { label: '美食', selected: false }, { label: '自然', selected: false }, { label: '艺术', selected: false }], budgets: [{ key: 'all', label: '不限' }, { key: '1000', label: '¥1000 内' }, { key: '2000', label: '¥2000 内' }] },
  async onShow() {
    this._visible = true;
    const version = this._viewVersion = (this._viewVersion || 0) + 1;
    selectTab(this, 3);
    this.syncSession();
    const user = await requireLogin(this);
    if (!user || !this.isCurrentView(version)) return;
    this.syncSession();
    this.setData({ planBusyId: this._planOperation && this._planOperation.session === this._session ? this._planOperation.id : '' });
    return this.recommend();
  },
  onHide() {
    this._visible = false;
    this._viewVersion = (this._viewVersion || 0) + 1;
    this._recommendVersion = (this._recommendVersion || 0) + 1;
    this.setData({ loading: false, planBusyId: '' });
  },
  onUnload() { this.onHide(); },
  syncSession() {
    const session = planSessionKey(getApp(), wx);
    if (this._session !== undefined && this._session !== session) {
      // Requests already sent carry their original token; their callbacks are isolated below.
      this._planOperation = null;
      this._planRetry = null;
      this._recommendVersion = (this._recommendVersion || 0) + 1;
      this.setData({ routes: [], destination: '', days: '', budget: 'all', companions: 0, departDate: tomorrowDate(), minDate: tomorrowDate(), planBusyId: '', planErrorId: '', planError: '', error: '', loading: false });
    }
    this._session = session;
  },
  isCurrentView(version, session) { return this._visible !== false && version === this._viewVersion && (session === undefined || session === planSessionKey(getApp(), wx)); },
  input(e) { this.setData({ destination: e.detail.value }); },
  chooseDays(e) { this.setData({ days: this.data.days === e.currentTarget.dataset.days ? '' : e.currentTarget.dataset.days }); },
  chooseBudget(e) { this.setData({ budget: e.currentTarget.dataset.budget }); },
  pickDate(e) { this.setData({ departDate: e.detail.value }); },
  changeCompanions(e) { this.setData({ companions: Math.min(MAX_COMPANIONS, Math.max(0, this.data.companions + Number(e.currentTarget.dataset.delta))) }); },
  togglePlanner() { this.setData({ plannerOpen: !this.data.plannerOpen }); },
  chooseShortcut(e) {
    const preference = e.currentTarget.dataset.preference;
    this.setData({ preferences: [preference], options: this.data.options.map(option => ({ ...option, selected: option.label === preference })) });
    return this.recommend();
  },
  togglePreference(e) {
    const value = e.currentTarget.dataset.value;
    const preferences = this.data.preferences.includes(value) ? this.data.preferences.filter(x => x !== value) : [...this.data.preferences, value];
    this.setData({ preferences, options: this.data.options.map(option => ({ ...option, selected: preferences.includes(option.label) })) });
  },
  async recommend() {
    if (this._visible === false) return;
    const version = this._recommendVersion = (this._recommendVersion || 0) + 1;
    const viewVersion = this._viewVersion;
    const session = planSessionKey(getApp(), wx);
    const filters = { destination: this.data.destination, days: this.data.days, preferences: this.data.preferences.slice(), budget: this.data.budget };
    const isCurrent = () => version === this._recommendVersion && this.isCurrentView(viewVersion, session);
    this.setData({ loading: true, error: '' });
    try {
      const [routes, plans] = await Promise.all([
        api.post('/travel-routes/recommendations', { destination: filters.destination, days: filters.days, preferences: filters.preferences }),
        api.get('/me/plans')
      ]);
      if (!isCurrent()) return;
      const routePlans = new Map(plans.filter(plan => plan.type === 'route').map(plan => [plan.id, plan]));
      this.setData({ routes: routes.filter(route => filters.budget === 'all' || route.budget <= Number(filters.budget)).map(route => formatRoute({ ...route, planned: routePlans.has(route.id), planMeta: readPlanMeta((routePlans.get(route.id) || {}).planMeta) })) });
    } catch (error) { if (isCurrent()) this.setData({ error: error.message || '路线加载失败，请重试' }); }
    finally { if (isCurrent()) this.setData({ loading: false }); }
  },
  async plan(e) {
    const id = e.currentTarget.dataset.id;
    const route = this.data.routes.find(item => item.id === id);
    if (this._planOperation || this.data.loading || !route || this._visible === false) return;
    const retry = this._planRetry && this._planRetry.id === id ? this._planRetry : null;
    const operation = { id, planned: retry ? retry.planned : !route.planned, parameters: retry ? retry.parameters : { departDate: this.data.departDate, companions: this.data.companions }, version: this._viewVersion, session: planSessionKey(getApp(), wx) };
    const isCurrent = () => this.isCurrentView(operation.version, operation.session);
    this._planOperation = operation;
    this.setData({ planBusyId: id, planErrorId: '', planError: '' });
    try {
      const result = await changeRoutePlan(api, id, operation.planned, operation.parameters, isCurrent);
      if (!result || !isCurrent()) return;
      // An older recommendation may still contain the state from before this save.
      this._recommendVersion = (this._recommendVersion || 0) + 1;
      this._planRetry = null;
      this.setData({ routes: this.data.routes.map(item => item.id === id ? { ...item, ...result } : item), loading: false });
      wx.showToast({ title: result.planned ? '已加入我的计划' : '已移出计划', icon: 'none' });
    } catch (error) {
      if (isCurrent()) {
        this._planRetry = { id, planned: operation.planned, parameters: operation.parameters };
        this.setData({ planErrorId: id, planError: error.message || '保存失败，请重试', retryPlanned: operation.planned });
      }
    } finally {
      if (this._planOperation === operation) {
        this._planOperation = null;
        if (this._visible !== false && operation.session === planSessionKey(getApp(), wx)) {
          this.setData({ planBusyId: '' });
          if (this._viewVersion !== operation.version) this.recommend();
        }
      }
    }
  }
}));
