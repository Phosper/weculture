import { useCallback, useEffect, useRef, useState } from 'react';
import { ReloadOutlined } from '@ant-design/icons';
import { Alert, Button, Card, Descriptions, Form, Input, Modal, Select, Space, Table, Tag, Typography, message } from 'antd';
import { client } from './api';

type ReportTarget = { postTitle: string; postStatus: string | null; authorNickname: string; commentExcerpt: string; commentDeleted: boolean | null; available: boolean };
type Report = { id: string; targetType: 'post' | 'comment'; targetId: string; postId: string; reason: string; detail: string; status: 'pending' | 'dismissed' | 'removed'; createdAt: string; updatedAt: string; handledAt: string | null; handledBy: string | null; resolution: string; reporter: { id: string; nickname: string }; school: { id: string; name: string; shortName: string } | null; target: ReportTarget };
type ReportPage = { items: Report[]; page: number; pageSize: number; total: number; hasMore: boolean };

const reasonText: Record<string, string> = { spam: '垃圾广告', harassment: '辱骂骚扰', false_info: '虚假信息', inappropriate: '低俗不当', privacy: '泄露隐私', other: '其他' };
const statusText: Record<string, string> = { pending: '待处理', dismissed: '举报不成立', removed: '已处理下架' };
const statusColor: Record<string, string> = { pending: 'gold', dismissed: 'default', removed: 'red' };
const postStatusText: Record<string, string> = { pending: '待审核', approved: '已发布', rejected: '已驳回', offline: '已下架', draft: '草稿', deleted: '已删除', active: '正常' };

export function Reports() {
  const [status, setStatus] = useState('pending');
  const [targetType, setTargetType] = useState('');
  const [rows, setRows] = useState<Report[]>([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [selected, setSelected] = useState<Report>();
  const [resolution, setResolution] = useState('');
  const [handling, setHandling] = useState(false);
  const requestNumber = useRef(0);

  const load = useCallback(async (nextPage = 1) => {
    const request = ++requestNumber.current;
    setLoading(true); setLoadError('');
    const query = new URLSearchParams({ page: String(nextPage), pageSize: '20' });
    if (status) query.set('status', status);
    if (targetType) query.set('targetType', targetType);
    try {
      const result = await client.get<ReportPage>(`/admin/reports?${query}`);
      if (request === requestNumber.current) { setRows(result.items); setPage(result.page); setTotal(result.total); }
    } catch (error) {
      if (request === requestNumber.current) { setRows([]); setTotal(0); setLoadError((error as Error).message); }
    } finally { if (request === requestNumber.current) setLoading(false); }
  }, [status, targetType]);

  useEffect(() => { void load(1); return () => { requestNumber.current += 1; }; }, [load]);

  const open = (report: Report) => { setSelected(report); setResolution(''); };
  const close = () => { if (!handling) { setSelected(undefined); setResolution(''); } };
  const targetStatus = (report: Report) => report.targetType === 'comment'
    ? (report.target.commentDeleted ? 'deleted' : 'active')
    : (report.target.postStatus || '');
  const targetLabel = (report: Report) => reasonText[report.reason] || report.reason;

  const handle = async (action: 'dismiss' | 'takedown') => {
    if (!selected || handling) return;
    setHandling(true);
    try {
      await client.post(`/admin/reports/${selected.id}/resolve`, { action, reason: resolution.trim() });
      message.success(action === 'takedown' ? '已处理并下架对象' : '举报已驳回');
      setSelected(undefined); setResolution(''); void load(page);
    } catch (error) {
      message.error((error as Error).message);
      throw error;
    } finally { setHandling(false); }
  };

  const confirmHandle = (action: 'dismiss' | 'takedown') => {
    if (!selected || handling) return;
    if (!resolution.trim()) { message.warning('请先填写处理说明'); return; }
    const takedown = action === 'takedown';
    Modal.confirm({
      title: takedown ? (selected.targetType === 'post' ? '确认下架该内容？' : '确认删除该评论？') : '确认驳回该举报？',
      content: takedown ? '处理后对象将立即对用户不可见，同一对象的所有待处理举报会一起关闭。' : '只关闭当前举报，不修改被举报对象。',
      okText: '确认处理', cancelText: '取消', okButtonProps: takedown ? { danger: true } : undefined,
      onOk: () => handle(action),
    });
  };

  return <>
    <Typography.Title level={2}>举报处理</Typography.Title>
    <Typography.Paragraph type="secondary">按学校范围查看内容与评论举报；处理动作复用现有下架／软删除，并写入审计日志。</Typography.Paragraph>
    <Space wrap className="toolbar posts-filters">
      <Select aria-label="举报状态" value={status} onChange={setStatus} options={[{ value: '', label: '全部状态' }, ...Object.entries(statusText).map(([value, label]) => ({ value, label }))]} />
      <Select aria-label="举报对象" value={targetType} onChange={setTargetType} options={[{ value: '', label: '全部对象' }, { value: 'post', label: '内容' }, { value: 'comment', label: '评论' }]} />
      <Button icon={<ReloadOutlined />} onClick={() => void load(page)} loading={loading}>刷新</Button>
    </Space>
    {loadError && <Alert type="error" showIcon message="举报列表读取失败" description={loadError} action={<Button onClick={() => void load(page)}>重试</Button>} />}
    <Card className="table-card"><Table<Report> loading={loading} dataSource={rows} rowKey="id" pagination={{ current: page, pageSize: 20, total, onChange: (next) => void load(next), showSizeChanger: false }} scroll={{ x: 1050 }} locale={{ emptyText: loadError ? '读取失败，请重试' : '当前筛选下暂无举报' }} columns={[
      { title: '提交时间', dataIndex: 'createdAt', width: 165, render: (value: string) => new Date(value).toLocaleString() },
      { title: '对象', width: 90, render: (_: unknown, report: Report) => report.targetType === 'post' ? '内容' : '评论' },
      { title: '原因', width: 90, render: (_: unknown, report: Report) => targetLabel(report) },
      { title: '被举报对象', render: (_: unknown, report: Report) => <div><Typography.Text strong>{report.target.postTitle || '对象已不存在'}</Typography.Text><div><Typography.Text type="secondary">{report.targetType === 'comment' ? (report.target.commentDeleted ? '评论已删除' : report.target.commentExcerpt || '评论内容为空') : `作者：${report.target.authorNickname}`}</Typography.Text></div></div> },
      { title: '举报人', width: 110, render: (_: unknown, report: Report) => report.reporter.nickname },
      { title: '学校', width: 150, render: (_: unknown, report: Report) => report.school?.name || '平台内容' },
      { title: '状态', width: 120, render: (_: unknown, report: Report) => <Tag color={statusColor[report.status]}>{statusText[report.status]}</Tag> },
      { title: '操作', fixed: 'right', width: 120, render: (_: unknown, report: Report) => <Button type="link" onClick={() => open(report)}>查看与处理</Button> },
    ]} /></Card>
    <Modal title="举报详情" open={Boolean(selected)} onCancel={close} footer={null} width={700} maskClosable={!handling} closable={!handling}>
      {selected && <>
        <Descriptions size="small" column={2} items={[
          { key: 'reason', label: '举报原因', children: targetLabel(selected) },
          { key: 'status', label: '举报状态', children: <Tag color={statusColor[selected.status]}>{statusText[selected.status]}</Tag> },
          { key: 'reporter', label: '举报人', children: selected.reporter.nickname },
          { key: 'school', label: '学校范围', children: selected.school?.name || '平台内容' },
          { key: 'created', label: '提交时间', children: new Date(selected.createdAt).toLocaleString() },
          { key: 'handled', label: '处理时间', children: selected.handledAt ? new Date(selected.handledAt).toLocaleString() : '未处理' },
        ]} />
        <Alert className="review-note" type="info" showIcon message={`举报说明：${selected.detail || '未填写补充说明'}`} />
        <Card size="small" title="被举报对象" className="review-note">
          <Typography.Title level={5}>{selected.target.postTitle || '对象已不存在'}</Typography.Title>
          <Typography.Paragraph type="secondary">作者：{selected.target.authorNickname} · 对象状态：{postStatusText[targetStatus(selected)] || targetStatus(selected) || '未知'} · {selected.target.available ? '对象仍可读取' : '对象已不存在'}</Typography.Paragraph>
          {selected.targetType === 'comment' && <Typography.Paragraph>{selected.target.commentDeleted ? '评论已删除，正文不再展示。' : selected.target.commentExcerpt || '评论内容为空。'}</Typography.Paragraph>}
        </Card>
        {selected.status === 'pending' ? <Form layout="vertical" style={{ marginTop: 18 }}><Form.Item label="处理说明" required><Input.TextArea value={resolution} onChange={(event) => setResolution(event.target.value)} rows={3} maxLength={500} showCount placeholder="记录处理依据，驳回和处置都会写入审计日志" /></Form.Item><Space wrap><Button danger loading={handling} disabled={handling} onClick={() => confirmHandle('takedown')}>{selected.targetType === 'post' ? '下架内容' : '删除评论'}</Button><Button loading={handling} disabled={handling} onClick={() => confirmHandle('dismiss')}>驳回举报</Button></Space></Form> : <Alert className="review-note" type="success" showIcon message={`处理结果：${selected.resolution || '已处理'}`} />}
      </>}
    </Modal>
  </>;
}
