import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import * as bcrypt from 'bcryptjs';
import { DataSource, Repository } from 'typeorm';
import { AdminAccount, AssistantKnowledge, AssistantMessage, AuditLog, Event, EventRegistration, Favorite, InviteCode, Like, Post, School, SchoolMembership, TravelRoute, User, UserPlan } from './entities';
import { createToken, Session } from './auth';

type UserSession = Session & { kind: 'user' };
type AdminSession = Session & { kind: 'admin'; role?: string; schoolId?: string | null };

@Injectable()
export class AppService implements OnModuleInit {
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

  async onModuleInit() { await this.seed(); }

  private async seed() {
    if (await this.schools.count()) {
      if (!await this.admins.existsBy({ username: 'blcu-reviewer' })) {
        const school = await this.schools.findOneByOrFail({ status: 'active' });
        await this.admins.save(this.admins.create({ username: 'blcu-reviewer', passwordHash: await bcrypt.hash('Weculture@2026', 10), role: 'reviewer', schoolId: school.id }));
      }
      return;
    }
    const school = await this.schools.save(this.schools.create({ name: '北京语言大学', shortName: 'BLCU' }));
    await this.invites.save(this.invites.create({ schoolId: school.id, code: 'BLCU2026', batchName: '首期内测', maxUses: 500, expiresAt: null }));
    const admin = this.admins.create({ username: 'admin', passwordHash: await bcrypt.hash('Weculture@2026', 10), role: 'super_admin', schoolId: null });
    await this.admins.save(admin);
    const operator = this.admins.create({ username: 'blcu-operator', passwordHash: await bcrypt.hash('Weculture@2026', 10), role: 'operator', schoolId: school.id });
    await this.admins.save(operator);
    await this.admins.save(this.admins.create({ username: 'blcu-reviewer', passwordHash: await bcrypt.hash('Weculture@2026', 10), role: 'reviewer', schoolId: school.id }));
    const posts = await this.posts.save([
      this.posts.create({ schoolId: null, authorId: admin.id, type: 'dynamic', visibility: 'platform', status: 'approved', title: '非遗扇艺工作坊开放报名', content: '用一把团扇，认识工笔、颜色与中国传统生活美学。', tag: '非遗工坊', imageUrl: 'https://images.unsplash.com/photo-1545987796-200677ee1011?auto=format&fit=crop&w=900&q=80' }),
      this.posts.create({ schoolId: school.id, authorId: admin.id, type: 'dynamic', visibility: 'school', status: 'approved', title: '本周校园文化活动清单', content: '茶艺社体验、语言交换夜与周末故宫文化行已开放报名。', tag: '校园文化', imageUrl: 'https://images.unsplash.com/photo-1519692933481-e162a57d6721?auto=format&fit=crop&w=900&q=80' }),
      this.posts.create({ schoolId: school.id, authorId: admin.id, type: 'event', visibility: 'school', status: 'approved', title: '周末故宫文化行', content: '面向本校同学的深度文化行走活动，含讲解与交流环节。', tag: '校内活动', imageUrl: 'https://images.unsplash.com/photo-1508804185872-d7badad00f7d?auto=format&fit=crop&w=900&q=80' }),
      this.posts.create({ schoolId: school.id, authorId: admin.id, type: 'market', visibility: 'school', status: 'approved', title: '转让九成新台灯', content: '宿舍自取，使用正常，适合夜间自习。', tag: '校园闲置', imageUrl: '' })
    ]);
    await this.events.save(this.events.create({ postId: posts[2].id, startsAt: new Date('2026-09-12T09:00:00+08:00'), endsAt: new Date('2026-09-12T17:00:00+08:00'), location: '东城区故宫博物院', registrationDeadline: new Date('2026-09-10T18:00:00+08:00'), capacity: 30 }));
    await this.routes.save([
      this.routes.create({ schoolId: null, visibility: 'platform', title: '京城文化 3 日游', destination: '北京', days: '1-3天', budget: 899, preferences: '文化,艺术', stops: '故宫 -> 南锣鼓巷 -> 慕田峪长城', highlights: '故宫讲解,胡同深度,长城索道', coverUrl: 'https://images.unsplash.com/photo-1508804185872-d7badad00f7d?auto=format&fit=crop&w=900&q=80' }),
      this.routes.create({ schoolId: null, visibility: 'platform', title: '上海海派风情 2 日游', destination: '上海', days: '1-3天', budget: 1299, preferences: '文化,美食,艺术', stops: '外滩 -> 武康路 -> 豫园', highlights: '外滩摄影,海派建筑,本帮美食', coverUrl: 'https://images.unsplash.com/photo-1548919973-5cef591cdbc9?auto=format&fit=crop&w=900&q=80' })
    ]);
    await this.knowledge.save([
      this.knowledge.create({ schoolId: school.id, question: '怎么查课表？', keywords: '课表,课程,上课', answer: '课程安排请以教务系统为准。你可以先在校园服务入口查看本周课程；如有变化，请联系学院教务老师。' }),
      this.knowledge.create({ schoolId: school.id, question: '如何参加校园活动？', keywords: '活动,报名,讲座', answer: '进入“社区”查看校内活动，打开详情后点击报名即可。报名成功后会进入“我的计划”。' }),
      this.knowledge.create({ schoolId: null, question: '有什么文化旅行推荐？', keywords: '旅行,路线,文化', answer: '你可以在“旅行”页选择目的地、天数和偏好，我会基于平台路线库给出推荐。' })
    ]);
  }

  private async currentUser(session: UserSession) { const user = await this.users.findOneBy({ id: session.id }); if (!user || user.status !== 'active') throw new ForbiddenException('账号不可用'); return user; }
  private async verifiedMembership(userId: string) { const member = await this.memberships.findOneBy({ userId, verificationStatus: 'verified' }); if (!member) throw new ForbiddenException('请先完成学校认证'); return member; }
  private async visiblePost(postId: string, userId: string, allowAuthorPreview = false) { const post = await this.posts.findOneBy({ id: postId }); if (!post || (post.status !== 'approved' && !(allowAuthorPreview && post.authorId === userId))) throw new NotFoundException('内容不存在或不可见'); if (post.visibility === 'school' && post.authorId !== userId) { const member = await this.verifiedMembership(userId); if (member.schoolId !== post.schoolId) throw new ForbiddenException('无权查看其他学校内容'); } return post; }
  private async audit(admin: AdminSession, action: string, resourceType: string, resourceId: string, detail = '') { await this.audits.save(this.audits.create({ adminId: admin.id, schoolId: admin.schoolId || null, action, resourceType, resourceId, detail })); }
  private ensureAdminScope(admin: AdminSession, schoolId: string | null) { if (admin.role !== 'super_admin' && (!schoolId || admin.schoolId !== schoolId)) throw new ForbiddenException('无权操作该学校资源'); }
  private requireAdminRole(admin: AdminSession, ...roles: Array<NonNullable<AdminSession['role']>>) { if (!admin.role || !roles.includes(admin.role)) throw new ForbiddenException('当前管理员角色无权执行此操作'); }

  async userLogin(code: string) {
    if (!code?.trim()) throw new BadRequestException('缺少微信登录凭证');
    // Development uses a persisted device identifier; production replaces this branch with code2Session.
    const openId = code.trim().startsWith('dev-') ? code.trim().slice(0, 68) : `wechat_${code.trim().slice(0, 64)}`;
    let user = await this.users.findOneBy({ wechatOpenId: openId });
    if (!user) user = await this.users.save(this.users.create({ wechatOpenId: openId }));
    const membership = await this.memberships.findOneBy({ userId: user.id, verificationStatus: 'verified' });
    const token = createToken({ id: user.id, kind: 'user', schoolId: membership?.schoolId || null });
    return { token, user: await this.userSummary(user.id), isNew: !user.nickname };
  }

  async userSummary(userId: string) {
    const user = await this.users.findOneByOrFail({ id: userId });
    const membership = await this.memberships.findOneBy({ userId, verificationStatus: 'verified' });
    const school = membership ? await this.schools.findOneBy({ id: membership.schoolId }) : null;
    return { id: user.id, nickname: user.nickname, avatarUrl: user.avatarUrl, status: user.status, school: school ? { id: school.id, name: school.name, shortName: school.shortName } : null, verified: Boolean(membership) };
  }

  async getMe(session: UserSession) { await this.currentUser(session); return this.userSummary(session.id); }
  async myPosts(session: UserSession) { await this.currentUser(session); return this.posts.find({ where: { authorId: session.id }, order: { createdAt: 'DESC' } }); }
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

  async listPosts(session: UserSession, query: { scope?: string; type?: string; q?: string }) {
    await this.currentUser(session); const member = await this.memberships.findOneBy({ userId: session.id, verificationStatus: 'verified' });
    const qb = this.posts.createQueryBuilder('post').where('post.status = :status', { status: 'approved' });
    if (query.scope === 'school') { if (!member) throw new ForbiddenException('请先完成学校认证'); qb.andWhere('post.schoolId = :schoolId AND post.visibility = :visibility', { schoolId: member.schoolId, visibility: 'school' }); }
    else if (query.scope === 'platform') { qb.andWhere('post.visibility = :platform', { platform: 'platform' }); }
    else { qb.andWhere('(post.visibility = :platform OR (post.visibility = :school AND post.schoolId = :schoolId))', { platform: 'platform', school: 'school', schoolId: member?.schoolId || '__none__' }); }
    if (query.type) qb.andWhere('post.type = :type', { type: query.type });
    if (query.q) qb.andWhere('(post.title LIKE :q OR post.content LIKE :q OR post.tag LIKE :q)', { q: `%${query.q}%` });
    const posts = await qb.orderBy('post.createdAt', 'DESC').getMany();
    return Promise.all(posts.map((post) => this.decoratePost(post, session.id)));
  }

  async getPost(session: UserSession, postId: string) { await this.currentUser(session); return this.decoratePost(await this.visiblePost(postId, session.id, true), session.id); }
  private async decoratePost(post: Post, userId: string) {
    const [author, liked, favorited, event] = await Promise.all([this.users.findOneBy({ id: post.authorId }), this.likes.existsBy({ userId, postId: post.id }), this.favorites.existsBy({ userId, targetType: 'post', targetId: post.id }), post.type === 'event' ? this.events.findOneBy({ postId: post.id }) : Promise.resolve(null)]);
    const registration = event ? await this.registrations.findOneBy({ eventId: event.id, userId, status: 'registered' }) : null;
    return { ...post, author: author ? { id: author.id, nickname: author.nickname || 'Weculture 用户', avatarUrl: author.avatarUrl } : { id: post.authorId, nickname: 'Weculture', avatarUrl: '' }, liked, favorited, event: event ? { ...event, registered: Boolean(registration) } : null };
  }

  async createPost(session: UserSession, data: Record<string, unknown>) {
    await this.currentUser(session); const member = await this.verifiedMembership(session.id);
    const title = String(data.title || '').trim(), content = String(data.content || '').trim(), type = String(data.type || 'dynamic') as Post['type'];
    if (!['dynamic', 'event', 'market'].includes(type) || title.length < 2 || title.length > 40 || content.length < 2 || content.length > 2000) throw new BadRequestException('请填写有效的标题和正文');
    let eventData: { startsAt: Date; endsAt: Date; registrationDeadline: Date; location: string; capacity: number } | undefined;
    if (type === 'event') {
      const startsAt = new Date(String(data.startsAt)), endsAt = new Date(String(data.endsAt)), deadline = new Date(String(data.registrationDeadline)); const capacity = Number(data.capacity);
      const now = new Date();
      if (Number.isNaN(+startsAt) || Number.isNaN(+endsAt) || Number.isNaN(+deadline) || !String(data.location || '').trim() || !Number.isInteger(capacity) || capacity < 1 || startsAt >= endsAt || deadline >= startsAt || deadline <= now || startsAt <= now) throw new BadRequestException('活动信息不完整、人数无效或时间已过期');
      eventData = { startsAt, endsAt, registrationDeadline: deadline, location: String(data.location).trim(), capacity };
    }
    const post = await this.dataSource.transaction(async (manager) => {
      const created = await manager.save(Post, manager.create(Post, { schoolId: member.schoolId, authorId: session.id, type, visibility: 'school', status: process.env.AUTO_APPROVE === 'true' ? 'approved' : 'pending', title, content, tag: String(data.tag || (type === 'event' ? '校内活动' : type === 'market' ? '校园闲置' : '校园动态')), imageUrl: String(data.imageUrl || '') }));
      if (eventData) await manager.save(Event, manager.create(Event, { postId: created.id, ...eventData }));
      return created;
    });
    return { id: post.id, status: post.status, message: post.status === 'approved' ? '发布成功' : '已提交审核' };
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

  async registerEvent(session: UserSession, eventId: string) {
    await this.currentUser(session); const event = await this.events.findOneBy({ id: eventId }); if (!event) throw new NotFoundException('活动不存在'); const post = await this.visiblePost(event.postId, session.id); await this.verifiedMembership(session.id);
    if (event.status !== 'active' || event.registrationDeadline < new Date()) throw new ConflictException('活动当前不可报名'); if (event.registeredCount >= event.capacity) throw new ConflictException('活动已满员');
    if (await this.registrations.existsBy({ eventId, userId: session.id, status: 'registered' })) return { registered: true, message: '已报名' };
    await this.registrations.save(this.registrations.create({ eventId, userId: session.id })); event.registeredCount += 1; await this.events.save(event);
    const plan = await this.plans.findOneBy({ userId: session.id, targetType: 'event', targetId: eventId }); if (!plan) await this.plans.save(this.plans.create({ userId: session.id, targetType: 'event', targetId: eventId }));
    return { registered: true, eventId, postId: post.id };
  }
  async cancelEvent(session: UserSession, eventId: string) {
    const registration = await this.registrations.findOneBy({ eventId, userId: session.id, status: 'registered' }); if (!registration) throw new NotFoundException('未找到报名记录'); const event = await this.events.findOneByOrFail({ id: eventId }); registration.status = 'cancelled'; event.registeredCount = Math.max(0, event.registeredCount - 1); await this.registrations.save(registration); await this.events.save(event); const plan = await this.plans.findOneBy({ userId: session.id, targetType: 'event', targetId: eventId }); if (plan) { plan.status = 'cancelled'; await this.plans.save(plan); } return { registered: false };
  }

  async listRoutes(session: UserSession, data?: { destination?: string; days?: string; preferences?: string[] }) { await this.currentUser(session); const member = await this.memberships.findOneBy({ userId: session.id, verificationStatus: 'verified' }); const routes = await this.routes.findBy({ status: 'active' }); const filtered = routes.filter((r) => (r.visibility === 'platform' || r.schoolId === member?.schoolId) && (!data?.destination || r.destination.includes(data.destination)) && (!data?.days || r.days === data.days) && (!data?.preferences?.length || data.preferences.some((p) => r.preferences.includes(p)))); return Promise.all(filtered.map((r) => this.decorateRoute(r, session.id))); }
  private async getRoute(id: string, userId: string) { const route = await this.routes.findOneBy({ id, status: 'active' }); if (!route) throw new NotFoundException('路线不存在'); const member = await this.memberships.findOneBy({ userId, verificationStatus: 'verified' }); if (route.visibility === 'school' && route.schoolId !== member?.schoolId) throw new ForbiddenException('无权访问该路线'); return route; }
  private async decorateRoute(route: TravelRoute, userId: string) { const [planned, favorited] = await Promise.all([this.plans.existsBy({ userId, targetType: 'route', targetId: route.id, status: 'active' }), this.favorites.existsBy({ userId, targetType: 'route', targetId: route.id })]); return { ...route, preferences: route.preferences.split(','), stops: route.stops.split(' -> '), highlights: route.highlights.split(','), planned, favorited }; }
  async togglePlan(session: UserSession, routeId: string) { await this.currentUser(session); await this.getRoute(routeId, session.id); const plan = await this.plans.findOneBy({ userId: session.id, targetType: 'route', targetId: routeId }); if (plan?.status === 'active') { plan.status = 'cancelled'; await this.plans.save(plan); return { planned: false }; } if (plan) { plan.status = 'active'; await this.plans.save(plan); } else await this.plans.save(this.plans.create({ userId: session.id, targetType: 'route', targetId: routeId })); return { planned: true }; }
  async myPlans(session: UserSession) { await this.currentUser(session); const plans = await this.plans.findBy({ userId: session.id, status: 'active' }); const items = await Promise.all(plans.map(async (plan) => { if (plan.targetType === 'route') { const route = await this.routes.findOneBy({ id: plan.targetId }); return route ? { type: 'route', ...await this.decorateRoute(route, session.id) } : null; } const event = await this.events.findOneBy({ id: plan.targetId }); const post = event ? await this.posts.findOneBy({ id: event.postId }) : null; return event && post ? { type: 'event', id: event.id, title: post.title, startsAt: event.startsAt, location: event.location, status: event.status } : null; })); return items.filter(Boolean); }

  async quickActions(session: UserSession) { await this.currentUser(session); const member = await this.memberships.findOneBy({ userId: session.id, verificationStatus: 'verified' }); const kb = (await this.knowledge.findBy({ status: 'active' })).filter((item) => item.schoolId === null || item.schoolId === member?.schoolId); return kb.map(({ id, question }) => ({ id, label: question })); }
  async assistantMessage(session: UserSession, content: string) { await this.currentUser(session); if (!content.trim() || content.length > 500) throw new BadRequestException('请输入1至500字的问题'); const member = await this.memberships.findOneBy({ userId: session.id, verificationStatus: 'verified' }); await this.messages.save(this.messages.create({ userId: session.id, schoolId: member?.schoolId || null, role: 'user', content })); const candidates = (await this.knowledge.findBy({ status: 'active' })).filter((item) => item.schoolId === null || item.schoolId === member?.schoolId); const normalized = content.toLowerCase(); const match = candidates.find((item) => item.keywords.split(',').some((keyword) => normalized.includes(keyword.trim().toLowerCase()))); const answer = match?.answer || '这项信息暂未收录。校园实时信息请以学校官方渠道为准，我可以继续帮你查找已配置的校园活动、课程或文化旅行问题。'; const message = await this.messages.save(this.messages.create({ userId: session.id, schoolId: member?.schoolId || null, role: 'assistant', content: answer })); return { user: content, assistant: { id: message.id, content: answer, createdAt: message.createdAt } };
  }

  async adminLogin(username: string, password: string) { const admin = await this.admins.findOneBy({ username }); if (!admin || admin.status !== 'active' || !await bcrypt.compare(password || '', admin.passwordHash)) throw new ForbiddenException('用户名或密码错误'); const token = createToken({ id: admin.id, kind: 'admin', role: admin.role, schoolId: admin.schoolId }); return { token, admin: { id: admin.id, username: admin.username, role: admin.role, schoolId: admin.schoolId } }; }
  async adminDashboard(admin: AdminSession) { const schoolClause = admin.role === 'super_admin' ? {} : { schoolId: admin.schoolId! }; return { pendingPosts: await this.posts.countBy({ ...schoolClause, status: 'pending' }), approvedPosts: await this.posts.countBy({ ...schoolClause, status: 'approved' }), users: admin.role === 'super_admin' ? await this.users.count() : await this.memberships.countBy({ schoolId: admin.schoolId!, verificationStatus: 'verified' }), activeEvents: await this.events.countBy({ status: 'active' }), recentAudits: await this.audits.find({ order: { createdAt: 'DESC' }, take: 10 }) };
  }
  async adminPosts(admin: AdminSession, status?: string) { const rows = await this.posts.find({ where: status ? { status: status as Post['status'] } : {}, order: { createdAt: 'DESC' } }); return rows.filter((post) => { try { this.ensureAdminScope(admin, post.schoolId); return true; } catch { return false; } }); }
  async reviewPost(admin: AdminSession, postId: string, status: 'approved' | 'rejected' | 'offline', reason = '') { if (!['approved', 'rejected', 'offline'].includes(status)) throw new BadRequestException('无效审核状态'); const post = await this.posts.findOneBy({ id: postId }); if (!post) throw new NotFoundException('内容不存在'); this.ensureAdminScope(admin, post.schoolId); if (status === 'rejected' && !reason.trim()) throw new BadRequestException('请填写驳回原因'); post.status = status; post.rejectionReason = reason.trim(); post.reviewedBy = admin.id; await this.posts.save(post); await this.audit(admin, `post.${status}`, 'post', post.id, reason); return post; }
  async adminInvites(admin: AdminSession) { this.requireAdminRole(admin, 'super_admin', 'operator'); if (!admin.schoolId && admin.role !== 'super_admin') throw new ForbiddenException('无学校范围'); return this.invites.findBy({ schoolId: admin.schoolId || (await this.schools.findOneOrFail({ where: { status: 'active' } })).id }); }
  async createInvite(admin: AdminSession, data: { batchName: string; maxUses: number; expiresAt?: string; schoolId?: string }) { this.requireAdminRole(admin, 'super_admin', 'operator'); const schoolId = admin.schoolId || data.schoolId || ''; if (!schoolId) throw new BadRequestException('请选择学校'); this.ensureAdminScope(admin, schoolId); const code = `WC${Math.random().toString(36).slice(2, 8).toUpperCase()}`; const invite = await this.invites.save(this.invites.create({ schoolId, code, batchName: data.batchName?.trim() || '后台创建', maxUses: Math.max(1, Number(data.maxUses) || 1), expiresAt: data.expiresAt ? new Date(data.expiresAt) : null })); await this.audit(admin, 'invite.create', 'invite', invite.id, invite.batchName); return invite; }
  async adminRoutes(admin: AdminSession) { this.requireAdminRole(admin, 'super_admin', 'operator'); const rows = await this.routes.find({ order: { createdAt: 'DESC' } }); return rows.filter((route) => admin.role === 'super_admin' || route.schoolId === admin.schoolId); }
  async saveRoute(admin: AdminSession, data: Partial<TravelRoute>) { this.requireAdminRole(admin, 'super_admin', 'operator'); const schoolId = data.visibility === 'platform' ? null : (data.schoolId || admin.schoolId); this.ensureAdminScope(admin, schoolId || null); if (!data.title || !data.destination || !data.days) throw new BadRequestException('请填写路线名称、目的地和天数'); const route = await this.routes.save(this.routes.create({ schoolId: schoolId || null, visibility: data.visibility || 'school', title: data.title, destination: data.destination, days: data.days, budget: Number(data.budget) || 0, preferences: Array.isArray(data.preferences) ? data.preferences.join(',') : data.preferences || '', stops: Array.isArray(data.stops) ? data.stops.join(' -> ') : data.stops || '', highlights: Array.isArray(data.highlights) ? data.highlights.join(',') : data.highlights || '', coverUrl: data.coverUrl || '' })); await this.audit(admin, 'route.create', 'route', route.id); return route; }
  async adminKnowledge(admin: AdminSession) { this.requireAdminRole(admin, 'super_admin', 'operator'); const rows = await this.knowledge.find({ order: { createdAt: 'DESC' } }); return rows.filter((item) => admin.role === 'super_admin' || item.schoolId === admin.schoolId); }
  async saveKnowledge(admin: AdminSession, data: Partial<AssistantKnowledge>) { this.requireAdminRole(admin, 'super_admin', 'operator'); const schoolId = data.schoolId || admin.schoolId || null; this.ensureAdminScope(admin, schoolId); if (!data.question || !data.keywords || !data.answer) throw new BadRequestException('请完整填写问题、关键词和答复'); const item = await this.knowledge.save(this.knowledge.create({ schoolId, question: data.question, keywords: data.keywords, answer: data.answer })); await this.audit(admin, 'knowledge.create', 'knowledge', item.id); return item; }
  async adminUsers(admin: AdminSession) { this.requireAdminRole(admin, 'super_admin', 'operator'); const members = await this.memberships.findBy({ schoolId: admin.schoolId || undefined }); return Promise.all(members.map(async (member) => ({ membership: member, user: await this.users.findOneBy({ id: member.userId }) }))); }
  async health() { return { service: 'weculture-api', status: 'healthy', time: new Date().toISOString() }; }
}
