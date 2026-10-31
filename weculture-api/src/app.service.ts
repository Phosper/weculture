import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import * as bcrypt from 'bcryptjs';
import { createHash } from 'node:crypto';
import { DataSource, EntityManager, In, Repository, SelectQueryBuilder } from 'typeorm';
import { AdminAccount, AssistantKnowledge, AssistantMessage, AuditLog, Event, EventRegistration, Favorite, InviteCode, Like, Post, PostComment, School, SchoolMembership, TravelRoute, User, UserPlan } from './entities';
import { adminAuthVersion, createToken, Session } from './auth';
import { AdminLoginLimiter, DEMO_ADMIN_PASSWORD, validNewAdminPassword } from './admin-security';
import { previewStoredImage } from './admin-media';
import { DbRetry } from './db-retry';
import { getSeedValue, isDemoSeedEnabled, isProduction } from './config';
import { EVENT_TIME_FILTERS, eventTimeBounds } from './event-time-filter';

type UserSession = Session & { kind: 'user' };
type AdminSession = Session & { kind: 'admin'; role?: string; schoolId?: string | null };
type PostQuery = { scope?: string; circle?: string; city?: string; schoolId?: string; type?: string; q?: string; tag?: string; eventTime?: string; status?: string; page?: string; pageSize?: string };
type RoutePlanInput = { planned: boolean; departDate?: string; companions?: number };
const POST_CIRCLES = ['city', 'international', 'campus'] as const;
const POST_QUERY_KEYS = ['scope', 'circle', 'city', 'schoolId', 'type', 'q', 'tag', 'eventTime', 'status', 'page', 'pageSize'];
const CONTENT_LANGUAGES = ['zh', 'en', 'ru', 'fr', 'es', 'ar', 'other'];

@Injectable()
export class AppService implements OnModuleInit {
  private readonly submissionQueue = new Map<string, Promise<{ id: string; status: Post['status']; message: string }>>();
  private readonly adminLoginLimiter = new AdminLoginLimiter();
  constructor(
    @InjectRepository(School) private schools: Repository<School>,
    @InjectRepository(User) private users: Repository<User>,
    @InjectRepository(SchoolMembership) private memberships: Repository<SchoolMembership>,
    @InjectRepository(InviteCode) private invites: Repository<InviteCode>,
    @InjectRepository(Post) private posts: Repository<Post>,
    @InjectRepository(Event) private events: Repository<Event>,
    @InjectRepository(EventRegistration) private registrations: Repository<EventRegistration>,
    @InjectRepository(Like) private likes: Repository<Like>,
    @InjectRepository(Favorite) private favorites: Repository<Favorite>,
    @InjectRepository(TravelRoute) private routes: Repository<TravelRoute>,
    @InjectRepository(UserPlan) private plans: Repository<UserPlan>,
    @InjectRepository(AssistantKnowledge) private knowledge: Repository<AssistantKnowledge>,
    @InjectRepository(AssistantMessage) private messages: Repository<AssistantMessage>,
    @InjectRepository(AdminAccount) private admins: Repository<AdminAccount>,
    @InjectRepository(AuditLog) private audits: Repository<AuditLog>,
    private dataSource: DataSource,
  ) {}

  async onModuleInit() { if (isDemoSeedEnabled()) await this.seed(); }

  private async seed() {
    const adminPassword = getSeedValue('ADMIN_INITIAL_PASSWORD', 'Weculture@2026');
    const operatorPassword = getSeedValue('OPERATOR_INITIAL_PASSWORD', 'Weculture@2026');
    const reviewerPassword = getSeedValue('REVIEWER_INITIAL_PASSWORD', 'Weculture@2026');
    const inviteCode = getSeedValue('SCHOOL_INVITE_CODE', 'BLCU2026');
    if (await this.schools.count()) {
      if (!await this.admins.existsBy({ username: 'blcu-reviewer' })) {
        const school = await this.schools.findOneByOrFail({ status: 'active' });
        await this.admins.save(this.admins.create({ username: 'blcu-reviewer', passwordHash: await bcrypt.hash(reviewerPassword, 10), role: 'reviewer', schoolId: school.id }));
      }
      await this.seedDesignContent();
      return;
    }
    const school = await this.schools.save(this.schools.create({ name: '北京语言大学', shortName: 'BLCU' }));
    await this.invites.save(this.invites.create({ schoolId: school.id, code: inviteCode, batchName: '首期内测', maxUses: 500, expiresAt: null }));
    const admin = this.admins.create({ username: 'admin', passwordHash: await bcrypt.hash(adminPassword, 10), role: 'super_admin', schoolId: null });
    await this.admins.save(admin);
    const operator = this.admins.create({ username: 'blcu-operator', passwordHash: await bcrypt.hash(operatorPassword, 10), role: 'operator', schoolId: school.id });
    await this.admins.save(operator);
    await this.admins.save(this.admins.create({ username: 'blcu-reviewer', passwordHash: await bcrypt.hash(reviewerPassword, 10), role: 'reviewer', schoolId: school.id }));
    const posts = await this.posts.save([
      this.posts.create({ schoolId: null, authorId: admin.id, type: 'dynamic', visibility: 'platform', status: 'approved', title: '非遗扇艺工作坊开放报名', content: '用一把团扇，认识工笔、颜色与中国传统生活美学。', tag: '非遗工坊', imageUrl: 'https://images.unsplash.com/photo-1545987796-200677ee1011?auto=format&fit=crop&w=900&q=80' }),
      this.posts.create({ schoolId: school.id, circle: 'campus', authorId: admin.id, type: 'dynamic', visibility: 'school', status: 'approved', title: '本周校园文化活动清单', content: '茶艺社体验、语言交换夜与周末故宫文化行已开放报名。', tag: '校园文化', imageUrl: 'https://images.unsplash.com/photo-1519692933481-e162a57d6721?auto=format&fit=crop&w=900&q=80' }),
      this.posts.create({ schoolId: school.id, circle: 'campus', authorId: admin.id, type: 'event', visibility: 'school', status: 'approved', title: '周末故宫文化行', content: '面向本校同学的深度文化行走活动，含讲解与交流环节。', tag: '校内活动', imageUrl: 'https://images.unsplash.com/photo-1508804185872-d7badad00f7d?auto=format&fit=crop&w=900&q=80' }),
      this.posts.create({ schoolId: school.id, circle: 'campus', authorId: admin.id, type: 'market', visibility: 'school', status: 'approved', title: '转让九成新台灯', content: '宿舍自取，使用正常，适合夜间自习。', tag: '校园闲置', imageUrl: '' })
    ]);
    const eventStart = new Date();
    eventStart.setDate(eventStart.getDate() + 2);
    eventStart.setHours(9, 0, 0, 0);
    const eventEnd = new Date(eventStart);
    eventEnd.setHours(17, 0, 0, 0);
    const registrationDeadline = new Date(eventStart);
    registrationDeadline.setHours(18, 0, 0, 0);
    registrationDeadline.setDate(registrationDeadline.getDate() - 1);
    await this.events.save(this.events.create({ postId: posts[2].id, startsAt: eventStart, endsAt: eventEnd, location: '东城区故宫博物院', registrationDeadline, capacity: 30 }));
    await this.routes.save([
      this.routes.create({ schoolId: null, visibility: 'platform', title: '京城文化 3 日游', destination: '北京', days: '1-3天', budget: 899, preferences: '文化,艺术', stops: '故宫 -> 南锣鼓巷 -> 慕田峪长城', highlights: '故宫讲解,胡同深度,长城索道', coverUrl: 'https://images.unsplash.com/photo-1508804185872-d7badad00f7d?auto=format&fit=crop&w=900&q=80' }),
      this.routes.create({ schoolId: null, visibility: 'platform', title: '上海海派风情 2 日游', destination: '上海', days: '1-3天', budget: 1299, preferences: '文化,美食,艺术', stops: '外滩 -> 武康路 -> 豫园', highlights: '外滩摄影,海派建筑,本帮美食', coverUrl: 'https://images.unsplash.com/photo-1548919973-5cef591cdbc9?auto=format&fit=crop&w=900&q=80' })
    ]);
    await this.knowledge.save([
      this.knowledge.create({ schoolId: school.id, question: '怎么查课表？', keywords: '课表,课程,上课', answer: '课程安排请以教务系统为准。你可以先在校园服务入口查看本周课程；如有变化，请联系学院教务老师。' }),
      this.knowledge.create({ schoolId: school.id, question: '如何参加校园活动？', keywords: '活动,报名,讲座', answer: '进入“社区”查看校内活动，打开详情后点击报名即可。报名成功后会进入“我的计划”。' }),
      this.knowledge.create({ schoolId: null, question: '有什么文化旅行推荐？', keywords: '旅行,路线,文化', answer: '你可以在“旅行”页选择目的地、天数和偏好，我会基于平台路线库给出推荐。' })
    ]);
    await this.seedDesignContent();
  }

  private async seedDesignContent() {
    const admin = await this.admins.findOneBy({ username: 'admin' });
    const school = await this.schools.findOneBy({ shortName: 'BLCU' });
    if (!admin || !school) return;
    const samples: Array<{ title: string; content: string; tag: string; type: Post['type']; visibility: Post['visibility']; schoolId: string | null; imageUrl: string }> = [
      { title: '沉浸式体验非遗：我们在校园里办了一场茶艺社！', content: '从闻香、温杯到冲泡，在校园里认识茶文化的日常之美。', tag: '文化大使', type: 'dynamic', visibility: 'platform', schoolId: null, imageUrl: 'asset://photo-tea-ceremony.jpg' },
      { title: '当水墨遇见极简主义：我的毕业展倒计时。', content: '用水墨的留白，重新讲述年轻人的视觉语言。', tag: '文化传承', type: 'dynamic', visibility: 'platform', schoolId: null, imageUrl: 'asset://photo-ink-painting.jpg' },
      { title: '剪纸艺术进校园，这就是指尖上的中国魅力！', content: '一张红纸、一把剪刀，剪出传统技艺的新故事。', tag: '非遗工坊', type: 'dynamic', visibility: 'platform', schoolId: null, imageUrl: 'asset://photo-paper-cutting.jpg' },
      { title: '寻找校园里的“梁思成”：中式古建的结构之美。', content: '从斗拱到飞檐，一起观察建筑背后的文化记忆。', tag: '古建探秘', type: 'dynamic', visibility: 'platform', schoolId: null, imageUrl: 'asset://photo-ancient-architecture.jpg' },
      { title: '校园网连接问题互助帖', content: '校园网连接失败时，先检查网络设置与学校官方通知；也欢迎同学在评论区分享经验。', tag: '互助', type: 'dynamic', visibility: 'school', schoolId: school.id, imageUrl: '' },
      { title: '转让闲置 iPhone 充电器', content: '九成新，面交自取，价格 ¥15。', tag: '闲置 · ¥15', type: 'market', visibility: 'school', schoolId: school.id, imageUrl: 'asset://photo-iphone-charger.jpg' }
    ];
    for (const sample of samples) {
      if (!await this.posts.existsBy({ title: sample.title })) {
        await this.posts.save(this.posts.create({ ...sample, circle: sample.visibility === 'school' ? 'campus' : null, authorId: admin.id, status: 'approved' }));
      }
    }
  }

  private async currentUser(session: UserSession) { if (typeof session.id !== 'string' || !session.id) throw new ForbiddenException('账号不可用'); const user = await this.users.findOneBy({ id: session.id }); if (!user || user.status !== 'active') throw new ForbiddenException('账号不可用'); return user; }
  private async verifiedMembership(userId: string) { const member = await this.memberships.findOneBy({ userId, verificationStatus: 'verified' }); if (!member) throw new ForbiddenException('请先完成学校认证'); return member; }
  private async visiblePost(postId: string, userId: string, allowAuthorPreview = false) {
    const post = await this.posts.findOneBy({ id: postId });
    if (!post || (post.status !== 'approved' && !(allowAuthorPreview && post.authorId === userId))) throw new NotFoundException('内容不存在或不可见');
    if (allowAuthorPreview && post.authorId === userId && post.status !== 'approved') return post;
    if (post.circle === 'campus' || post.visibility === 'school' || post.schoolId) {
      const member = await this.verifiedMembership(userId);
      if (!post.schoolId || member.schoolId !== post.schoolId) throw new ForbiddenException('无权查看其他学校内容');
    }
    return post;
  }
  private async audit(admin: AdminSession, action: string, resourceType: string, resourceId: string, detail = '') { await this.audits.save(this.audits.create({ adminId: admin.id, schoolId: admin.schoolId || null, action, resourceType, resourceId, detail })); }
  private ensureAdminScope(admin: AdminSession, schoolId: string | null) { if (admin.role !== 'super_admin' && (!schoolId || admin.schoolId !== schoolId)) throw new ForbiddenException('无权操作该学校资源'); }
  private requireAdminRole(admin: AdminSession, ...roles: Array<NonNullable<AdminSession['role']>>) { if (!admin.role || !roles.includes(admin.role)) throw new ForbiddenException('当前管理员角色无权执行此操作'); }
  private async activeAdmin(session: AdminSession) {
    const admin = await DbRetry.read(() => this.admins.findOneBy({ id: session.id, status: 'active' }));
    if (!admin) throw new ForbiddenException('管理员账号不可用');
    return { id: admin.id, kind: 'admin' as const, role: admin.role, schoolId: admin.schoolId };
  }
  private ensureAdminPostScope(admin: AdminSession, post: Pick<Post, 'circle' | 'visibility' | 'schoolId'>) {
    this.requireAdminRole(admin, 'super_admin', 'operator', 'reviewer');
    if (admin.role !== 'super_admin' && (post.circle !== 'campus' || post.visibility !== 'school' || !post.schoolId || post.schoolId !== admin.schoolId)) throw new ForbiddenException('只能处理本校校园圈内容');
  }
  private validatePostQuery(query: PostQuery) {
    for (const [key, value] of Object.entries(query)) if (!POST_QUERY_KEYS.includes(key) || (value !== undefined && typeof value !== 'string')) throw new BadRequestException('筛选参数无效');
    if (query.circle && !POST_CIRCLES.includes(query.circle as typeof POST_CIRCLES[number])) throw new BadRequestException('圈层无效');
    if (query.scope && !['platform', 'school'].includes(query.scope)) throw new BadRequestException('内容范围无效');
    if (query.type && !['dynamic', 'event', 'market'].includes(query.type)) throw new BadRequestException('内容类型无效');
    if (query.city && (query.city.trim().length > 50 || !query.city.trim())) throw new BadRequestException('城市应为1至50个字符');
    if (query.schoolId && (query.schoolId.length > 80 || !query.schoolId.trim())) throw new BadRequestException('学校参数无效');
    if (query.q && query.q.length > 100) throw new BadRequestException('搜索词过长');
    if (query.tag !== undefined && (!query.tag.trim() || query.tag.trim().length > 80)) throw new BadRequestException('话题应为1至80个字符');
    if (query.eventTime !== undefined && !EVENT_TIME_FILTERS.includes(query.eventTime as typeof EVENT_TIME_FILTERS[number])) throw new BadRequestException('活动时间筛选无效');
    if (query.eventTime && query.eventTime !== 'all' && query.type && query.type !== 'event') throw new BadRequestException('时间筛选仅适用于活动');
    if ((query.circle === 'campus' && query.scope === 'platform') || (query.circle && query.circle !== 'campus' && query.scope === 'school')) throw new BadRequestException('圈层与内容范围不一致');
  }
  private applyPostFilters(qb: SelectQueryBuilder<Post>, query: PostQuery) {
    if (query.circle) qb.andWhere('post.circle = :circle', { circle: query.circle });
    if (query.city) {
      const city = query.city.trim(), shortCity = city.endsWith('市') ? city.slice(0, -1) : city;
      const cityNames = shortCity && !/(自治州|地区|盟)$/.test(shortCity) ? [shortCity, `${shortCity}市`] : [city];
      qb.andWhere('post.city IN (:...cityNames)', { cityNames });
    }
    if (query.schoolId) qb.andWhere('post.schoolId = :requestedSchoolId', { requestedSchoolId: query.schoolId });
    if (query.type) qb.andWhere('post.type = :type', { type: query.type });
    if (query.tag !== undefined) {
      // MySQL's default collation can ignore case/accents/trailing spaces. A topic
      // is a complete literal value on both databases, independent of collation.
      qb.andWhere(this.dataSource.options.type === 'mysql' ? 'BINARY post.tag = BINARY :tag' : 'post.tag = :tag COLLATE BINARY', { tag: query.tag.trim() });
    }
    if (query.eventTime && query.eventTime !== 'all') {
      const bounds = eventTimeBounds(query.eventTime as 'upcoming' | 'today' | 'week');
      qb.innerJoin(Event, 'filteredEvent', 'filteredEvent.postId = post.id')
        .andWhere('post.type = :eventType AND filteredEvent.status = :eventStatus AND filteredEvent.startsAt >= :eventFrom', { eventType: 'event', eventStatus: 'active', eventFrom: bounds.from });
      if (bounds.until) qb.andWhere('filteredEvent.startsAt < :eventUntil', { eventUntil: bounds.until });
    }
    if (query.q?.trim()) {
      const keyword = query.q.trim().toLocaleLowerCase().replace(/[!%_]/g, '!$&');
      qb.leftJoin(User, 'author', 'author.id = post.authorId').andWhere(`(LOWER(post.title) LIKE :search ESCAPE '!' OR LOWER(post.content) LIKE :search ESCAPE '!' OR LOWER(post.tag) LIKE :search ESCAPE '!' OR LOWER(COALESCE(NULLIF(author.nickname, ''), CASE WHEN author.id IS NULL THEN 'Weculture' ELSE 'Weculture 用户' END)) LIKE :search ESCAPE '!')`, { search: `%${keyword}%` });
    }
    return qb.orderBy('post.createdAt', 'DESC').addOrderBy('post.id', 'DESC');
  }
  private pagination(query: PostQuery, circlePages = true) {
    const enabled = Boolean((circlePages && query.circle) || query.page !== undefined || query.pageSize !== undefined);
    const parse = (value: string | undefined, fallback: number, maximum: number) => {
      if (value === undefined) return fallback;
      if (!/^[1-9]\d*$/.test(value) || Number(value) > maximum) throw new BadRequestException('分页参数无效');
      return Number(value);
    };
    return { enabled, page: parse(query.page, 1, 100000), pageSize: parse(query.pageSize, 20, 100) };
  }
  private circleMetadata(data: Record<string, unknown>, defaultCircle: Post['circle'] = 'campus') {
    const circle = data.circle === undefined ? defaultCircle : data.circle;
    if (typeof circle !== 'string' || !POST_CIRCLES.includes(circle as typeof POST_CIRCLES[number])) throw new BadRequestException('请选择有效圈层');
    const city = typeof data.city === 'string' ? data.city.trim() : '';
    const contentLanguage = typeof data.contentLanguage === 'string' ? data.contentLanguage.trim() : '';
    if (circle === 'city' && (!city || city.length > 50)) throw new BadRequestException('同城投稿请填写1至50个字符的城市');
    if (circle === 'international' && !CONTENT_LANGUAGES.includes(contentLanguage)) throw new BadRequestException('请选择有效的内容语言');
    if ((circle !== 'city' && city) || (circle !== 'international' && contentLanguage)) throw new BadRequestException('圈层与城市或语言不一致');
    if (circle !== 'campus' && data.schoolId) throw new BadRequestException('公开圈层不能绑定学校');
    return { circle: circle as NonNullable<Post['circle']>, city: circle === 'city' ? city : null, contentLanguage: circle === 'international' ? contentLanguage : null, visibility: circle === 'campus' ? 'school' as const : 'platform' as const };
  }
  private postContent(data: Record<string, unknown>, circle: NonNullable<Post['circle']>) {
    const title = String(data.title || '').trim(), content = String(data.content || '').trim(), type = String(data.type || 'dynamic') as Post['type'];
    if (!['dynamic', 'event', 'market'].includes(type) || title.length < 2 || title.length > 40 || content.length < 2 || content.length > 2000) throw new BadRequestException('请填写有效的标题和正文');
    const tag = String(data.tag || (type === 'event' ? (circle === 'campus' ? '校内活动' : '文化活动') : type === 'market' ? (circle === 'campus' ? '校园闲置' : '闲置交流') : (circle === 'campus' ? '校园动态' : '文化分享'))).trim();
    const imageUrl = String(data.imageUrl || '');
    if (tag.length > 80 || imageUrl.length > 2048) throw new BadRequestException('标签或图片地址过长');
    return { type, title, content, tag, imageUrl };
  }
  private eventContent(data: Record<string, unknown>, previous?: Event | null) {
    const merged = previous ? { ...previous, ...data } : data;
    const parseDate = (value: unknown) => value instanceof Date ? new Date(value) : new Date(String(value));
    const startsAt = parseDate(merged.startsAt), endsAt = parseDate(merged.endsAt), registrationDeadline = parseDate(merged.registrationDeadline);
    const capacity = Number(merged.capacity), location = String(merged.location || '').trim();
    const unchangedSchedule = previous && +startsAt === +previous.startsAt && +endsAt === +previous.endsAt && +registrationDeadline === +previous.registrationDeadline;
    if (Number.isNaN(+startsAt) || Number.isNaN(+endsAt) || Number.isNaN(+registrationDeadline) || !location || location.length > 200 || !Number.isInteger(capacity) || capacity < Math.max(1, previous?.registeredCount || 0) || startsAt >= endsAt || registrationDeadline >= startsAt || (!unchangedSchedule && (registrationDeadline <= new Date() || startsAt <= new Date()))) throw new BadRequestException('活动信息不完整、人数无效或时间已过期');
    return { startsAt, endsAt, registrationDeadline, location, capacity };
  }

  async userLogin(code?: string, cloudOpenId?: string) {
    const trustedOpenId = cloudOpenId?.trim();
    if (trustedOpenId && trustedOpenId.length > 128) throw new BadRequestException('微信用户标识无效');
    if (!trustedOpenId && !code?.trim()) throw new BadRequestException('缺少微信登录凭证');
    const openId = trustedOpenId || await this.resolveWechatOpenId(code!.trim());
    let user = await this.users.findOneBy({ wechatOpenId: openId });
    if (!user) user = await this.users.save(this.users.create({ wechatOpenId: openId }));
    const membership = await this.memberships.findOneBy({ userId: user.id, verificationStatus: 'verified' });
    const token = createToken({ id: user.id, kind: 'user', schoolId: membership?.schoolId || null });
    return { token, user: await this.userSummary(user.id), isNew: !user.nickname };
  }

  private async resolveWechatOpenId(code: string) {
    if (code.startsWith('dev-')) {
      if (isProduction()) throw new BadRequestException('生产环境不接受开发登录标识');
      return code.slice(0, 68);
    }

    const appId = process.env.WECHAT_APP_ID?.trim();
    const appSecret = process.env.WECHAT_APP_SECRET?.trim();
    if (!appId || !appSecret) {
      if (isProduction()) throw new BadRequestException('微信登录配置不完整');
      return `wechat_${code.slice(0, 64)}`;
    }

    const params = new URLSearchParams({ appid: appId, secret: appSecret, js_code: code, grant_type: 'authorization_code' });
    const response = await fetch(`https://api.weixin.qq.com/sns/jscode2session?${params.toString()}`);
    const result = await response.json() as { openid?: string; errcode?: number; errmsg?: string };
    if (!response.ok || !result.openid) throw new BadRequestException(result.errmsg || `微信登录失败（${result.errcode || response.status}）`);
    return result.openid;
  }

  async userSummary(userId: string) {
    const user = await this.users.findOneByOrFail({ id: userId });
    const membership = await this.memberships.findOneBy({ userId, verificationStatus: 'verified' });
    const school = membership ? await this.schools.findOneBy({ id: membership.schoolId }) : null;
    return { id: user.id, nickname: user.nickname, avatarUrl: user.avatarUrl, status: user.status, school: school ? { id: school.id, name: school.name, shortName: school.shortName } : null, verified: Boolean(membership) };
  }

  async getMe(session: UserSession) { await this.currentUser(session); return this.userSummary(session.id); }
  async myPosts(session: UserSession) { await this.currentUser(session); const posts = await this.posts.find({ where: { authorId: session.id }, order: { createdAt: 'DESC' } }); return Promise.all(posts.map((post) => this.decoratePost(post, session.id))); }
  async updateMe(session: UserSession, payload: { nickname?: string; avatarUrl?: string }) {
    const user = await this.currentUser(session);
    if (payload.nickname !== undefined) { if (payload.nickname.trim().length < 2 || payload.nickname.trim().length > 20) throw new BadRequestException('昵称应为2至20个字符'); user.nickname = payload.nickname.trim(); }
    if (payload.avatarUrl !== undefined) user.avatarUrl = payload.avatarUrl;
    await this.users.save(user); return this.userSummary(user.id);
  }

  async verifySchool(session: UserSession, code: string) {
    await this.currentUser(session); const invite = await this.invites.findOneBy({ code: code?.trim().toUpperCase() });
    if (!invite || invite.status !== 'active' || (invite.expiresAt && invite.expiresAt < new Date()) || invite.usedCount >= invite.maxUses) throw new BadRequestException('邀请码无效、已过期或已用完');
    let member = await this.memberships.findOneBy({ userId: session.id, schoolId: invite.schoolId });
    if (!member) { member = await this.memberships.save(this.memberships.create({ userId: session.id, schoolId: invite.schoolId })); invite.usedCount += 1; await this.invites.save(invite); }
    return this.userSummary(session.id);
  }

  async listPosts(session: UserSession, query: PostQuery) {
    await this.currentUser(session);
    this.validatePostQuery(query);
    const member = await this.memberships.findOneBy({ userId: session.id, verificationStatus: 'verified' });
    if (query.schoolId && (!member || query.schoolId !== member.schoolId)) throw new ForbiddenException('无权查看其他学校内容');
    const pagination = this.pagination(query);
    const qb = this.visiblePostsQuery(member?.schoolId, query);
    this.applyPostFilters(qb, query);
    if (pagination.enabled) {
      const [posts, total] = await qb.skip((pagination.page - 1) * pagination.pageSize).take(pagination.pageSize).getManyAndCount();
      return { items: await Promise.all(posts.map((post) => this.decoratePost(post, session.id))), page: pagination.page, pageSize: pagination.pageSize, total, hasMore: pagination.page * pagination.pageSize < total };
    }
    return Promise.all((await qb.getMany()).map((post) => this.decoratePost(post, session.id)));
  }

  // Discovery and public author pages must use the same conservative predicate,
  // including legacy public posts and excluding inconsistent school metadata.
  private visiblePostsQuery(schoolId?: string, query: PostQuery = {}) {
    const qb = this.posts.createQueryBuilder('post').where('post.status = :status', { status: 'approved' });
    if (query.scope === 'school' || query.circle === 'campus') {
      if (!schoolId) throw new ForbiddenException('请先完成学校认证');
      qb.andWhere('post.schoolId = :schoolId AND post.visibility = :visibility AND post.circle = :campus', { schoolId, visibility: 'school', campus: 'campus' });
    } else if (query.scope === 'platform' || query.circle) {
      qb.andWhere('post.visibility = :platform AND post.schoolId IS NULL AND (post.circle IS NULL OR post.circle IN (:...publicCircles))', { platform: 'platform', publicCircles: ['city', 'international'] });
    } else {
      qb.andWhere('((post.visibility = :platform AND post.schoolId IS NULL AND (post.circle IS NULL OR post.circle IN (:...publicCircles))) OR (post.visibility = :school AND post.circle = :campus AND post.schoolId = :schoolId))', { platform: 'platform', school: 'school', campus: 'campus', publicCircles: ['city', 'international'], schoolId: schoolId || '__none__' });
    }
    return qb;
  }

  private publicUserQuery(query: Record<string, unknown>, search = false) {
    const allowed = search ? ['q', 'page', 'pageSize'] : ['page', 'pageSize'];
    if (Object.entries(query).some(([key, value]) => !allowed.includes(key) || typeof value !== 'string')) throw new BadRequestException('用户查询参数无效');
    if (search && (typeof query.q !== 'string' || !query.q.trim() || query.q.trim().length > 100)) throw new BadRequestException('请输入1至100个字符的搜索词');
    return this.pagination(query as PostQuery, false);
  }

  private async publicUser(id: string) {
    if (!/^[a-zA-Z0-9_-]{1,80}$/.test(id)) throw new BadRequestException('用户参数无效');
    const user = await this.users.findOneBy({ id, status: 'active' });
    if (!user) throw new NotFoundException('用户不存在');
    return user;
  }

  private publicUserSummary(user: User, visiblePostCount: number) {
    return { id: user.id, nickname: user.nickname || 'Weculture 用户', avatarUrl: user.avatarUrl, visiblePostCount };
  }

  async searchUsers(session: UserSession, query: Record<string, unknown>) {
    await this.currentUser(session);
    const { page, pageSize } = this.publicUserQuery(query, true);
    const member = await this.memberships.findOneBy({ userId: session.id, verificationStatus: 'verified' });
    const visibleCount = this.visiblePostsQuery(member?.schoolId).select('COUNT(*)').andWhere('post.authorId = user.id');
    const countSql = `(${visibleCount.getQuery()})`;
    const nickname = "COALESCE(NULLIF(user.nickname, ''), 'Weculture 用户')";
    const searchExpression = this.dataSource.options.type === 'mysql' ? `BINARY LOWER(${nickname}) LIKE BINARY :userSearch ESCAPE '!'` : `LOWER(${nickname}) LIKE :userSearch ESCAPE '!'`;
    const keyword = (query.q as string).trim().toLowerCase().replace(/[!%_]/g, '!$&');
    const qb = this.users.createQueryBuilder('user').select('user.id', 'id').addSelect(nickname, 'nickname').addSelect('user.avatarUrl', 'avatarUrl')
      .addSelect(countSql, 'visiblePostCount').where('user.status = :activeUser', { activeUser: 'active' })
      .andWhere(searchExpression, { userSearch: `%${keyword}%` }).andWhere(`${countSql} > 0`).setParameters(visibleCount.getParameters());
    const total = await qb.getCount();
    const items = await qb.orderBy(nickname, 'ASC').addOrderBy('user.id', 'ASC').offset((page - 1) * pageSize).limit(pageSize)
      .getRawMany<{ id: string; nickname: string; avatarUrl: string; visiblePostCount: string | number }>();
    return { items: items.map((item) => ({ ...item, visiblePostCount: Number(item.visiblePostCount) })), page, pageSize, total, hasMore: page * pageSize < total };
  }

  async getUserProfile(session: UserSession, id: string, query: Record<string, unknown> = {}) {
    await this.currentUser(session);
    if (Object.keys(query).length) throw new BadRequestException('用户查询参数无效');
    const user = await this.publicUser(id);
    const member = await this.memberships.findOneBy({ userId: session.id, verificationStatus: 'verified' });
    const visiblePostCount = await this.visiblePostsQuery(member?.schoolId).andWhere('post.authorId = :authorId', { authorId: user.id }).getCount();
    return this.publicUserSummary(user, visiblePostCount);
  }

  async getUserPosts(session: UserSession, id: string, query: Record<string, unknown>) {
    await this.currentUser(session);
    const { page, pageSize } = this.publicUserQuery(query);
    const user = await this.publicUser(id);
    const member = await this.memberships.findOneBy({ userId: session.id, verificationStatus: 'verified' });
    const [posts, total] = await this.visiblePostsQuery(member?.schoolId).andWhere('post.authorId = :authorId', { authorId: user.id })
      .orderBy('post.createdAt', 'DESC').addOrderBy('post.id', 'DESC').skip((page - 1) * pageSize).take(pageSize).getManyAndCount();
    return { items: await Promise.all(posts.map((post) => this.decoratePost(post, session.id))), page, pageSize, total, hasMore: page * pageSize < total };
  }

  async getPost(session: UserSession, postId: string) { await this.currentUser(session); return this.decoratePost(await this.visiblePost(postId, session.id, true), session.id); }
  private async commentPost(manager: EntityManager, session: UserSession, postId: string, write = false) {
    const lock = write && this.dataSource.options.type === 'mysql';
    const userQuery = manager.getRepository(User).createQueryBuilder('user').where('user.id = :userId', { userId: session.id });
    if (lock) userQuery.setLock('pessimistic_read');
    const user = await userQuery.getOne();
    if (!user || user.status !== 'active') throw new ForbiddenException('账号不可用');
    const postQuery = manager.getRepository(Post).createQueryBuilder('post').where('post.id = :postId', { postId });
    // All comment writers lock the same post before checking a request key or parent.
    // This serializes retries and reply/delete races across server instances.
    if (lock) postQuery.setLock('pessimistic_write');
    const post = await postQuery.getOne();
    if (!post || post.status !== 'approved') throw new NotFoundException('内容不存在或不可见');
    if (post.circle === 'campus' || post.visibility === 'school' || post.schoolId) {
      const memberQuery = manager.getRepository(SchoolMembership).createQueryBuilder('member')
        .where('member.userId = :userId AND member.verificationStatus = :verified', { userId: session.id, verified: 'verified' });
      if (lock) memberQuery.setLock('pessimistic_read');
      const member = await memberQuery.getOne();
      if (!member) throw new ForbiddenException('请先完成学校认证');
      if (!post.schoolId || member.schoolId !== post.schoolId) throw new ForbiddenException('无权查看其他学校内容');
    }
    return post;
  }
  private async decorateComments(manager: EntityManager, comments: PostComment[], post: Post, userId: string) {
    const parentIds = [...new Set(comments.flatMap((comment) => comment.parentId ? [comment.parentId] : []))];
    const parents = parentIds.length ? await manager.findBy(PostComment, { id: In(parentIds), postId: post.id }) : [];
    const authorIds = [...new Set([...comments, ...parents].map((comment) => comment.authorId))];
    const authors = authorIds.length ? await manager.findBy(User, { id: In(authorIds) }) : [];
    const authorMap = new Map(authors.map((author) => [author.id, author]));
    const parentMap = new Map(parents.map((parent) => [parent.id, parent]));
    const authorFor = (id: string) => {
      const author = authorMap.get(id);
      return { id, nickname: author ? author.nickname || 'Weculture 用户' : 'Weculture', avatarUrl: author?.avatarUrl || '', profileAvailable: author?.status === 'active' };
    };
    return comments.map((comment) => {
      const parent = comment.parentId ? parentMap.get(comment.parentId) : undefined;
      return {
        id: comment.id, postId: comment.postId, content: comment.deleted ? '' : comment.content,
        createdAt: comment.createdAt, deleted: comment.deleted, author: authorFor(comment.authorId),
        isPostAuthor: comment.authorId === post.authorId,
        canDelete: !comment.deleted && comment.authorId === userId, canReply: !comment.deleted,
        parent: parent ? { id: parent.id, nickname: authorFor(parent.authorId).nickname, deleted: parent.deleted } : null,
      };
    });
  }
  async listComments(session: UserSession, postId: string, query: Record<string, unknown>) {
    if (Object.keys(query).some((key) => !['page', 'pageSize'].includes(key))) throw new BadRequestException('分页参数无效');
    const number = (value: unknown, fallback: number, maximum: number) => {
      if (value === undefined) return fallback;
      if (typeof value !== 'string' || !/^[1-9]\d*$/.test(value) || Number(value) > maximum) throw new BadRequestException('分页参数无效');
      return Number(value);
    };
    const page = number(query.page, 1, 10000), pageSize = number(query.pageSize, 20, 50);
    return this.eventTransaction(async (manager) => {
      const post = await this.commentPost(manager, session, postId);
      const repository = manager.getRepository(PostComment);
      const [comments, total] = await repository.findAndCount({ where: { postId }, order: { createdAt: 'DESC', id: 'DESC' }, skip: (page - 1) * pageSize, take: pageSize });
      const activeCount = await repository.countBy({ postId, deleted: false });
      return { items: await this.decorateComments(manager, comments, post, session.id), page, pageSize, total, hasMore: page * pageSize < total, activeCount };
    });
  }
  async createComment(session: UserSession, postId: string, body: unknown) {
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new BadRequestException('评论参数无效');
    const data = body as Record<string, unknown>;
    if (Object.keys(data).some((key) => !['content', 'clientRequestId', 'parentId'].includes(key))) throw new BadRequestException('评论参数无效');
    const content = typeof data.content === 'string' ? data.content.trim() : '';
    const clientRequestId = typeof data.clientRequestId === 'string' ? data.clientRequestId.trim() : '';
    if (!content || content.length > 500 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(content)) throw new BadRequestException('请输入1至500字的评论');
    if (!clientRequestId || clientRequestId.length > 80 || /[\u0000-\u001f\u007f]/.test(clientRequestId)) throw new BadRequestException('评论请求标识应为1至80个字符');
    if (data.parentId !== undefined && (typeof data.parentId !== 'string' || !data.parentId.trim() || data.parentId.length > 36)) throw new BadRequestException('回复对象无效');
    const parentId = typeof data.parentId === 'string' ? data.parentId.trim() : null;
    const clientRequestHash = createHash('sha256').update(clientRequestId).digest('hex');
    const submissionHash = createHash('sha256').update(JSON.stringify({ content, parentId })).digest('hex');
    return this.eventTransaction(async (manager) => {
      const post = await this.commentPost(manager, session, postId, true);
      const existing = await manager.findOneBy(PostComment, { authorId: session.id, postId, clientRequestHash });
      if (existing) {
        if (existing.submissionHash !== submissionHash) throw new ConflictException('评论内容已变化，请重新提交');
        return (await this.decorateComments(manager, [existing], post, session.id))[0];
      }
      if (parentId) {
        const parent = await manager.findOneBy(PostComment, { id: parentId, postId });
        if (!parent) throw new NotFoundException('回复对象不存在');
        if (parent.deleted) throw new ConflictException('该评论已删除，请刷新后重试');
      }
      const comment = await manager.save(PostComment, manager.create(PostComment, { authorId: session.id, postId, content, parentId, clientRequestId, clientRequestHash, submissionHash }));
      return (await this.decorateComments(manager, [comment], post, session.id))[0];
    });
  }
  async deleteComment(session: UserSession, postId: string, commentId: string) {
    return this.eventTransaction(async (manager) => {
      await this.commentPost(manager, session, postId, true);
      const comment = await manager.findOneBy(PostComment, { id: commentId, postId });
      if (!comment) throw new NotFoundException('评论不存在');
      if (comment.authorId !== session.id) throw new ForbiddenException('只能删除自己的评论');
      if (!comment.deleted) await manager.update(PostComment, { id: comment.id, postId }, { deleted: true, content: '' });
      return { deleted: true, id: comment.id };
    });
  }
  private async decoratePost(post: Post, userId: string) {
    const [author, liked, favorited, event] = await Promise.all([this.users.findOneBy({ id: post.authorId }), this.likes.existsBy({ userId, postId: post.id }), this.favorites.existsBy({ userId, targetType: 'post', targetId: post.id }), post.type === 'event' ? this.events.findOneBy({ postId: post.id }) : Promise.resolve(null)]);
    const registration = event ? await this.registrations.findOneBy({ eventId: event.id, userId, status: 'registered' }) : null;
    const { clientRequestId, submissionHash, ...publicPost } = post;
    return { ...publicPost, author: author ? { id: author.id, nickname: author.nickname || 'Weculture 用户', avatarUrl: author.avatarUrl, profileAvailable: author.status === 'active' } : { id: post.authorId, nickname: 'Weculture', avatarUrl: '', profileAvailable: false }, liked, favorited, event: event ? { ...event, registered: Boolean(registration) } : null };
  }

  async createPost(session: UserSession, data: Record<string, unknown>) {
    if (typeof data.clientRequestId !== 'string') return this.createPostOnce(session, data);
    const key = `${session.id}:${data.clientRequestId}`;
    const previous = this.submissionQueue.get(key) || Promise.resolve();
    const operation = previous.catch(() => undefined).then(() => this.createPostOnce(session, data));
    this.submissionQueue.set(key, operation);
    try { return await operation; }
    finally { if (this.submissionQueue.get(key) === operation) this.submissionQueue.delete(key); }
  }

  private async createPostOnce(session: UserSession, data: Record<string, unknown>) {
    await this.currentUser(session);
    const metadata = this.circleMetadata(data);
    const member = metadata.circle === 'campus' ? await this.verifiedMembership(session.id) : null;
    if (data.schoolId && data.schoolId !== member?.schoolId) throw new ForbiddenException('无权发布其他学校内容');
    const schoolId = member?.schoolId || null;
    const { type, title, content, tag, imageUrl } = this.postContent(data, metadata.circle);
    const clientRequestId = data.clientRequestId === undefined ? null : String(data.clientRequestId);
    if (clientRequestId !== null && !/^[A-Za-z0-9_-]{8,80}$/.test(clientRequestId)) throw new BadRequestException('投稿请求标识无效');
    const submissionPayload = { schoolId, type, title, content, tag, imageUrl,
      ...(type === 'event' ? { location: String(data.location || '').trim(), startsAt: String(data.startsAt), endsAt: String(data.endsAt), registrationDeadline: String(data.registrationDeadline), capacity: Number(data.capacity) } : {}),
    };
    const submissionHash = createHash('sha256').update(JSON.stringify({ ...submissionPayload, circle: metadata.circle, city: metadata.city, contentLanguage: metadata.contentLanguage })).digest('hex');
    const legacyHash = metadata.circle === 'campus' ? createHash('sha256').update(JSON.stringify(submissionPayload)).digest('hex') : null;
    const resultFor = (post: Post) => ({ id: post.id, status: post.status, message: post.status === 'approved' ? '发布成功' : '已提交审核' });
    const replay = async () => {
      if (!clientRequestId) return null;
      const existing = await this.posts.findOneBy({ authorId: session.id, clientRequestId });
      if (existing && existing.submissionHash !== submissionHash && !(existing.circle === 'campus' && !existing.city && !existing.contentLanguage && legacyHash && existing.submissionHash === legacyHash)) throw new ConflictException('投稿内容已变化，请重新提交');
      return existing;
    };
    // A retry may arrive after an event deadline or after moderation has finished.
    const existing = await replay();
    if (existing) return resultFor(existing);
    let eventData: { startsAt: Date; endsAt: Date; registrationDeadline: Date; location: string; capacity: number } | undefined;
    if (type === 'event') eventData = this.eventContent(data);
    try {
      const post = await this.dataSource.transaction(async (manager) => {
        const created = await manager.save(Post, manager.create(Post, { ...metadata, schoolId, authorId: session.id, type, status: metadata.circle === 'campus' && process.env.AUTO_APPROVE === 'true' ? 'approved' : 'pending', title, content, tag, imageUrl, clientRequestId, submissionHash }));
        if (eventData) await manager.save(Event, manager.create(Event, { postId: created.id, ...eventData }));
        return created;
      });
      return resultFor(post);
    } catch (error) {
      // The unique index resolves concurrent retries, including across API instances.
      const saved = await replay();
      if (saved) return resultFor(saved);
      throw error;
    }
  }

  async toggleLike(session: UserSession, postId: string) {
    await this.currentUser(session); const post = await this.visiblePost(postId, session.id); const existing = await this.likes.findOneBy({ userId: session.id, postId });
    if (existing) { await this.likes.remove(existing); post.likeCount = Math.max(0, post.likeCount - 1); await this.posts.save(post); return { liked: false, likeCount: post.likeCount }; }
    await this.likes.save(this.likes.create({ userId: session.id, postId })); post.likeCount += 1; await this.posts.save(post); return { liked: true, likeCount: post.likeCount };
  }
  async toggleFavorite(session: UserSession, targetType: string, targetId: string) {
    await this.currentUser(session); if (targetType === 'post') await this.visiblePost(targetId, session.id); else if (targetType === 'route') await this.getRoute(targetId, session.id); else throw new BadRequestException('不支持的收藏类型');
    const existing = await this.favorites.findOneBy({ userId: session.id, targetType, targetId }); if (existing) { await this.favorites.remove(existing); return { favorited: false }; } await this.favorites.save(this.favorites.create({ userId: session.id, targetType, targetId })); return { favorited: true };
  }

  private localEventTransaction: Promise<unknown> = Promise.resolve();
  private eventTransaction<T>(operation: (manager: EntityManager) => Promise<T>): Promise<T> {
    // SQL.js has one shared connection. Production MySQL uses row locks instead.
    if (this.dataSource.options.type !== 'sqljs') return this.dataSource.transaction(operation);
    const next = this.localEventTransaction.then(() => this.dataSource.transaction(operation));
    this.localEventTransaction = next.catch(() => undefined);
    return next;
  }
  private async eventForRegistration(manager: EntityManager, eventId: string, userId: string) {
    const query = manager.getRepository(Event).createQueryBuilder('event').where('event.id = :eventId', { eventId });
    if (this.dataSource.options.type === 'mysql') query.setLock('pessimistic_write');
    const event = await query.getOne();
    if (!event) throw new NotFoundException('活动不存在');
    const post = await manager.findOneBy(Post, { id: event.postId, status: 'approved' });
    if (!post) throw new NotFoundException('内容不存在或不可见');
    if (post.circle === 'campus' || post.visibility === 'school' || post.schoolId) {
      const member = await manager.findOneBy(SchoolMembership, { userId, verificationStatus: 'verified' });
      if (!member) throw new ForbiddenException('请先完成学校认证');
      if (!post.schoolId || member.schoolId !== post.schoolId) throw new ForbiddenException('无权查看其他学校内容');
    }
    return event;
  }
  async registerEvent(session: UserSession, eventId: string) {
    await this.currentUser(session);
    return this.eventTransaction(async (manager) => {
      const event = await this.eventForRegistration(manager, eventId, session.id);
      let registration = await manager.findOneBy(EventRegistration, { eventId, userId: session.id });
      const alreadyRegistered = registration?.status === 'registered';
      if (!alreadyRegistered) {
        const now = new Date();
        if (event.status !== 'active' || event.registrationDeadline <= now || event.startsAt <= now) throw new ConflictException('活动当前不可报名');
        const reserved = await manager.createQueryBuilder().update(Event)
          .set({ registeredCount: () => 'registeredCount + 1' })
          .where('id = :eventId AND status = :status AND registrationDeadline > :now AND startsAt > :now AND registeredCount < capacity', { eventId, status: 'active', now })
          .execute();
        if (reserved.affected !== 1) throw new ConflictException('活动已满员或当前不可报名');
        registration = registration || manager.create(EventRegistration, { eventId, userId: session.id });
        registration.status = 'registered';
        await manager.save(EventRegistration, registration);
      }
      const plan = await manager.findOneBy(UserPlan, { userId: session.id, targetType: 'event', targetId: eventId })
        || manager.create(UserPlan, { userId: session.id, targetType: 'event', targetId: eventId });
      plan.status = 'active';
      await manager.save(UserPlan, plan);
      const latest = await manager.findOneByOrFail(Event, { id: eventId });
      return { registered: true, registeredCount: latest.registeredCount, capacity: latest.capacity, eventId, postId: event.postId, ...(alreadyRegistered ? { message: '已报名' } : {}) };
    });
  }
  async cancelEvent(session: UserSession, eventId: string) {
    await this.currentUser(session);
    return this.eventTransaction(async (manager) => {
      const event = await this.eventForRegistration(manager, eventId, session.id);
      const registration = await manager.findOneBy(EventRegistration, { eventId, userId: session.id });
      if (!registration) throw new NotFoundException('未找到报名记录');
      if (registration.status === 'registered') {
        registration.status = 'cancelled';
        await manager.save(EventRegistration, registration);
        await manager.createQueryBuilder().update(Event)
          .set({ registeredCount: () => 'CASE WHEN registeredCount > 0 THEN registeredCount - 1 ELSE 0 END' })
          .where('id = :eventId', { eventId }).execute();
      }
      await manager.update(UserPlan, { userId: session.id, targetType: 'event', targetId: eventId }, { status: 'cancelled' });
      const latest = await manager.findOneByOrFail(Event, { id: eventId });
      return { registered: false, registeredCount: latest.registeredCount, capacity: latest.capacity, eventId, postId: event.postId };
    });
  }

  async listRoutes(session: UserSession, data?: { destination?: string; days?: string; preferences?: string[] }) { await this.currentUser(session); const member = await this.memberships.findOneBy({ userId: session.id, verificationStatus: 'verified' }); const routes = await this.routes.findBy({ status: 'active' }); const filtered = routes.filter((r) => (r.visibility === 'platform' || r.schoolId === member?.schoolId) && (!data?.destination || r.destination.includes(data.destination)) && (!data?.days || r.days === data.days) && (!data?.preferences?.length || data.preferences.some((p) => r.preferences.includes(p)))); return Promise.all(filtered.map((r) => this.decorateRoute(r, session.id))); }
  private async getRoute(id: string, userId: string) { const route = await this.routes.findOneBy({ id, status: 'active' }); if (!route) throw new NotFoundException('路线不存在'); const member = await this.memberships.findOneBy({ userId, verificationStatus: 'verified' }); if (route.visibility === 'school' && route.schoolId !== member?.schoolId) throw new ForbiddenException('无权访问该路线'); return route; }
  private async decorateRoute(route: TravelRoute, userId: string) { const [planned, favorited] = await Promise.all([this.plans.existsBy({ userId, targetType: 'route', targetId: route.id, status: 'active' }), this.favorites.existsBy({ userId, targetType: 'route', targetId: route.id })]); return { ...route, preferences: route.preferences.split(','), stops: route.stops.split(' -> '), highlights: route.highlights.split(','), planned, favorited }; }
  private routePlanInput(body: unknown): RoutePlanInput | undefined {
    // An absent/empty body is the legacy toggle contract. Any parameters require an explicit desired state.
    if (body === undefined) return undefined;
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new BadRequestException('计划参数必须是对象');
    const input = body as Record<string, unknown>;
    const keys = Object.keys(input);
    if (!keys.length) return undefined;
    if (keys.some((key) => !['planned', 'departDate', 'companions'].includes(key))) throw new BadRequestException('计划参数包含不支持的字段');
    if (typeof input.planned !== 'boolean') throw new BadRequestException('planned 必须是布尔值');
    if ('departDate' in input) {
      const value = input.departDate;
      if (typeof value !== 'string' || !/^(?!0000)\d{4}-\d{2}-\d{2}$/.test(value)) throw new BadRequestException('出发日期必须为有效的 YYYY-MM-DD 日期');
      const date = new Date(`${value}T00:00:00.000Z`);
      if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) throw new BadRequestException('出发日期必须为有效的 YYYY-MM-DD 日期');
    }
    if ('companions' in input && (typeof input.companions !== 'number' || !Number.isInteger(input.companions) || input.companions < 0 || input.companions > 20)) throw new BadRequestException('同行人数必须是 0 至 20 的整数');
    return input as RoutePlanInput;
  }
  private routePlanMeta(plan: UserPlan) {
    const departDate = plan.departDate ?? null, companions = plan.companions ?? null;
    return departDate === null && companions === null ? null : { departDate, companions };
  }
  async togglePlan(session: UserSession, routeId: string, body?: unknown) {
    await this.currentUser(session);
    const input = this.routePlanInput(body);
    // Share the SQL.js transaction queue with event plans; MySQL serializes writers on the route row.
    return this.eventTransaction(async (manager) => {
      const query = manager.getRepository(TravelRoute).createQueryBuilder('route').where('route.id = :routeId AND route.status = :status', { routeId, status: 'active' });
      if (this.dataSource.options.type === 'mysql') query.setLock('pessimistic_write');
      const route = await query.getOne();
      if (!route) throw new NotFoundException('路线不存在');
      if (route.visibility === 'school') {
        const member = await manager.findOneBy(SchoolMembership, { userId: session.id, verificationStatus: 'verified' });
        if (!route.schoolId || route.schoolId !== member?.schoolId) throw new ForbiddenException('无权访问该路线');
      }
      const existing = await manager.findOneBy(UserPlan, { userId: session.id, targetType: 'route', targetId: routeId });
      const planned = input?.planned ?? (existing?.status !== 'active');
      if (!planned) {
        if (existing?.status === 'active') await manager.update(UserPlan, existing.id, { status: 'cancelled' });
        return { planned: false, planMeta: null };
      }
      const plan = existing || manager.create(UserPlan, { userId: session.id, targetType: 'route', targetId: routeId, departDate: null, companions: null });
      const departDate = input?.departDate ?? plan.departDate, companions = input?.companions ?? plan.companions;
      if (!existing || plan.status !== 'active' || departDate !== plan.departDate || companions !== plan.companions) {
        plan.status = 'active'; plan.departDate = departDate; plan.companions = companions;
        await manager.save(UserPlan, plan);
      }
      return { planned: true, planMeta: this.routePlanMeta(plan) };
    });
  }
  async myPlans(session: UserSession) {
    await this.currentUser(session);
    const plans = await this.plans.findBy({ userId: session.id, status: 'active' });
    const items = await Promise.all(plans.map(async (plan) => {
      try {
        if (plan.targetType === 'route') return { type: 'route', ...await this.decorateRoute(await this.getRoute(plan.targetId, session.id), session.id), planMeta: this.routePlanMeta(plan) };
        const event = await this.events.findOneBy({ id: plan.targetId });
        if (!event) return null;
        const post = await this.visiblePost(event.postId, session.id);
        const registration = await this.registrations.findOneBy({ eventId: event.id, userId: session.id, status: 'registered' });
        if (!registration) return null;
        return { type: 'event', id: event.id, postId: post.id, title: post.title, startsAt: event.startsAt, endsAt: event.endsAt, registrationDeadline: event.registrationDeadline, registeredCount: event.registeredCount, capacity: event.capacity, registered: true, location: event.location, status: event.status, circle: post.circle, city: post.city, contentLanguage: post.contentLanguage, schoolId: post.schoolId };
      } catch (error) {
        if (error instanceof ForbiddenException || error instanceof NotFoundException) return null;
        throw error;
      }
    }));
    return items.filter(Boolean);
  }
  async myFavorites(session: UserSession) {
    await this.currentUser(session);
    const favorites = await this.favorites.findBy({ userId: session.id });
    const items: Array<{ type: string; data: unknown }> = [];
    for (const favorite of favorites) {
      try {
        if (favorite.targetType === 'post') items.push({ type: 'post', data: await this.decoratePost(await this.visiblePost(favorite.targetId, session.id), session.id) });
        if (favorite.targetType === 'route') items.push({ type: 'route', data: await this.decorateRoute(await this.getRoute(favorite.targetId, session.id), session.id) });
      } catch { /* Hidden or deleted content is omitted. */ }
    }
    return items;
  }

  async quickActions(session: UserSession) { await this.currentUser(session); const member = await this.memberships.findOneBy({ userId: session.id, verificationStatus: 'verified' }); const kb = (await this.knowledge.findBy({ status: 'active' })).filter((item) => item.schoolId === null || item.schoolId === member?.schoolId); return kb.map(({ id, question }) => ({ id, label: question })); }
  async assistantMessage(session: UserSession, content: string) { await this.currentUser(session); if (!content.trim() || content.length > 500) throw new BadRequestException('请输入1至500字的问题'); const member = await this.memberships.findOneBy({ userId: session.id, verificationStatus: 'verified' }); await this.messages.save(this.messages.create({ userId: session.id, schoolId: member?.schoolId || null, role: 'user', content })); const candidates = (await this.knowledge.findBy({ status: 'active' })).filter((item) => item.schoolId === null || item.schoolId === member?.schoolId); const normalized = content.toLowerCase(); const match = candidates.find((item) => item.keywords.split(',').some((keyword) => normalized.includes(keyword.trim().toLowerCase()))); const answer = match?.answer || '这项信息暂未收录。校园实时信息请以学校官方渠道为准，我可以继续帮你查找已配置的校园活动、课程或文化旅行问题。'; const message = await this.messages.save(this.messages.create({ userId: session.id, schoolId: member?.schoolId || null, role: 'assistant', content: answer })); return { user: content, assistant: { id: message.id, content: answer, createdAt: message.createdAt } };
  }

  private adminSummary(admin: AdminAccount) { return { id: admin.id, username: admin.username, role: admin.role, schoolId: admin.schoolId }; }
  async adminLogin(username: string, password: string) {
    if (typeof username !== 'string' || !username.trim() || username.trim().length > 80) throw new BadRequestException('请输入有效的管理员账号');
    const name = username.trim();
    this.adminLoginLimiter.reserve(name);
    const admin = await DbRetry.read(() => this.admins.findOneBy({ username: name }));
    if (typeof password !== 'string' || !password || Buffer.byteLength(password, 'utf8') > 72 || !admin || admin.status !== 'active' || !await bcrypt.compare(password, admin.passwordHash)) throw new ForbiddenException('用户名或密码错误');
    if (isProduction() && password === DEMO_ADMIN_PASSWORD) throw new ForbiddenException('请先通过受信任的私有管理通道配置管理员密码，生产环境不能使用演示密码');
    this.adminLoginLimiter.success(name);
    const token = createToken({ id: admin.id, kind: 'admin', role: admin.role, schoolId: admin.schoolId, authVersion: adminAuthVersion(admin.passwordHash) });
    return { token, admin: this.adminSummary(admin) };
  }
  async adminMe(session: AdminSession) {
    const admin = await DbRetry.read(() => this.admins.findOneBy({ id: session.id, status: 'active' }));
    if (!admin) throw new ForbiddenException('管理员账号不可用');
    return this.adminSummary(admin);
  }
  async changeAdminPassword(session: AdminSession, data: { currentPassword?: unknown; newPassword?: unknown }) {
    if (!validNewAdminPassword(data.newPassword)) throw new BadRequestException('新密码需至少12字符，包含大小写字母、数字和符号，最多72字节，且不能使用演示密码');
    const admin = await this.admins.findOneBy({ id: session.id, status: 'active' });
    if (!admin) throw new ForbiddenException('管理员账号不可用');
    this.adminLoginLimiter.reserve(admin.username);
    if (typeof data.currentPassword !== 'string' || Buffer.byteLength(data.currentPassword, 'utf8') > 72 || !await bcrypt.compare(data.currentPassword, admin.passwordHash)) throw new ForbiddenException('当前密码不正确');
    if (await bcrypt.compare(data.newPassword, admin.passwordHash)) throw new BadRequestException('新密码应与当前密码不同');
    const passwordHash = await bcrypt.hash(data.newPassword, 12);
    await this.dataSource.transaction(async (manager) => {
      const updated = await manager.update(AdminAccount, { id: admin.id, passwordHash: admin.passwordHash }, { passwordHash });
      if (updated.affected !== 1) throw new ConflictException('账户信息已变化，请重新登录');
      await manager.save(AuditLog, manager.create(AuditLog, { adminId: admin.id, schoolId: admin.schoolId, action: 'admin.password.change', resourceType: 'admin', resourceId: admin.id, detail: '' }));
    });
    this.adminLoginLimiter.success(admin.username);
    return { passwordChanged: true, reauthenticate: true };
  }
  private adminPostQuery(admin: AdminSession) {
    this.requireAdminRole(admin, 'super_admin', 'operator', 'reviewer');
    const qb = this.posts.createQueryBuilder('post').where('1 = 1');
    if (admin.role !== 'super_admin') {
      if (!admin.schoolId) throw new ForbiddenException('无学校范围');
      qb.andWhere('post.circle = :campus AND post.visibility = :school AND post.schoolId = :schoolId', { campus: 'campus', school: 'school', schoolId: admin.schoolId });
    }
    return qb;
  }
  private async decorateAdminPost(post: Post) {
    const { clientRequestId, submissionHash, ...content } = post;
    const [event, school] = await Promise.all([post.type === 'event' ? this.events.findOneBy({ postId: post.id }) : Promise.resolve(null), post.schoolId ? this.schools.findOneBy({ id: post.schoolId }) : Promise.resolve(null)]);
    return { ...content, event, school: school ? { id: school.id, name: school.name, shortName: school.shortName } : null };
  }
  async adminDashboard(session: AdminSession) {
    const admin = await this.activeAdmin(session);
    const qb = this.adminPostQuery(admin);
    const activeEvents = qb.clone().innerJoin(Event, 'event', 'event.postId = post.id').andWhere('event.status = :active', { active: 'active' }).andWhere('post.status = :approved', { approved: 'approved' }).getCount();
    return { pendingPosts: await qb.clone().andWhere('post.status = :pending', { pending: 'pending' }).getCount(), approvedPosts: await qb.clone().andWhere('post.status = :approved', { approved: 'approved' }).getCount(), users: admin.role === 'super_admin' ? await this.users.count() : await this.memberships.countBy({ schoolId: admin.schoolId!, verificationStatus: 'verified' }), activeEvents: await activeEvents, recentAudits: await this.audits.find({ where: admin.role === 'super_admin' ? {} : { schoolId: admin.schoolId! }, order: { createdAt: 'DESC' }, take: 10 }) };
  }
  async adminSchools(session: AdminSession) {
    const admin = await this.activeAdmin(session);
    this.requireAdminRole(admin, 'super_admin', 'operator', 'reviewer');
    if (admin.role !== 'super_admin' && !admin.schoolId) throw new ForbiddenException('无学校范围');
    return (await this.schools.find({ where: admin.role === 'super_admin' ? { status: 'active' } : { id: admin.schoolId!, status: 'active' }, order: { name: 'ASC' } })).map(({ id, name, shortName }) => ({ id, name, shortName }));
  }
  async adminPosts(session: AdminSession, query: PostQuery = {}) {
    const admin = await this.activeAdmin(session);
    this.validatePostQuery(query);
    if (query.status && !['draft', 'pending', 'approved', 'rejected', 'offline'].includes(query.status)) throw new BadRequestException('无效审核状态');
    if (admin.role !== 'super_admin' && ((query.schoolId && query.schoolId !== admin.schoolId) || query.scope === 'platform' || (query.circle && query.circle !== 'campus'))) throw new ForbiddenException('只能处理本校校园圈内容');
    const qb = this.adminPostQuery(admin);
    if (query.status) qb.andWhere('post.status = :status', { status: query.status });
    if (query.scope) qb.andWhere('post.visibility = :visibility', { visibility: query.scope });
    this.applyPostFilters(qb, query);
    const pagination = this.pagination(query, false);
    if (pagination.enabled) {
      const [rows, total] = await qb.skip((pagination.page - 1) * pagination.pageSize).take(pagination.pageSize).getManyAndCount();
      return { items: await Promise.all(rows.map((post) => this.decorateAdminPost(post))), page: pagination.page, pageSize: pagination.pageSize, total, hasMore: pagination.page * pagination.pageSize < total };
    }
    return Promise.all((await qb.getMany()).map((post) => this.decorateAdminPost(post)));
  }
  async adminPostMedia(session: AdminSession, postId: string) {
    const admin = await this.activeAdmin(session);
    const post = await DbRetry.read(() => this.posts.findOneBy({ id: postId }));
    if (!post) throw new NotFoundException('内容不存在');
    this.ensureAdminPostScope(admin, post);
    return previewStoredImage(post.imageUrl);
  }
  async saveAdminPost(session: AdminSession, data: Record<string, unknown>, postId?: string) {
    const admin = await this.activeAdmin(session);
    this.requireAdminRole(admin, 'super_admin', 'operator');
    const previous = postId ? await this.posts.findOneBy({ id: postId }) : null;
    if (postId && !previous) throw new NotFoundException('内容不存在');
    if (previous) this.ensureAdminPostScope(admin, previous);
    const changingCircle = previous && data.circle !== undefined && data.circle !== previous.circle;
    const merged: Record<string, unknown> = { ...(previous || {}), ...(changingCircle ? { city: null, contentLanguage: null, schoolId: null } : {}), ...data };
    const metadata = this.circleMetadata(merged);
    const schoolId = metadata.circle === 'campus' ? String(merged.schoolId || admin.schoolId || '') : null;
    this.ensureAdminPostScope(admin, { ...metadata, schoolId });
    if (metadata.circle === 'campus' && (!schoolId || !await this.schools.existsBy({ id: schoolId, status: 'active' }))) throw new BadRequestException('请选择有效的学校');
    const core = this.postContent(merged, metadata.circle);
    if (previous && previous.type !== core.type) throw new BadRequestException('编辑时不能更改内容类型');
    const status = data.status === undefined ? (previous?.status || 'approved') : String(data.status);
    if (!['pending', 'approved', 'offline'].includes(status)) throw new BadRequestException('请选择待审核、已发布或已下架状态');
    const save = async (manager: EntityManager) => {
      let currentEvent: Event | null = null;
      if (previous && core.type === 'event') {
        const query = manager.getRepository(Event).createQueryBuilder('event').where('event.postId = :postId', { postId: previous.id });
        if (this.dataSource.options.type === 'mysql') query.setLock('pessimistic_write');
        currentEvent = await query.getOne();
      }
      // Revalidate against the locked, current count and retain the latest omitted fields.
      const eventData = core.type === 'event' ? this.eventContent(data, currentEvent) : null;
      const post = await manager.save(Post, manager.create(Post, { ...(previous || {}), ...metadata, ...core, schoolId, authorId: previous?.authorId || admin.id, status: status as Post['status'], rejectionReason: '', reviewedBy: status === 'pending' ? null : admin.id }));
      if (eventData) {
        if (currentEvent) await manager.update(Event, currentEvent.id, eventData);
        else await manager.save(Event, manager.create(Event, { ...eventData, postId: post.id }));
      }
      await manager.save(AuditLog, manager.create(AuditLog, { adminId: admin.id, schoolId: admin.schoolId || null, action: previous ? 'post.edit' : 'post.create', resourceType: 'post', resourceId: post.id, detail: JSON.stringify({ circle: post.circle, city: post.city, contentLanguage: post.contentLanguage, schoolId: post.schoolId, status: post.status }) }));
      return post;
    };
    const saved = core.type === 'event' ? await this.eventTransaction(save) : await this.dataSource.transaction(save);
    return this.decorateAdminPost(saved);
  }
  async reviewPost(session: AdminSession, postId: string, status: 'approved' | 'rejected' | 'offline', reason = '') {
    const admin = await this.activeAdmin(session);
    if (!['approved', 'rejected', 'offline'].includes(status)) throw new BadRequestException('无效审核状态');
    const post = await this.posts.findOneBy({ id: postId });
    if (!post) throw new NotFoundException('内容不存在');
    this.ensureAdminPostScope(admin, post);
    if (status === 'approved') {
      const metadata = this.circleMetadata(post as unknown as Record<string, unknown>, null);
      if (post.visibility !== metadata.visibility) throw new BadRequestException('圈层与内容范围不一致，不能发布');
      if (post.circle === 'campus' && (!post.schoolId || !await this.schools.existsBy({ id: post.schoolId, status: 'active' }))) throw new BadRequestException('校园内容缺少有效学校，不能发布');
    }
    if (typeof reason !== 'string' || reason.length > 500 || (status === 'rejected' && !reason.trim())) throw new BadRequestException('请填写有效的审核原因（最多500字）');
    post.status = status;
    post.rejectionReason = reason.trim();
    post.reviewedBy = admin.id;
    await this.dataSource.transaction(async (manager) => {
      await manager.save(Post, post);
      await manager.save(AuditLog, manager.create(AuditLog, { adminId: admin.id, schoolId: admin.schoolId || null, action: `post.${status}`, resourceType: 'post', resourceId: post.id, detail: reason }));
    });
    return this.decorateAdminPost(post);
  }
  async adminInvites(admin: AdminSession) { this.requireAdminRole(admin, 'super_admin', 'operator'); if (!admin.schoolId && admin.role !== 'super_admin') throw new ForbiddenException('无学校范围'); return this.invites.findBy({ schoolId: admin.schoolId || (await this.schools.findOneOrFail({ where: { status: 'active' } })).id }); }
  async createInvite(admin: AdminSession, data: { batchName: string; maxUses: number; expiresAt?: string; schoolId?: string }) { this.requireAdminRole(admin, 'super_admin', 'operator'); const schoolId = admin.schoolId || data.schoolId || ''; if (!schoolId) throw new BadRequestException('请选择学校'); this.ensureAdminScope(admin, schoolId); const code = `WC${Math.random().toString(36).slice(2, 8).toUpperCase()}`; const invite = await this.invites.save(this.invites.create({ schoolId, code, batchName: data.batchName?.trim() || '后台创建', maxUses: Math.max(1, Number(data.maxUses) || 1), expiresAt: data.expiresAt ? new Date(data.expiresAt) : null })); await this.audit(admin, 'invite.create', 'invite', invite.id, invite.batchName); return invite; }
  async adminRoutes(admin: AdminSession) { this.requireAdminRole(admin, 'super_admin', 'operator'); const rows = await this.routes.find({ order: { createdAt: 'DESC' } }); return rows.filter((route) => admin.role === 'super_admin' || route.schoolId === admin.schoolId); }
  async saveRoute(admin: AdminSession, data: Partial<TravelRoute>) { this.requireAdminRole(admin, 'super_admin', 'operator'); const schoolId = data.visibility === 'platform' ? null : (data.schoolId || admin.schoolId); this.ensureAdminScope(admin, schoolId || null); if (!data.title || !data.destination || !data.days) throw new BadRequestException('请填写路线名称、目的地和天数'); const route = await this.routes.save(this.routes.create({ schoolId: schoolId || null, visibility: data.visibility || 'school', title: data.title, destination: data.destination, days: data.days, budget: Number(data.budget) || 0, preferences: Array.isArray(data.preferences) ? data.preferences.join(',') : data.preferences || '', stops: Array.isArray(data.stops) ? data.stops.join(' -> ') : data.stops || '', highlights: Array.isArray(data.highlights) ? data.highlights.join(',') : data.highlights || '', coverUrl: data.coverUrl || '' })); await this.audit(admin, 'route.create', 'route', route.id); return route; }
  async adminKnowledge(admin: AdminSession) { this.requireAdminRole(admin, 'super_admin', 'operator'); const rows = await this.knowledge.find({ order: { createdAt: 'DESC' } }); return rows.filter((item) => admin.role === 'super_admin' || item.schoolId === admin.schoolId); }
  async saveKnowledge(admin: AdminSession, data: Partial<AssistantKnowledge>) { this.requireAdminRole(admin, 'super_admin', 'operator'); const schoolId = data.schoolId || admin.schoolId || null; this.ensureAdminScope(admin, schoolId); if (!data.question || !data.keywords || !data.answer) throw new BadRequestException('请完整填写问题、关键词和答复'); const item = await this.knowledge.save(this.knowledge.create({ schoolId, question: data.question, keywords: data.keywords, answer: data.answer })); await this.audit(admin, 'knowledge.create', 'knowledge', item.id); return item; }
  async adminUsers(admin: AdminSession) { this.requireAdminRole(admin, 'super_admin', 'operator'); const members = await this.memberships.findBy({ schoolId: admin.schoolId || undefined }); return Promise.all(members.map(async (member) => ({ membership: member, user: await this.users.findOneBy({ id: member.userId }) }))); }
  async health() { return { service: 'weculture-api', status: 'healthy', time: new Date().toISOString() }; }
}
