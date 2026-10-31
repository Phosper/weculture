import { useCallback, useEffect, useRef, useState } from 'react';
import { ReloadOutlined } from '@ant-design/icons';
import { Alert, Button, Card, Col, Input, Row, Select, Space, Statistic, Table, Tag, Typography } from 'antd';
import { client } from './api';
import type { Admin } from './posts';

type AnalyticsRow = { date: string; eventCode: string; count: number; uniqueActors: number };
type AnalyticsTotal = { eventCode: string; count: number; uniqueActors: number };
type AnalyticsResponse = { from: string; to: string; schoolId: string | null; items: AnalyticsRow[]; totals: AnalyticsTotal[]; truncated: boolean };
type School = { id: string; name: string; shortName: string };

const eventText: Record<string, string> = {
  search_performed: '搜索', post_viewed: '内容浏览', post_published: '投稿完成', post_reviewed: '审核完成',
  comment_created: '评论／回复', event_registered: '活动报名', event_cancelled: '取消报名'
};
const localDate = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
const daysAgo = (days: number) => { const date = new Date(); date.setDate(date.getDate() - days); return localDate(date); };

export function Analytics({ admin }: { admin: Admin }) {
  const platformAdmin = admin.role === 'super_admin';
  const [from, setFrom] = useState(daysAgo(6));
  const [to, setTo] = useState(localDate(new Date()));
  const [schoolId, setSchoolId] = useState('');
  const [schools, setSchools] = useState<School[]>([]);
  const [data, setData] = useState<AnalyticsResponse>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const request = useRef(0);

  useEffect(() => {
    if (!platformAdmin) return;
    client.get<School[]>('/admin/schools').then(setSchools).catch(() => setSchools([]));
  }, [platformAdmin]);

  const load = useCallback(async () => {
    const current = ++request.current;
    setLoading(true); setError('');
    const query = new URLSearchParams({ from, to });
    if (platformAdmin && schoolId) query.set('schoolId', schoolId);
    try {
      const result = await client.get<AnalyticsResponse>(`/admin/analytics?${query}`);
      if (current === request.current) setData(result);
    } catch (failure) {
      if (current === request.current) { setData(undefined); setError((failure as Error).message); }
    } finally { if (current === request.current) setLoading(false); }
  }, [from, to, schoolId, platformAdmin]);

  useEffect(() => { void load(); return () => { request.current += 1; }; }, [load]);

  const totalEvents = data?.totals.reduce((sum, item) => sum + item.count, 0) || 0;
  return <>
    <Typography.Title level={2}>数据统计</Typography.Title>
    <Typography.Paragraph type="secondary">只展示按日聚合的事件计数和去重行为人数；不包含搜索词、评论正文、OpenID 或其他身份信息。统计写入失败不影响业务。</Typography.Paragraph>
    <Space wrap className="toolbar posts-filters">
      <span>开始日期<Input type="date" value={from} onChange={(event) => setFrom(event.target.value)} style={{ width: 160, marginLeft: 8 }} /></span>
      <span>结束日期<Input type="date" value={to} onChange={(event) => setTo(event.target.value)} style={{ width: 160, marginLeft: 8 }} /></span>
      {platformAdmin && <Select aria-label="学校筛选" value={schoolId} onChange={setSchoolId} style={{ minWidth: 190 }} options={[{ value: '', label: '全部学校／平台' }, ...schools.map((school) => ({ value: school.id, label: school.name }))]} />}
      <Button icon={<ReloadOutlined />} onClick={() => void load()} loading={loading}>刷新</Button>
    </Space>
    {error && <Alert type="error" showIcon message="统计数据读取失败" description={error} action={<Button onClick={() => void load()}>重试</Button>} />}
    {data?.truncated && <Alert className="review-note" type="warning" showIcon message="统计范围数据过多，仅统计前 20,000 条事件；请缩短日期范围。" />}
    <Row gutter={[18, 18]}>
      <Col xs={24} sm={12} lg={8}><Card className="metric orange"><Statistic title="事件总数" value={totalEvents} /></Card></Col>
      <Col xs={24} sm={12} lg={8}><Card className="metric blue"><Statistic title="事件类型" value={data?.totals.length || 0} /></Card></Col>
      <Col xs={24} sm={12} lg={8}><Card className="metric green"><Statistic title="统计天数" value={data?.items.length ? new Set(data.items.map((item) => item.date)).size : 0} /></Card></Col>
    </Row>
    <Card title="按事件汇总" className="table-card">
      <Table<AnalyticsTotal> loading={loading} dataSource={data?.totals || []} rowKey="eventCode" pagination={false} locale={{ emptyText: error ? '读取失败，请重试' : '所选范围暂无事件' }} columns={[
        { title: '事件', dataIndex: 'eventCode', render: (value: string) => <Tag color="blue">{eventText[value] || value}</Tag> },
        { title: '次数', dataIndex: 'count', width: 120 },
        { title: '去重行为人数', dataIndex: 'uniqueActors', width: 150 },
      ]} />
    </Card>
    <Card title="按日明细" className="table-card">
      <Table<AnalyticsRow> loading={loading} dataSource={data?.items || []} rowKey={(row) => `${row.date}-${row.eventCode}`} pagination={{ pageSize: 14 }} scroll={{ x: 620 }} columns={[
        { title: '日期', dataIndex: 'date', width: 140 },
        { title: '事件', dataIndex: 'eventCode', render: (value: string) => eventText[value] || value },
        { title: '次数', dataIndex: 'count', width: 120 },
        { title: '去重行为人数', dataIndex: 'uniqueActors', width: 150 },
      ]} />
    </Card>
  </>;
}
