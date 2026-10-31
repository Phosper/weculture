import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { AuditOutlined, BookOutlined, DashboardOutlined, FlagOutlined, KeyOutlined, LogoutOutlined, MessageOutlined, SafetyCertificateOutlined, TeamOutlined } from '@ant-design/icons';
import { Alert, App as AntApp, Button, Card, Col, ConfigProvider, Form, Input, Layout, Menu, Modal, Row, Select, Space, Statistic, Table, Tag, Typography, message } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import { ApiError, client, onSessionExpired } from './api';
import { Posts, type Admin } from './posts';
import { Reports } from './reports';
import './style.css';

const reviewScope = import.meta.env.VITE_ADMIN_SCOPE === 'review';

function Login({ onLogin, notice }: { onLogin: (admin: Admin) => void; notice?: string }) {
  const [loading, setLoading] = useState(false);
  const [loginError, setLoginError] = useState('');
  const demoLogin = import.meta.env.DEV ? { username: 'admin', password: 'Weculture@2026' } : undefined;
  const submit = async (values: { username: string; password: string }) => {
    if (loading) return;
    setLoading(true); setLoginError('');
    try { const result = await client.post('/admin/auth/login', values); localStorage.setItem('adminToken', result.token); setLoginError(''); onLogin(result.admin); }
    catch (error) { setLoginError(error instanceof ApiError ? error.message : '登录未完成，请稍后重试'); }
    finally { setLoading(false); }
  };
  return <main className="login"><section className="login-art"><div className="brand">Weculture</div><h1>让文化交流<br />有序发生</h1><p>{reviewScope ? '线上投稿审核' : '同城、国际与校园文化运营后台'}</p></section><Card className="login-card" bordered={false}><Typography.Title level={3}>管理员登录</Typography.Title><Typography.Paragraph type="secondary">使用学校或平台管理员账号进入。{reviewScope && '登录后查看权限范围内的真实投稿。'}</Typography.Paragraph>{notice && <Alert className="session-note" message={notice} type="info" showIcon />}<Form layout="vertical" onFinish={submit} initialValues={demoLogin}><Form.Item name="username" label="账号" rules={[{ required: true }]}><Input size="large" autoComplete="username" /></Form.Item><Form.Item name="password" label="密码" rules={[{ required: true }]}><Input.Password size="large" autoComplete="current-password" /></Form.Item>{loginError && <Alert className="session-note" message={loginError} type="error" showIcon />}<Button htmlType="submit" type="primary" size="large" block loading={loading}>登录后台</Button></Form>{import.meta.env.DEV && <Alert className="login-note" message="本地演示账号已预填，生产构建不会包含这些登录信息。" type="info" showIcon />}</Card></main>;
}

function Dashboard() {
  const [data, setData] = useState<any>(); const [error, setError] = useState('');
  const load = useCallback(async () => { setError(''); try { setData(await client.get('/admin/dashboard')); } catch (failure) { setError((failure as Error).message); } }, []);
  useEffect(() => { void load(); }, [load]);
  if (!data) return error ? <Alert type="error" showIcon message="运营概览读取失败" description={error} action={<Button onClick={() => void load()}>重试</Button>} /> : <div className="loading">正在读取运营概览...</div>;
  return <><Typography.Title level={2}>运营工作台</Typography.Title><Typography.Paragraph type="secondary">优先处理待审核内容和举报，所有管理操作均会记录审计日志。</Typography.Paragraph><Row gutter={[18, 18]}><Metric title="待审核内容" value={data.pendingPosts} tone="orange" /><Metric title="待处理举报" value={data.pendingReports ?? 0} tone="orange" /><Metric title="已发布内容" value={data.approvedPosts} tone="green" /><Metric title="认证成员" value={data.users} tone="blue" /><Metric title="进行中活动" value={data.activeEvents} tone="brown" /></Row><Card title="近期管理操作" className="table-card"><Table size="middle" pagination={false} dataSource={data.recentAudits} rowKey="id" columns={[{ title: '时间', dataIndex: 'createdAt', render: (x: string) => new Date(x).toLocaleString() }, { title: '操作', dataIndex: 'action' }, { title: '资源', render: (_: unknown, r: any) => `${r.resourceType} / ${r.resourceId.slice(0, 8)}` }, { title: '结果', dataIndex: 'result', render: (x: string) => <Tag color="green">{x}</Tag> }]} /></Card></>;
}
function Metric({ title, value, tone }: { title: string; value: number; tone: string }) { return <Col xs={24} sm={12} lg={6}><Card className={`metric ${tone}`}><Statistic title={title} value={value} /></Card></Col>; }

function Invites() {
  const [rows, setRows] = useState<any[]>([]); const [form] = Form.useForm(); const load = () => client.get<any[]>('/admin/invites').then(setRows).catch((e) => message.error(e.message)); useEffect(() => { void load(); }, []); const create = async (values: any) => { try { const result = await client.post<any>('/admin/invites', values); message.success(`邀请码 ${result.code} 已创建`); form.resetFields(); void load(); } catch (e) { message.error((e as Error).message); } };
  return <><Typography.Title level={2}>邀请码与成员认证</Typography.Title><Row gutter={18}><Col xs={24} lg={8}><Card title="生成邀请码"><Form form={form} layout="vertical" onFinish={create} initialValues={{ batchName: '内测用户', maxUses: 10 }}><Form.Item name="batchName" label="批次名称" rules={[{ required: true }]}><Input /></Form.Item><Form.Item name="maxUses" label="可使用次数" rules={[{ required: true }]}><Input type="number" /></Form.Item><Form.Item name="expiresAt" label="有效期（可选）"><Input placeholder="2026-12-31" /></Form.Item><Button htmlType="submit" type="primary">生成邀请码</Button></Form></Card></Col><Col xs={24} lg={16}><Card title="邀请码列表"><Table dataSource={rows} rowKey="id" pagination={false} columns={[{ title: '邀请码', dataIndex: 'code', render: (x) => <Typography.Text code>{x}</Typography.Text> }, { title: '批次', dataIndex: 'batchName' }, { title: '使用量', render: (_, r) => `${r.usedCount} / ${r.maxUses}` }, { title: '有效期', dataIndex: 'expiresAt', render: (x) => x ? new Date(x).toLocaleDateString() : '长期有效' }, { title: '状态', dataIndex: 'status', render: (x) => <Tag color="green">{x === 'active' ? '有效' : '已作废'}</Tag> }]} /></Card></Col></Row></>;
}

function ResourceManager({ kind }: { kind: 'route' | 'knowledge' }) {
  const isRoute = kind === 'route'; const endpoint = isRoute ? '/admin/routes' : '/admin/knowledge'; const [rows, setRows] = useState<any[]>([]); const [form] = Form.useForm(); const load = () => client.get<any[]>(endpoint).then(setRows).catch((e) => message.error(e.message)); useEffect(() => { void load(); }, [endpoint]); const submit = async (values: any) => { try { await client.post(endpoint, values); message.success(isRoute ? '路线已创建' : '知识答复已创建'); form.resetFields(); void load(); } catch (e) { message.error((e as Error).message); } };
  return <><Typography.Title level={2}>{isRoute ? '旅行路线管理' : '校园小C知识库'}</Typography.Title><Row gutter={18}><Col xs={24} lg={9}><Card title={isRoute ? '新建路线' : '新建答复'}><Form form={form} layout="vertical" onFinish={submit}>{isRoute ? <><Form.Item name="title" label="路线名称" rules={[{ required: true }]}><Input /></Form.Item><Form.Item name="destination" label="目的地" rules={[{ required: true }]}><Input /></Form.Item><Form.Item name="days" label="出行天数" rules={[{ required: true }]}><Select options={['1-3天', '4-7天', '7天以上'].map((x) => ({ value: x }))} /></Form.Item><Form.Item name="budget" label="参考价格"><Input type="number" /></Form.Item><Form.Item name="preferences" label="偏好（逗号分隔）"><Input placeholder="文化,艺术" /></Form.Item><Form.Item name="stops" label="途经地点（用 -> 分隔）"><Input /></Form.Item><Form.Item name="highlights" label="路线亮点（逗号分隔）"><Input /></Form.Item></> : <><Form.Item name="question" label="问题" rules={[{ required: true }]}><Input /></Form.Item><Form.Item name="keywords" label="关键词（逗号分隔）" rules={[{ required: true }]}><Input /></Form.Item><Form.Item name="answer" label="答复" rules={[{ required: true }]}><Input.TextArea rows={5} /></Form.Item></>}<Button type="primary" htmlType="submit">保存</Button></Form></Card></Col><Col xs={24} lg={15}><Card title={isRoute ? '已上架路线' : '已配置答复'}><Table dataSource={rows} rowKey="id" pagination={{ pageSize: 7 }} columns={isRoute ? [{ title: '路线', dataIndex: 'title' }, { title: '目的地', dataIndex: 'destination' }, { title: '天数', dataIndex: 'days' }, { title: '状态', dataIndex: 'status' }] : [{ title: '问题', dataIndex: 'question' }, { title: '关键词', dataIndex: 'keywords' }, { title: '答复', dataIndex: 'answer', ellipsis: true }, { title: '状态', dataIndex: 'status' }]} /></Card></Col></Row></>;
}

function Users() { const [rows, setRows] = useState<any[]>([]); useEffect(() => { void client.get<any[]>('/admin/users').then(setRows).catch((e) => message.error(e.message)); }, []); return <><Typography.Title level={2}>校内成员</Typography.Title><Card className="table-card"><Table dataSource={rows} rowKey={(x) => x.membership.id} columns={[{ title: '昵称', render: (_: unknown, r: any) => r.user?.nickname || '未补全' }, { title: '认证状态', dataIndex: ['membership', 'verificationStatus'], render: () => <Tag color="green">已认证</Tag> }, { title: '加入时间', dataIndex: ['membership', 'createdAt'], render: (x: string) => new Date(x).toLocaleString() }]} /></Card></>; }

function Console({ admin, onLogout }: { admin: Admin; onLogout: () => void }) {
  const [key, setKey] = useState('dashboard');
  const [passwordOpen, setPasswordOpen] = useState(false);
  const canManage = admin.role === 'super_admin' || (admin.role === 'operator' && Boolean(admin.schoolId));
  const content = key === 'reports' ? <Reports /> : key === 'posts' ? <Posts admin={admin} /> : !reviewScope && canManage && key === 'invites' ? <Invites /> : !reviewScope && canManage && key === 'routes' ? <ResourceManager kind="route" /> : !reviewScope && canManage && key === 'knowledge' ? <ResourceManager kind="knowledge" /> : !reviewScope && canManage && key === 'users' ? <Users /> : <Dashboard />;
  const items = [{ key: 'dashboard', icon: <DashboardOutlined />, label: '工作台' }, { key: 'posts', icon: <SafetyCertificateOutlined />, label: canManage ? '内容审核与发布' : '内容审核' }, { key: 'reports', icon: <FlagOutlined />, label: '举报处理' }, ...(!reviewScope && canManage ? [{ key: 'invites', icon: <KeyOutlined />, label: '邀请码' }, { key: 'routes', icon: <BookOutlined />, label: '旅行路线' }, { key: 'knowledge', icon: <MessageOutlined />, label: '小C知识库' }, { key: 'users', icon: <TeamOutlined />, label: '校内成员' }] : [])];
  const roleLabel = admin.role === 'super_admin' ? '平台超级管理员' : admin.role === 'reviewer' ? '学校内容审核员' : '学校运营管理员';
  return <Layout className="shell"><Layout.Sider breakpoint="lg" collapsedWidth="0" className="sider"><div className="logo">Weculture<span>{reviewScope ? '线上审核' : '运营后台'}</span></div><Menu theme="dark" mode="inline" selectedKeys={[key]} items={items} onClick={(event) => setKey(event.key)} /><div className="sider-footer"><div>{admin.username}</div><small>{roleLabel}</small><Space direction="vertical"><Button icon={<KeyOutlined />} type="text" onClick={() => setPasswordOpen(true)}>修改密码</Button><Button icon={<LogoutOutlined />} type="text" onClick={onLogout}>退出</Button></Space></div></Layout.Sider><Layout><Layout.Header className="topbar"><span><AuditOutlined /> {reviewScope ? '线上投稿审核 · 所有处理均记录审计日志' : '所有管理操作均记录审计日志'}</span></Layout.Header><Layout.Content className="content">{content}</Layout.Content></Layout><ChangePassword open={passwordOpen} onClose={() => setPasswordOpen(false)} onChanged={onLogout} /></Layout>;
}

function ChangePassword({ open, onClose, onChanged }: { open: boolean; onClose: () => void; onChanged: () => void }) {
  const [form] = Form.useForm(); const [saving, setSaving] = useState(false); const [error, setError] = useState('');
  useEffect(() => { if (open) { form.resetFields(); setError(''); } }, [open, form]);
  const submit = async (values: { currentPassword: string; newPassword: string }) => {
    if (saving) return;
    setSaving(true); setError('');
    try { await client.post('/admin/me/password', { currentPassword: values.currentPassword, newPassword: values.newPassword }); form.resetFields(); onClose(); onChanged(); message.success('密码已修改，请使用新密码重新登录'); }
    catch (failure) { setError((failure as Error).message); }
    finally { setSaving(false); }
  };
  const validateNewPassword = (_: unknown, value: string) => {
    if (!value || value.length < 12 || !/[a-z]/.test(value) || !/[A-Z]/.test(value) || !/[0-9]/.test(value) || !/[^A-Za-z0-9\s]/.test(value)) return Promise.reject(new Error('至少 12 个字符，并包含大小写字母、数字和符号'));
    if (new TextEncoder().encode(value).length > 72) return Promise.reject(new Error('新密码过长，请缩短后重试'));
    return Promise.resolve();
  };
  return <Modal title="修改密码" open={open} onCancel={() => { if (!saving) { form.resetFields(); onClose(); } }} footer={null} maskClosable={!saving} closable={!saving} destroyOnClose><Typography.Paragraph type="secondary">新密码至少 12 个字符，包含大写字母、小写字母、数字和符号。修改成功后需要重新登录。</Typography.Paragraph>{error && <Alert className="session-note" type="error" showIcon message={error} />}<Form form={form} layout="vertical" onFinish={submit} disabled={saving}><Form.Item name="currentPassword" label="当前密码" rules={[{ required: true, message: '请输入当前密码' }]}><Input.Password autoComplete="current-password" /></Form.Item><Form.Item name="newPassword" label="新密码" rules={[{ validator: validateNewPassword }]}><Input.Password autoComplete="new-password" /></Form.Item><Form.Item name="confirmPassword" label="确认新密码" dependencies={['newPassword']} rules={[{ required: true, message: '请再次输入新密码' }, ({ getFieldValue }) => ({ validator: (_: unknown, value: string) => !value || getFieldValue('newPassword') === value ? Promise.resolve() : Promise.reject(new Error('两次新密码不一致')) })]}><Input.Password autoComplete="new-password" /></Form.Item><Space><Button type="primary" htmlType="submit" loading={saving}>修改密码</Button><Button disabled={saving} onClick={() => { form.resetFields(); onClose(); }}>取消</Button></Space></Form></Modal>;
}

function Root() {
  const [admin, setAdmin] = useState<Admin | null>(null); const [restoring, setRestoring] = useState(Boolean(localStorage.getItem('adminToken'))); const [restoreError, setRestoreError] = useState(''); const [notice, setNotice] = useState(''); const restoreVersion = useRef(0);
  const logout = useCallback(() => { restoreVersion.current += 1; localStorage.removeItem('adminToken'); setAdmin(null); setRestoring(false); setRestoreError(''); }, []);
  const restore = useCallback(async () => {
    const version = ++restoreVersion.current; const token = localStorage.getItem('adminToken');
    if (!token) { setRestoring(false); setRestoreError(''); return; }
    setRestoring(true); setRestoreError('');
    try { const current = await client.get<Admin>('/admin/me'); if (version === restoreVersion.current && localStorage.getItem('adminToken') === token) setAdmin(current); }
    catch (failure) {
      if (version !== restoreVersion.current) return;
      if (failure instanceof ApiError && [401, 403].includes(failure.status || 0)) { logout(); setNotice('登录已失效，请重新登录'); }
      else setRestoreError((failure as Error).message);
    } finally { if (version === restoreVersion.current) setRestoring(false); }
  }, [logout]);
  useEffect(() => { const unsubscribe = onSessionExpired(() => { logout(); setNotice('登录已过期，请重新登录'); }); void restore(); return () => { unsubscribe(); restoreVersion.current += 1; }; }, [logout, restore]);
  const loggedIn = (current: Admin) => { restoreVersion.current += 1; setAdmin(current); setRestoring(false); setRestoreError(''); setNotice(''); };
  return <AntApp>{restoring ? <div className="loading">正在恢复登录...</div> : restoreError ? <main className="session-recovery"><Card><Typography.Title level={3}>暂时无法恢复登录</Typography.Title><Typography.Paragraph>{restoreError}</Typography.Paragraph><Space><Button type="primary" onClick={() => void restore()}>重试</Button><Button onClick={logout}>重新登录</Button></Space></Card></main> : admin ? <Console admin={admin} onLogout={logout} /> : <Login onLogin={loggedIn} notice={notice} />}</AntApp>;
}
createRoot(document.getElementById('root')!).render(<React.StrictMode><ConfigProvider locale={zhCN} theme={{ token: { colorPrimary: '#C5532E', borderRadius: 8, fontFamily: 'PingFang SC, Microsoft YaHei, sans-serif' } }}><Root /></ConfigProvider></React.StrictMode>);
