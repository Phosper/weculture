const MAX_COMPANIONS = 20;

function validDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.getUTCFullYear() === year && date.getUTCMonth() + 1 === month && date.getUTCDate() === day;
}

function readPlanMeta(value) {
  if (!value || typeof value !== 'object') return null;
  const departDate = validDate(value.departDate) ? value.departDate : null;
  const companions = Number.isInteger(value.companions) && value.companions >= 0 && value.companions <= MAX_COMPANIONS ? value.companions : null;
  return departDate === null && companions === null ? null : { departDate, companions };
}

function planSessionKey(app, platform) {
  return JSON.stringify([app.globalData.user && app.globalData.user.id || '', platform.getStorageSync('token') || '']);
}

async function changeRoutePlan(api, id, planned, parameters, isCurrent = () => true) {
  const body = { planned };
  if (planned) {
    if (!validDate(parameters.departDate) || !Number.isInteger(parameters.companions) || parameters.companions < 0 || parameters.companions > MAX_COMPANIONS) throw new Error('请检查出发日期与同行人数');
    Object.assign(body, { departDate: parameters.departDate, companions: parameters.companions });
  }
  const result = await api.post(`/travel-routes/${id}/plans`, body);
  if (!isCurrent()) return null;
  if (!result || result.planned !== planned) throw new Error('计划状态暂未确认，请重试');
  const plans = await api.get('/me/plans');
  if (!isCurrent()) return null;
  if (!Array.isArray(plans)) throw new Error('计划状态暂未确认，请重试');
  const saved = plans.find(plan => plan.type === 'route' && plan.id === id);
  const planMeta = saved && readPlanMeta(saved.planMeta);
  if (planned ? !saved || !planMeta || planMeta.departDate === null || planMeta.companions === null : !!saved) throw new Error('计划状态暂未确认，请重试');
  return { planned, planMeta: planned ? planMeta : null };
}

module.exports = { MAX_COMPANIONS, validDate, readPlanMeta, planSessionKey, changeRoutePlan };
