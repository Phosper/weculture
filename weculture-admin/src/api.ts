import axios from 'axios';
const configuredBase = import.meta.env.VITE_API_BASE_URL?.replace(/\/$/, '');
if (import.meta.env.PROD && (!configuredBase || !configuredBase.startsWith('https://'))) throw new Error('生产环境必须配置 HTTPS VITE_API_BASE_URL');
const instance = axios.create({ baseURL: configuredBase || 'http://127.0.0.1:3000/api/v1' });
instance.interceptors.request.use((config) => { const token = localStorage.getItem('adminToken'); if (token) config.headers.Authorization = `Bearer ${token}`; return config; });
instance.interceptors.response.use(undefined, (error) => Promise.reject(new Error(error.response?.data?.message || '网络请求失败')));
export const client = {
  get: async <T = any>(url: string): Promise<T> => (await instance.get(url)).data.data,
  post: async <T = any>(url: string, data?: any): Promise<T> => (await instance.post(url, data)).data.data,
};
