const { api } = require('../services/api');
const { normalizeCity, cityFromRegion } = require('./circles');
const { FEATURES } = require('./features');
const LOCATION_SCOPE = 'scope.userFuzzyLocation';

function locationError(message, code) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function checkPrivacy() {
  if (typeof wx.requirePrivacyAuthorize !== 'function') return Promise.resolve();
  return new Promise((resolve, reject) => wx.requirePrivacyAuthorize({
    success: resolve,
    fail: () => reject(locationError('未同意隐私说明，你仍可手动选择城市。', 'LOCATION_PRIVACY'))
  }));
}

function checkPermission() {
  if (typeof wx.getSetting !== 'function') return Promise.resolve();
  return new Promise((resolve, reject) => wx.getSetting({
    success: result => result.authSetting && result.authSetting[LOCATION_SCOPE] === false
      ? reject(locationError('位置权限未开启，可到设置中开启，或手动选择城市。', 'LOCATION_PERMISSION'))
      : resolve(),
    fail: () => reject(locationError('无法检查位置权限，请稍后重试或手动选择城市。', 'LOCATION_UNAVAILABLE'))
  }));
}

function getPosition() {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(locationError('定位超时，请重试或手动选择城市。', 'LOCATION_UNAVAILABLE')), 12000);
    wx.getFuzzyLocation({
      type: 'gcj02',
      success: result => {
        clearTimeout(timer);
        const { latitude, longitude } = result;
        if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || Math.abs(latitude) > 90 || Math.abs(longitude) > 180) {
          reject(locationError('未获取到有效位置，请重试或手动选择城市。', 'LOCATION_UNAVAILABLE'));
          return;
        }
        resolve({ latitude, longitude });
      },
      fail: failure => {
        clearTimeout(timer);
        const denied = /auth.*(deny|denied)|authorize.*fail/i.test(failure && failure.errMsg || '');
        reject(locationError(denied ? '位置权限未开启，可到设置中开启，或手动选择城市。' : '定位失败，请确认手机定位已开启，或手动选择城市。', denied ? 'LOCATION_PERMISSION' : 'LOCATION_UNAVAILABLE'));
      }
    });
  });
}

async function getCurrentCity(isCurrent = () => true) {
  if (!FEATURES.automaticCityLocation) throw locationError('当前版本请手动选择城市。', 'LOCATION_DISABLED');
  const checkCurrent = () => { if (!isCurrent()) throw locationError('定位已取消', 'LOCATION_CANCELLED'); };
  if (typeof wx.getFuzzyLocation !== 'function') throw locationError('当前微信版本不支持城市定位，请更新微信或手动选择城市。', 'LOCATION_UNAVAILABLE');
  await checkPrivacy();
  checkCurrent();
  await checkPermission();
  checkCurrent();
  // Coordinates are used for this request only; never put them in storage or a post.
  const position = await getPosition();
  checkCurrent();
  let result;
  let timer;
  try {
    result = await Promise.race([
      api.post('/location/city', position),
      new Promise((_, reject) => { timer = setTimeout(() => reject(locationError('城市识别超时，请重试或手动选择城市。', 'LOCATION_SERVICE')), 15000); })
    ]);
  } catch (error) {
    if (error.code === 'LOCATION_SERVICE') throw error;
    throw locationError(error.statusCode === 401 ? '登录已失效，请重新登录后定位。' : '暂时无法识别城市，请重试或手动选择城市。', 'LOCATION_SERVICE');
  } finally { clearTimeout(timer); }
  checkCurrent();
  const city = normalizeCity(result && result.city);
  const cityRegion = result && result.region;
  if (!city || city.length > 50 || !Array.isArray(cityRegion) || cityRegion.length !== 3 || cityFromRegion(cityRegion) !== city) {
    throw locationError('当前位置暂时无法识别城市，请手动选择。', 'LOCATION_SERVICE');
  }
  return { city, cityRegion };
}

module.exports = { getCurrentCity, LOCATION_SCOPE };
