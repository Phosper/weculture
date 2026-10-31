import { useCallback, useEffect, useRef, useState } from 'react';
import { DeleteOutlined, PlusOutlined, ReloadOutlined } from '@ant-design/icons';
import { Alert, Button, Card, Input, InputNumber, Modal, Select, Space, Table, Tag, Typography, message } from 'antd';
import { client } from './api';

type AdminPost = { id: string; title: string; status: string; visibility: 'platform' | 'school'; circle: string | null; schoolId: string | null; school?: { id: string; name: string; shortName: string } | null; type: string; createdAt: string };
type FeaturedRow = { id: string; postId: string; scope: 'platform' | 'school'; schoolId: string | null; sortOrder: number; status: 'active' | 'inactive'; createdAt: string; updatedAt: string; post: AdminPost | null; school: { id: string; name: string; shortName: string } | null };
type PostPage = { items: AdminPost[]; page: number; pageSize: number; total: number; hasMore: boolean };

const postStatusText: Record<string, string> = { pending: '待审核', approved: '已发布', rejected: '已驳回', offline: '已下架', draft: '草稿' };
const postStatusColor: Record<string, string> = { pending: 'gold', approved: 'green', rejected: 'red', offline: 'default', draft: 'default' };

export function Featured() {
  const [rows, setRows] = useState<FeaturedRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [candidates, setCandidates] = useState<AdminPost[]>([]);
  const [candidateQuery, setCandidateQuery] = useState('');
  const [candidateLoading, setCandidateLoading] = useState(false);
  const [candidateError, setCandidateError] = useState('');
  const [selectedPostId, setSelectedPostId] = useState('');
  const [sortOrder, setSortOrder] = useState(0);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState<FeaturedRow>();
  const [editSort, setEditSort] = useState(0);
  const [editStatus, setEditStatus] = useState<'active' | 'inactive'>('active');
  const [editSaving, setEditSaving] = useState(false);
  const request = useRef(0);

  const load = useCallback(async () => {
    const current = ++request.current;
    setLoading(true); setError('');
    try {
      const result = await client.get<FeaturedRow[]>('/admin/featured');
      if (current === request.current) setRows(result);
    } catch (failure) {
      if (current === request.current) { setRows([]); setError((failure as Error).message); }
    } finally { if (current === request.current) setLoading(false); }
  }, []);

  const loadCandidates = useCallback(async (query = '') => {
    setCandidateLoading(true); setCandidateError('');
    const params = new URLSearchParams({ status: 'approved', page: '1', pageSize: '20' });
    if (query.trim()) params.set('q', query.trim());
    try {
      const result = await client.get<PostPage>(`/admin/posts?${params}`);
      setCandidates(result.items || []);
    } catch (failure) {
      setCandidates([]); setCandidateError((failure as Error).message);
    } finally { setCandidateLoading(false); }
  }, []);

  useEffect(() => { void load(); void loadCandidates(''); return () => { request.current += 1; }; }, [load, loadCandidates]);

  const add = async () => {
    if (!selectedPostId || saving) return;
    setSaving(true);
    try {
      await client.post('/admin/featured', { postId: selectedPostId, sortOrder });
      message.success('已加入精选');
      setSelectedPostId(''); setSortOrder(0);
      await load(); await loadCandidates(candidateQuery);
    } catch (failure) { message.error((failure as Error).message); }
    finally { setSaving(false); }
  };

  const openEdit = (row: FeaturedRow) => { setEditing(row); setEditSort(row.sortOrder); setEditStatus(row.status); };
  const saveEdit = async () => {
    if (!editing || editSaving) return;
    setEditSaving(true);
    try {
      await client.patch(`/admin/featured/${editing.id}`, { sortOrder: editSort, status: editStatus });
      message.success('精选已更新');
      setEditing(undefined); void load();
    } catch (failure) { message.error((failure as Error).message); }
    finally { setEditSaving(false); }
  };
  const toggle = async (row: FeaturedRow) => {
    try {
      await client.patch(`/admin/featured/${row.id}`, { status: row.status === 'active' ? 'inactive' : 'active' });
      message.success(row.status === 'active' ? '已下架精选' : '已上架精选');
      void load();
    } catch (failure) { message.error((failure as Error).message); }
  };
  const remove = (row: FeaturedRow) => {
    Modal.confirm({
      title: '确认移除精选？', content: `“${row.post?.title || '该内容'}”将不再出现在精选位，但不会删除内容本身。`,
      okText: '移除', cancelText: '取消', okButtonProps: { danger: true },
      onOk: async () => {
        try { await client.delete(`/admin/featured/${row.id}`); message.success('已移除精选'); void load(); }
        catch (failure) { message.error((failure as Error).message); throw failure; }
      },
    });
  };

  const available = candidates.filter((post) => !rows.some((row) => row.postId === post.id));
  return <>
    <Typography.Title level={2}>运营精选</Typography.Title>
    <Typography.Paragraph type="secondary">只可精选已发布内容；平台内容由超级管理员配置，学校运营只能配置本校校园圈内容。排序号越小越靠前，客户端最多展示 10 条。</Typography.Paragraph>
    <Card title="加入精选" className="table-card">
      <Space wrap align="end">
        <Input.Search aria-label="搜索候选内容" value={candidateQuery} onChange={(event) => setCandidateQuery(event.target.value)} onSearch={(value) => void loadCandidates(value)} placeholder="按标题搜索已发布内容" allowClear style={{ width: 300 }} loading={candidateLoading} />
        <Select aria-label="选择候选内容" value={selectedPostId || undefined} onChange={setSelectedPostId} showSearch optionFilterProp="label" placeholder={candidateLoading ? '正在读取候选内容…' : '选择要精选的内容'} style={{ minWidth: 360 }} options={available.map((post) => ({ value: post.id, label: `${post.title} · ${post.visibility === 'school' ? `校园/${post.school?.name || post.schoolId || '本校'}` : '公开'} · ${postStatusText[post.status] || post.status}` }))} />
        <InputNumber aria-label="排序号" min={0} max={9999} precision={0} value={sortOrder} onChange={(value) => setSortOrder(typeof value === 'number' ? value : 0)} addonBefore="排序" />
        <Button type="primary" icon={<PlusOutlined />} loading={saving} disabled={!selectedPostId || saving} onClick={() => void add()}>加入精选</Button>
        <Button icon={<ReloadOutlined />} onClick={() => void loadCandidates(candidateQuery)} loading={candidateLoading}>刷新候选</Button>
      </Space>
      {candidateError && <Alert style={{ marginTop: 12 }} type="warning" showIcon message="候选内容读取失败" description={candidateError} />}
      {!candidateLoading && !candidateError && !available.length && <Typography.Paragraph type="secondary" style={{ marginTop: 12 }}>没有可加入的已发布内容；可先在上方搜索或到内容审核中发布内容。</Typography.Paragraph>}
    </Card>
    {error && <Alert type="error" showIcon message="精选列表读取失败" description={error} action={<Button onClick={() => void load()}>重试</Button>} />}
    <Card className="table-card" title="当前精选">
      <Table<FeaturedRow> loading={loading} dataSource={rows} rowKey="id" pagination={{ pageSize: 10 }} scroll={{ x: 900 }} locale={{ emptyText: error ? '读取失败，请重试' : '还没有精选内容' }} columns={[
        { title: '排序', dataIndex: 'sortOrder', width: 80 },
        { title: '内容', render: (_: unknown, row: FeaturedRow) => <div><Typography.Text strong>{row.post?.title || '内容已不存在'}</Typography.Text><div><Typography.Text type="secondary">{row.post ? `${row.post.type === 'event' ? '活动' : row.post.type === 'market' ? '闲置' : '动态'} · ${postStatusText[row.post.status] || row.post.status}` : '请移除该精选'}</Typography.Text></div></div> },
        { title: '范围', width: 170, render: (_: unknown, row: FeaturedRow) => <Space><Tag color={row.scope === 'platform' ? 'blue' : 'green'}>{row.scope === 'platform' ? '平台' : '校园'}</Tag><span>{row.school?.name || (row.scope === 'platform' ? '公开内容' : '学校未知')}</span></Space> },
        { title: '精选状态', width: 100, render: (_: unknown, row: FeaturedRow) => <Tag color={row.status === 'active' ? 'green' : 'default'}>{row.status === 'active' ? '展示中' : '已停用'}</Tag> },
        { title: '更新时间', dataIndex: 'updatedAt', width: 165, render: (value: string) => new Date(value).toLocaleString() },
        { title: '操作', fixed: 'right', width: 210, render: (_: unknown, row: FeaturedRow) => <Space><Button type="link" onClick={() => openEdit(row)}>编辑</Button><Button type="link" onClick={() => void toggle(row)}>{row.status === 'active' ? '下架' : '上架'}</Button><Button type="link" danger icon={<DeleteOutlined />} onClick={() => remove(row)}>移除</Button></Space> },
      ]} />
    </Card>
    <Modal title="编辑精选" open={Boolean(editing)} onCancel={() => { if (!editSaving) setEditing(undefined); }} onOk={() => void saveEdit()} okText="保存" cancelText="取消" confirmLoading={editSaving} maskClosable={!editSaving} closable={!editSaving}>
      <Typography.Paragraph>{editing?.post?.title || '内容已不存在'}</Typography.Paragraph>
      <Space direction="vertical" style={{ width: '100%' }}>
        <div>排序号<InputNumber min={0} max={9999} precision={0} value={editSort} onChange={(value) => setEditSort(typeof value === 'number' ? value : 0)} style={{ marginLeft: 12 }} /></div>
        <div>状态<Select value={editStatus} onChange={setEditStatus} style={{ marginLeft: 12, width: 160 }} options={[{ value: 'active', label: '展示中' }, { value: 'inactive', label: '已停用' }]} /></div>
      </Space>
    </Modal>
  </>;
}
