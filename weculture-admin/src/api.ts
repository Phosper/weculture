import axios from 'axios';
const configuredBase = import.meta.env.VITE_API_BASE_URL?.trim().replace(/\/$/, '');
const sameOriginBase = configuredBase === '/api/v1';
if (import.meta.env.PROD && configuredBase && !sameOriginBase && !configuredBase.startsWith('https://')) throw new Error('生产环境 API 地址必须为 /api/v1 或 HTTPS 地址');
const instance = axios.create({ baseURL: configuredBase || (import.meta.env.PROD ? '/api/v1' : 'http://127.0.0.1:3000/api/v1') });
const expiredListeners = new Set<() => void>();
export class ApiError extends Error {
  constructor(message: string, public readonly status?: number) { super(message); this.name = 'ApiError'; }
}
export function onSessionExpired(listener: () => void) { expiredListeners.add(listener); return () => { expiredListeners.delete(listener); }; }
instance.interceptors.request.use((config) => { const token = localStorage.getItem('adminToken'); if (token) config.headers.Authorization = `Bearer ${token}`; return config; });
instance.interceptors.response.use(undefined, (error) => {
  const status = error.response?.status;
  const activeToken = localStorage.getItem('adminToken');
  // A delayed response from an old session must not clear a newly signed-in one.
  if (status === 401 && activeToken && error.config?.headers?.Authorization === `Bearer ${activeToken}`) {
    localStorage.removeItem('adminToken'); expiredListeners.forEach((listener) => listener());
  }
  const detail = error.response?.data?.message;
  return Promise.reject(new ApiError(Array.isArray(detail) ? detail[0] : detail || '网络请求失败，请稍后重试', status));
});
export const client = {
  get: async <T = any>(url: string): Promise<T> => (await instance.get(url)).data.data,
  post: async <T = any>(url: string, data?: any): Promise<T> => (await instance.post(url, data)).data.data,
  patch: async <T = any>(url: string, data?: any): Promise<T> => (await instance.patch(url, data)).data.data,
};
