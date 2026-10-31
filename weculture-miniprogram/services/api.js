function getBase() { return getApp().globalData.apiBase; }
function request(method, path, data, auth = true) {
  return new Promise((resolve, reject) => {
    const cloudConfig = getApp().globalData.cloudConfig;
    const token = auth && wx.getStorageSync('token');
    const header = token ? { Authorization: `Bearer ${token}` } : {};
    const retryable = method === 'GET';
    const callbacks = {
      success(res) { const payload = res.data || {}; if (res.statusCode >= 200 && res.statusCode < 300 && payload.code === 'OK') resolve(payload.data); else { const failure = new Error(payload.message || `请求失败（${res.statusCode || '网络异常'}）`); failure.statusCode = res.statusCode; reject(failure); } },
      fail(error) { const message = error && error.errMsg ? error.errMsg : '网络连接失败，请检查服务是否可用'; reject(new Error(message.includes('102002') ? '微信云服务暂时无法连接（102002），请稍后重试' : message)); }
    };

    if (cloudConfig) {
      if (!wx.cloud || typeof wx.cloud.callContainer !== 'function') {
        reject(new Error('当前微信基础库不支持云托管，请升级微信后重试'));
        return;
      }
      const sendCloud = (attempt) => {
        wx.cloud.callContainer({
          config: { env: cloudConfig.env },
          path: `${cloudConfig.pathPrefix}${path}`,
          method,
          data,
          header: { ...header, 'X-WX-SERVICE': cloudConfig.service, 'content-type': 'application/json' },
          success(res) {
            if (retryable && attempt < 3 && [500, 502, 503, 504].includes(res.statusCode)) {
              setTimeout(() => sendCloud(attempt + 1), 500 * (attempt + 1));
              return;
            }
            callbacks.success(res);
          },
          fail(error) {
            if (retryable && attempt < 3) {
              setTimeout(() => sendCloud(attempt + 1), 500 * (attempt + 1));
              return;
            }
            callbacks.fail(error);
          },
          timeout: 15000
        });
      };
      sendCloud(0);
      return;
    }

    wx.request({ url: `${getBase()}${path}`, method, data, header, ...callbacks });
  });
}
exports.api = { get: (path, auth = true) => request('GET', path, undefined, auth), post: (path, data, auth = true) => request('POST', path, data, auth), patch: (path, data) => request('PATCH', path, data), delete: (path) => request('DELETE', path) };
