import axios from 'axios';
const instance = axios.create({ baseURL: 'http://127.0.0.1:3000/api/v1' });
instance.interceptors.request.use((config) => { const token = localStorage.getItem('adminToken'); if (token) config.headers.Authorization = `Bearer ${token}`; return config; });
instance.interceptors.response.use(undefined, (error) => Promise.reject(new Error(error.response?.data?.message || '网络请求失败')));
export const client = {
  get: async <T = any>(url: string): Promise<T> => (await instance.get(url)).data.data,
  post: async <T = any>(url: string, data?: any): Promise<T> => (await instance.post(url, data)).data.data,
};
