function getBase() { return getApp().globalData.apiBase; }
function request(method, path, data, auth = true) {
  return new Promise((resolve, reject) => {
    wx.request({
      url: `${getBase()}${path}`, method, data,
      header: auth && wx.getStorageSync('token') ? { Authorization: `Bearer ${wx.getStorageSync('token')}` } : {},
      success(res) { const payload = res.data || {}; if (res.statusCode >= 200 && res.statusCode < 300 && payload.code === 'OK') resolve(payload.data); else reject(new Error(payload.message || `请求失败（${res.statusCode || '网络异常'}）`)); },
      fail() { reject(new Error('网络连接失败，请检查开发服务是否已启动')); }
    });
  });
}
exports.api = { get: (path, auth = true) => request('GET', path, undefined, auth), post: (path, data, auth = true) => request('POST', path, data, auth), patch: (path, data) => request('PATCH', path, data), delete: (path) => request('DELETE', path) };
