import { useCallback, useEffect, useRef, useState } from 'react';
import { EditOutlined, PlusOutlined, ReloadOutlined } from '@ant-design/icons';
import { Alert, Button, Card, Descriptions, Form, Image, Input, InputNumber, Modal, Select, Space, Table, Tag, Typography, message } from 'antd';
import { client } from './api';

export type Admin = { username: string; role: string; schoolId?: string | null };
type Circle = 'city' | 'international' | 'campus';
type PostType = 'dynamic' | 'event' | 'market';
type School = { id: string; name: string; shortName: string };
type EventInfo = { location: string; startsAt: string; endsAt: string; registrationDeadline: string; capacity: number; registeredCount: number };
type Post = { id: string; title: string; content: string; type: PostType; circle: Circle | null; city: string | null; contentLanguage: string | null; schoolId: string | null; visibility: 'school' | 'platform'; status: string; createdAt: string; rejectionReason: string; imageUrl: string; tag: string; event?: EventInfo | null };
type PostValues = { title: string; content: string; type: PostType; circle: Circle; city?: string; contentLanguage?: string; schoolId?: string; imageUrl?: string; tag?: string; location?: string; startsAt?: string; endsAt?: string; registrationDeadline?: string; capacity?: number };
type ReviewMedia = { postId: string; request: number; url: string; status: 'idle' | 'fetching' | 'loading' | 'ready' | 'error'; error: string };
const circles = [{ value: 'city', label: '同城圈' }, { value: 'international', label: '国际圈' }, { value: 'campus', label: '校园圈' }];
const languages = [{ value: 'zh', label: '中文' }, { value: 'en', label: '英语' }, { value: 'ru', label: '俄语' }, { value: 'fr', label: '法语' }, { value: 'es', label: '西班牙语' }, { value: 'ar', label: '阿拉伯语' }, { value: 'other', label: '其他语言' }];
const postTypes = [{ value: 'dynamic', label: '动态' }, { value: 'event', label: '活动' }, { value: 'market', label: '闲置' }];
const statusColors: Record<string, string> = { pending: 'gold', approved: 'green', rejected: 'red', offline: 'default', draft: 'default' };
const statusText: Record<string, string> = { pending: '待审核', approved: '已通过', rejected: '已驳回', offline: '已下架', draft: '草稿' };
const localDateTime = (value?: string) => {
  if (!value) return undefined;
  const date = new Date(value);
  if (Number.isNaN(+date)) return undefined;
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}T${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
};
const nonBlank = (label: string, min: number, max: number) => ({ validator: (_: unknown, value?: string) => value && value.trim().length >= min && value.trim().length <= max ? Promise.resolve() : Promise.reject(new Error(`${label}需为 ${min} 至 ${max} 字`)) });

export function Posts({ admin }: { admin: Admin }) {
  const platformAdmin = admin.role === 'super_admin';
  const canWrite = platformAdmin || (admin.role === 'operator' && Boolean(admin.schoolId));
  const canReview = platformAdmin || (['operator', 'reviewer'].includes(admin.role) && Boolean(admin.schoolId));
  const [posts, setPosts] = useState<Post[]>([]);
  const [schools, setSchools] = useState<School[]>([]);
  const [schoolError, setSchoolError] = useState('');
  const [status, setStatus] = useState('pending');
  const [scope, setScope] = useState(platformAdmin ? '' : 'school');
  const [circle, setCircle] = useState(platformAdmin ? '' : 'campus');
  const [city, setCity] = useState('');
  const [cityInput, setCityInput] = useState('');
  const [schoolId, setSchoolId] = useState('');
  const [type, setType] = useState('');
  const [selected, setSelected] = useState<Post>();
  const [reason, setReason] = useState('');
  const [reviewing, setReviewing] = useState(false);
  const [media, setMedia] = useState<ReviewMedia>({ postId: '', request: 0, url: '', status: 'idle', error: '' });
  const mediaVersion = useRef(0);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<Post>();
  const [saving, setSaving] = useState(false);
  const [form] = Form.useForm<PostValues>();
  const editorCircle = Form.useWatch('circle', form);
  const editorType = Form.useWatch('type', form);
  const requestNumber = useRef(0);
  const schoolLabel = (id?: string | null) => schools.find((school) => school.id === id)?.name || (id ? `学校 ${id.slice(0, 8)}` : '未绑定学校');
  const allowed = (post: Post) => platformAdmin || (post.circle === 'campus' && post.visibility === 'school' && post.schoolId === admin.schoolId);
  const circleLabel = (value: Post['circle']) => circles.find((item) => item.value === value)?.label || '待分类';

  const loadSchools = useCallback(async () => {
    setSchoolError('');
    try { setSchools(await client.get<School[]>('/admin/schools')); }
    catch (error) { setSchoolError((error as Error).message); }
  }, []);
  useEffect(() => { void loadSchools(); }, [loadSchools]);

  const load = useCallback(async () => {
    const currentRequest = ++requestNumber.current;
    setLoading(true); setLoadError('');
    const query = new URLSearchParams();
    if (status) query.set('status', status);
    if (scope) query.set('scope', scope);
    if (circle) query.set('circle', circle);
    if (circle === 'city' && city) query.set('city', city);
    if (platformAdmin && scope !== 'platform' && schoolId) query.set('schoolId', schoolId);
    if (type) query.set('type', type);
    try {
      const rows = await client.get<Post[]>(`/admin/posts?${query}`);
      if (currentRequest === requestNumber.current) setPosts(rows);
    } catch (error) {
      if (currentRequest === requestNumber.current) { setPosts([]); setLoadError((error as Error).message); }
    } finally { if (currentRequest === requestNumber.current) setLoading(false); }
  }, [status, scope, circle, city, schoolId, type, platformAdmin]);
  useEffect(() => { void load(); return () => { requestNumber.current += 1; }; }, [load]);

  const loadMedia = useCallback(async (post: Post) => {
    const request = ++mediaVersion.current;
    setMedia({ postId: post.id, request, url: '', status: 'fetching', error: '' });
    try {
      const result = await client.get<{ url: string; expiresIn?: number; expiresAt?: string | null }>(`/admin/posts/${post.id}/media`);
      if (request !== mediaVersion.current) return;
      let url: URL;
      try { url = new URL(result.url); } catch { throw new Error('配图暂时无法读取，请重试或联系运营人员'); }
      if (url.protocol !== 'https:') throw new Error('配图暂时无法安全展示，请联系运营人员');
      setMedia({ postId: post.id, request, url: url.href, status: 'loading', error: '' });
    } catch (failure) {
      if (request === mediaVersion.current) setMedia({ postId: post.id, request, url: '', status: 'error', error: (failure as Error).message });
    }
  }, []);
  useEffect(() => {
    if (selected?.imageUrl) void loadMedia(selected);
    else setMedia({ postId: selected?.id || '', request: ++mediaVersion.current, url: '', status: 'idle', error: '' });
    return () => { mediaVersion.current += 1; };
  }, [selected?.id, selected?.imageUrl, loadMedia]);
  const mediaIsCurrent = media.postId === selected?.id;
  const mediaBlocksApproval = Boolean(selected?.imageUrl && (!mediaIsCurrent || media.status !== 'ready'));
  const mediaLoaded = (request: number, successful: boolean) => setMedia((current) => current.request !== request || request !== mediaVersion.current ? current : { ...current, status: successful ? 'ready' : 'error', error: successful ? '' : '配图加载失败，请重试。显示完整配图后才可审核通过。' });

  const review = async (next: 'approved' | 'rejected' | 'offline') => {
    if (!selected || !canReview || !allowed(selected) || reviewing) return;
    if (next === 'approved' && mediaBlocksApproval) { message.warning('请先完整查看配图；图片读取失败时可以重试、驳回或关闭'); return; }
    if (next === 'rejected' && !reason.trim()) { message.warning('请先填写驳回原因'); return; }
    setReviewing(true);
    try {
      await client.post(`/admin/posts/${selected.id}/review`, { status: next, reason: reason.trim() });
      message.success(next === 'approved' ? '内容已通过' : next === 'rejected' ? '内容已驳回' : '内容已下架');
      setSelected(undefined); setReason(''); void load();
    } catch (error) { message.error((error as Error).message); }
    finally { setReviewing(false); }
  };

  const openEditor = (post?: Post) => {
    if (!canWrite || (post && !allowed(post))) return;
    form.resetFields(); setEditing(post);
    form.setFieldsValue(post ? {
      title: post.title, content: post.content, type: post.type, circle: post.circle || undefined,
      city: post.city || undefined, contentLanguage: post.contentLanguage || undefined,
      schoolId: post.schoolId || undefined, tag: post.tag, imageUrl: post.imageUrl,
      location: post.event?.location, startsAt: localDateTime(post.event?.startsAt), endsAt: localDateTime(post.event?.endsAt),
      registrationDeadline: localDateTime(post.event?.registrationDeadline), capacity: post.event?.capacity,
    } : { type: 'dynamic', circle: platformAdmin ? 'city' : 'campus', schoolId: admin.schoolId || undefined, contentLanguage: 'zh', capacity: 30 });
    setEditorOpen(true);
  };

  const submit = async (values: PostValues) => {
    if (!canWrite || saving || (editing && !allowed(editing))) return;
    if (!platformAdmin && values.circle !== 'campus') { message.error('学校运营员只能发布本校校园圈内容'); return; }
    const payload: Record<string, unknown> = { title: values.title.trim(), content: values.content.trim(), type: values.type, circle: values.circle, status: 'pending', tag: values.tag?.trim() || '', imageUrl: values.imageUrl?.trim() || '' };
    if (values.circle === 'city') payload.city = values.city?.trim();
    if (values.circle === 'international') payload.contentLanguage = values.contentLanguage;
    if (values.circle === 'campus') payload.schoolId = platformAdmin ? values.schoolId : admin.schoolId;
    if (values.type === 'event' && !editing) {
      const start = new Date(values.startsAt || ''), end = new Date(values.endsAt || ''), deadline = new Date(values.registrationDeadline || '');
      if ([start, end, deadline].some((date) => Number.isNaN(+date)) || start >= end || deadline >= start || deadline <= new Date()) { message.warning('请填写有效的未来活动时间：报名截止早于开始，结束晚于开始'); return; }
      Object.assign(payload, { location: values.location?.trim(), startsAt: start.toISOString(), endsAt: end.toISOString(), registrationDeadline: deadline.toISOString(), capacity: values.capacity });
    }
    setSaving(true);
    try {
      const result = editing ? await client.patch<Post>(`/admin/posts/${editing.id}`, payload) : await client.post<Post>('/admin/posts', payload);
      message.success(result.status === 'approved' ? '内容已发布' : '内容已保存，等待审核');
      setEditorOpen(false); setEditing(undefined); form.resetFields();
      setStatus('pending'); setScope(values.circle === 'campus' ? 'school' : 'platform'); setCircle(values.circle);
      setCity(''); setCityInput(''); setSchoolId(values.circle === 'campus' && platformAdmin ? values.schoolId || '' : ''); setType('');
      void load();
    } catch (error) { message.error((error as Error).message); }
    finally { setSaving(false); }
  };

  const visiblePosts = posts.filter((post) => (!scope || post.visibility === scope) && allowed(post));
  const availableCircles = !platformAdmin || scope === 'school' ? circles.filter((item) => item.value === 'campus') : scope === 'platform' ? circles.filter((item) => item.value !== 'campus') : circles;
  return <>
    <div className="posts-heading"><div><Typography.Title level={2}>内容审核与发布</Typography.Title><Typography.Paragraph type="secondary">{platformAdmin ? '处理同城、国际和各校校园圈内容。公开内容审核通过后展示，校园内容仅同校认证成员可见。' : `${schoolLabel(admin.schoolId)} · 仅处理本校校园圈内容。${canWrite ? '新建或编辑后提交审核。' : '当前账号拥有审核权限。'}`}</Typography.Paragraph></div>{canWrite && <Button type="primary" icon={<PlusOutlined />} onClick={() => openEditor()}>发布内容</Button>}</div>
    <Space wrap className="toolbar posts-filters">
      <Select aria-label="审核状态" value={status} onChange={setStatus} options={[{ value: '', label: '全部状态' }, ...Object.entries(statusText).map(([value, label]) => ({ value, label }))]} />
      {platformAdmin && <Select aria-label="内容范围" value={scope} onChange={(value) => { setScope(value); setCircle(value === 'school' ? 'campus' : ''); setCity(''); setCityInput(''); if (value === 'platform') setSchoolId(''); }} options={[{ value: '', label: '全部范围' }, { value: 'platform', label: '公开内容' }, { value: 'school', label: '校园内容' }]} />}
      <Select aria-label="目标圈层" value={circle} disabled={!platformAdmin || scope === 'school'} onChange={(value) => { setCircle(value); setCity(''); setCityInput(''); if (value !== 'campus') setSchoolId(''); }} options={[...(platformAdmin && scope !== 'school' ? [{ value: '', label: '全部圈层' }] : []), ...availableCircles]} />
      <Select aria-label="内容类型" value={type} onChange={setType} options={[{ value: '', label: '全部类型' }, ...postTypes]} />
      {circle === 'city' && <Input.Search aria-label="城市筛选" value={cityInput} onChange={(event) => { setCityInput(event.target.value); if (!event.target.value) setCity(''); }} onSearch={(value) => setCity(value.trim())} placeholder="输入城市并搜索" maxLength={50} allowClear style={{ width: 210 }} />}
      {platformAdmin && scope !== 'platform' && (circle === '' || circle === 'campus') && <Select aria-label="学校筛选" value={schoolId} onChange={setSchoolId} showSearch optionFilterProp="label" options={[{ value: '', label: '全部学校' }, ...schools.map((school) => ({ value: school.id, label: school.name }))]} style={{ minWidth: 170 }} />}
      <Button icon={<ReloadOutlined />} onClick={() => void load()} loading={loading}>刷新</Button>
    </Space>
    {schoolError && <Alert type="warning" showIcon message="学校信息读取失败" description={<Space>{schoolError}<Button type="link" onClick={() => void loadSchools()}>重试</Button></Space>} />}
    {loadError && <Alert type="error" showIcon message="内容列表读取失败" description={loadError} action={<Button onClick={() => void load()}>重试</Button>} />}
    <Card className="table-card"><Table<Post> loading={loading} dataSource={visiblePosts} rowKey="id" pagination={{ pageSize: 8 }} scroll={{ x: 1000 }} locale={{ emptyText: loadError ? '读取失败，请重试' : '当前筛选下暂无内容' }} columns={[
      { title: '标题', dataIndex: 'title', width: 230 },
      { title: '圈层', dataIndex: 'circle', render: (value: Post['circle']) => <Tag color={value === 'campus' ? 'green' : value === 'international' ? 'blue' : value === 'city' ? 'orange' : 'default'}>{circleLabel(value)}</Tag> },
      { title: '城市 / 语言 / 学校', render: (_: unknown, post: Post) => post.circle === 'city' ? post.city || '未填写城市' : post.circle === 'international' ? languages.find((item) => item.value === post.contentLanguage)?.label || post.contentLanguage || '未填写语言' : post.circle === 'campus' ? schoolLabel(post.schoolId) : '待确认分类' },
      { title: '类型', dataIndex: 'type', render: (value: string) => postTypes.find((item) => item.value === value)?.label || value },
      { title: '范围', dataIndex: 'visibility', render: (value: string) => value === 'school' ? '校内可见' : '公开可见' },
      { title: '状态', dataIndex: 'status', render: (value: string) => <Tag color={statusColors[value]}>{statusText[value] || value}</Tag> },
      { title: '提交时间', dataIndex: 'createdAt', render: (value: string) => new Date(value).toLocaleString() },
      { title: '操作', fixed: 'right', width: 170, render: (_: unknown, post: Post) => <Space><Button type="link" onClick={() => { setSelected(post); setReason(''); }}>查看与处理</Button>{canWrite && <Button type="text" aria-label={`编辑 ${post.title}`} icon={<EditOutlined />} onClick={() => openEditor(post)} />}</Space> },
    ]} /></Card>
    <Modal title="审核内容" open={Boolean(selected)} onCancel={() => { if (!reviewing) { setSelected(undefined); setReason(''); } }} footer={null} maskClosable={!reviewing} closable={!reviewing} width={640}>
      <Typography.Title level={4}>{selected?.title}</Typography.Title>
      {selected && <Descriptions size="small" column={2} items={[{ key: 'circle', label: '圈层', children: circleLabel(selected.circle) }, { key: 'scope', label: '可见范围', children: selected.visibility === 'school' ? '同校认证成员' : '公开' }, { key: 'city', label: '城市', children: selected.city || '—' }, { key: 'language', label: '内容语言', children: languages.find((item) => item.value === selected.contentLanguage)?.label || selected.contentLanguage || '—' }, { key: 'school', label: '学校', children: selected.schoolId ? schoolLabel(selected.schoolId) : '—' }, { key: 'status', label: '当前状态', children: <Tag color={statusColors[selected.status]}>{statusText[selected.status] || selected.status}</Tag> }]} />}
      {selected?.imageUrl && <>
        {mediaIsCurrent && media.url && ['loading', 'ready'].includes(media.status) && <div className="review-media"><Image key={`${media.postId}-${media.request}`} className="review-image" src={media.url} alt="投稿配图，点击可放大查看" onLoad={() => mediaLoaded(media.request, true)} onError={() => mediaLoaded(media.request, false)} preview={{ mask: '放大查看' }} /></div>}
        {(!mediaIsCurrent || ['idle', 'fetching', 'loading'].includes(media.status)) && <Alert className="review-note" type="info" showIcon message="正在加载投稿配图…" description="配图显示完整后才可审核通过。" />}
        {mediaIsCurrent && media.status === 'error' && <Alert className="review-note" type="warning" showIcon message="配图暂不可读取" description={media.error} action={<Button onClick={() => void loadMedia(selected)}>重试配图</Button>} />}
      </>}
      <Typography.Paragraph className="review-content">{selected?.content}</Typography.Paragraph>
      {selected?.tag && <Tag>{selected.tag}</Tag>}
      {selected?.event && <Descriptions size="small" column={1} items={[{ key: 'location', label: '活动地点', children: selected.event.location }, { key: 'startsAt', label: '活动开始', children: new Date(selected.event.startsAt).toLocaleString() }, { key: 'endsAt', label: '活动结束', children: new Date(selected.event.endsAt).toLocaleString() }, { key: 'deadline', label: '报名截止', children: new Date(selected.event.registrationDeadline).toLocaleString() }, { key: 'capacity', label: '已报名 / 名额', children: `${selected.event.registeredCount} / ${selected.event.capacity}` }]} />}
      {selected?.rejectionReason && <Alert className="review-note" type="warning" message={`已有处理原因：${selected.rejectionReason}`} />}
      {selected && !selected.circle && <Alert className="review-note" type="warning" message="旧内容尚未分类" description={canWrite ? '请先编辑并确认真实圈层，再审核发布。' : '请联系平台管理员确认并补全真实圈层。'} />}
      {canReview && selected && allowed(selected) && <Form layout="vertical" style={{ marginTop: 18 }}><Form.Item label="处理原因（驳回时必填）"><Input.TextArea value={reason} onChange={(event) => setReason(event.target.value)} rows={3} maxLength={500} showCount placeholder="请向作者说明处理原因" /></Form.Item>{mediaBlocksApproval && <Typography.Paragraph type="secondary">配图尚未完整显示，暂不能审核通过。你仍可重试配图、驳回或关闭。</Typography.Paragraph>}<Space wrap><Button type="primary" loading={reviewing} disabled={reviewing || selected.status === 'approved' || !selected.circle || mediaBlocksApproval} onClick={() => void review('approved')}>审核通过</Button><Button danger disabled={reviewing || selected.status === 'rejected'} onClick={() => void review('rejected')}>驳回</Button><Button disabled={reviewing || selected.status === 'offline'} onClick={() => void review('offline')}>下架</Button>{canWrite && <Button disabled={reviewing} onClick={() => { setSelected(undefined); openEditor(selected); }}>编辑内容</Button>}</Space></Form>}
    </Modal>
    <Modal title={editing ? '编辑内容' : '发布内容'} open={editorOpen} onCancel={() => { if (!saving) setEditorOpen(false); }} footer={null} width={680} maskClosable={!saving} closable={!saving} forceRender>
      <Alert type="info" showIcon message="保存后进入待审核，审核通过才会对相应圈层展示。" style={{ marginBottom: 18 }} />
      <Form form={form} layout="vertical" onFinish={submit} disabled={saving}>
        <Form.Item name="circle" label="目标圈层" rules={[{ required: true, message: '请选择真实圈层' }]}><Select disabled={!platformAdmin} options={platformAdmin ? circles : circles.filter((item) => item.value === 'campus')} /></Form.Item>
        {editorCircle === 'campus' && schoolError && <Alert className="review-note" type="warning" message="学校信息读取失败" description={schoolError} action={<Button onClick={() => void loadSchools()}>重试</Button>} />}
        {editorCircle === 'city' && <Form.Item name="city" label="城市" preserve={false} rules={[nonBlank('城市', 1, 50)]}><Input placeholder="例如：北京" maxLength={50} /></Form.Item>}
        {editorCircle === 'international' && <Form.Item name="contentLanguage" label="内容语言" preserve={false} rules={[{ required: true, message: '请选择内容使用的语言' }]}><Select options={languages} /></Form.Item>}
        {editorCircle === 'campus' && (platformAdmin ? <Form.Item name="schoolId" label="所属学校" preserve={false} rules={[{ required: true, message: '请选择学校' }]}><Select showSearch optionFilterProp="label" placeholder="选择可见内容的学校" options={schools.map((school) => ({ value: school.id, label: school.name }))} /></Form.Item> : <Form.Item label="所属学校"><Input value={schoolLabel(admin.schoolId)} disabled /></Form.Item>)}
        <Form.Item name="type" label="内容类型" rules={[{ required: true }]}><Select disabled={Boolean(editing)} options={postTypes} /></Form.Item>
        <Form.Item name="title" label="标题" rules={[nonBlank('标题', 2, 40)]}><Input maxLength={40} showCount /></Form.Item>
        <Form.Item name="content" label="正文" rules={[nonBlank('正文', 2, 2000)]}><Input.TextArea rows={6} maxLength={2000} showCount /></Form.Item>
        <Form.Item name="tag" label="标签（可选）"><Input maxLength={80} /></Form.Item>
        <Form.Item name="imageUrl" label="图片地址（可选）"><Input placeholder="https://..." maxLength={2048} /></Form.Item>
        {editorType === 'event' && !editing && <><Form.Item name="location" label="活动地点" preserve={false} rules={[nonBlank('活动地点', 1, 200)]}><Input maxLength={200} /></Form.Item><Form.Item name="registrationDeadline" label="报名截止时间" preserve={false} rules={[{ required: true, message: '请选择报名截止时间' }]}><Input type="datetime-local" /></Form.Item><Form.Item name="startsAt" label="开始时间" preserve={false} rules={[{ required: true, message: '请选择开始时间' }]}><Input type="datetime-local" /></Form.Item><Form.Item name="endsAt" label="结束时间" preserve={false} rules={[{ required: true, message: '请选择结束时间' }]}><Input type="datetime-local" /></Form.Item><Form.Item name="capacity" label="报名人数上限" preserve={false} rules={[{ required: true, type: 'number', min: 1, message: '请输入至少 1 人' }]}><InputNumber min={1} precision={0} /></Form.Item></>}
        {editorType === 'event' && editing && <Alert className="review-note" type="info" message="本次编辑保存内容与圈层信息，活动时间和报名名额保留原值。" />}
        <Space><Button type="primary" htmlType="submit" loading={saving}>{editing ? '保存并提交审核' : '提交审核'}</Button><Button onClick={() => setEditorOpen(false)} disabled={saving}>取消</Button></Space>
      </Form>
    </Modal>
  </>;
}
