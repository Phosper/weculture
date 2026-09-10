import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { AppService } from './app.service';
import { AdminGuard, UserGuard } from './auth';

@Controller('api/v1')
export class AppController {
  constructor(private readonly service: AppService) {}

  @Get('health') health() { return this.service.health(); }
  @Post('auth/wechat/login') login(@Body() body: { code: string }) { return this.service.userLogin(body.code); }
  @Post('auth/refresh') refresh(@Body() body: { token: string }) { return { token: body.token }; }

  @UseGuards(UserGuard)
  @Get('me') me(@Req() req: { user: any }) { return this.service.getMe(req.user); }
  @UseGuards(UserGuard)
  @Patch('me') updateMe(@Req() req: { user: any }, @Body() body: { nickname?: string; avatarUrl?: string }) { return this.service.updateMe(req.user, body); }
  @UseGuards(UserGuard)
  @Post('me/school-verifications') verifySchool(@Req() req: { user: any }, @Body() body: { code: string }) { return this.service.verifySchool(req.user, body.code); }
  @UseGuards(UserGuard)
  @Get('me/plans') plans(@Req() req: { user: any }) { return this.service.myPlans(req.user); }
  @UseGuards(UserGuard)
  @Get('me/posts') myPosts(@Req() req: { user: any }) { return this.service.myPosts(req.user); }

  @UseGuards(UserGuard)
  @Get('posts') posts(@Req() req: { user: any }, @Query() query: any) { return this.service.listPosts(req.user, query); }
  @UseGuards(UserGuard)
  @Post('posts') createPost(@Req() req: { user: any }, @Body() body: Record<string, unknown>) { return this.service.createPost(req.user, body); }
  @UseGuards(UserGuard)
  @Get('posts/:id') post(@Req() req: { user: any }, @Param('id') id: string) { return this.service.getPost(req.user, id); }
  @UseGuards(UserGuard)
  @Post('posts/:id/likes') like(@Req() req: { user: any }, @Param('id') id: string) { return this.service.toggleLike(req.user, id); }
  @UseGuards(UserGuard)
  @Post('posts/:id/favorite') favorite(@Req() req: { user: any }, @Param('id') id: string) { return this.service.toggleFavorite(req.user, 'post', id); }

  @UseGuards(UserGuard)
  @Post('events/:id/registrations') register(@Req() req: { user: any }, @Param('id') id: string) { return this.service.registerEvent(req.user, id); }
  @UseGuards(UserGuard)
  @Delete('events/:id/registrations/me') cancelRegistration(@Req() req: { user: any }, @Param('id') id: string) { return this.service.cancelEvent(req.user, id); }

  @UseGuards(UserGuard)
  @Get('travel-routes') routes(@Req() req: { user: any }, @Query() query: any) { const preferences = typeof query.preferences === 'string' ? query.preferences.split(',') : []; return this.service.listRoutes(req.user, { ...query, preferences }); }
  @UseGuards(UserGuard)
  @Post('travel-routes/recommendations') routeRecommendations(@Req() req: { user: any }, @Body() body: any) { return this.service.listRoutes(req.user, body); }
  @UseGuards(UserGuard)
  @Post('travel-routes/:id/plans') planRoute(@Req() req: { user: any }, @Param('id') id: string) { return this.service.togglePlan(req.user, id); }
  @UseGuards(UserGuard)
  @Post('travel-routes/:id/favorite') favoriteRoute(@Req() req: { user: any }, @Param('id') id: string) { return this.service.toggleFavorite(req.user, 'route', id); }

  @UseGuards(UserGuard)
  @Get('assistant/quick-actions') quickActions(@Req() req: { user: any }) { return this.service.quickActions(req.user); }
  @UseGuards(UserGuard)
  @Post('assistant/messages') assistant(@Req() req: { user: any }, @Body() body: { content: string }) { return this.service.assistantMessage(req.user, body.content); }

  @Post('admin/auth/login') adminLogin(@Body() body: { username: string; password: string }) { return this.service.adminLogin(body.username, body.password); }
  @UseGuards(AdminGuard)
  @Get('admin/dashboard') dashboard(@Req() req: { admin: any }) { return this.service.adminDashboard(req.admin); }
  @UseGuards(AdminGuard)
  @Get('admin/posts') adminPosts(@Req() req: { admin: any }, @Query('status') status?: string) { return this.service.adminPosts(req.admin, status); }
  @UseGuards(AdminGuard)
  @Post('admin/posts/:id/review') reviewPost(@Req() req: { admin: any }, @Param('id') id: string, @Body() body: { status: 'approved' | 'rejected' | 'offline'; reason?: string }) { return this.service.reviewPost(req.admin, id, body.status, body.reason); }
  @UseGuards(AdminGuard)
  @Get('admin/invites') invites(@Req() req: { admin: any }) { return this.service.adminInvites(req.admin); }
  @UseGuards(AdminGuard)
  @Post('admin/invites') createInvite(@Req() req: { admin: any }, @Body() body: { batchName: string; maxUses: number; expiresAt?: string; schoolId?: string }) { return this.service.createInvite(req.admin, body); }
  @UseGuards(AdminGuard)
  @Get('admin/routes') adminRoutes(@Req() req: { admin: any }) { return this.service.adminRoutes(req.admin); }
  @UseGuards(AdminGuard)
  @Post('admin/routes') saveRoute(@Req() req: { admin: any }, @Body() body: any) { return this.service.saveRoute(req.admin, body); }
  @UseGuards(AdminGuard)
  @Get('admin/knowledge') adminKnowledge(@Req() req: { admin: any }) { return this.service.adminKnowledge(req.admin); }
  @UseGuards(AdminGuard)
  @Post('admin/knowledge') saveKnowledge(@Req() req: { admin: any }, @Body() body: any) { return this.service.saveKnowledge(req.admin, body); }
  @UseGuards(AdminGuard)
  @Get('admin/users') adminUsers(@Req() req: { admin: any }) { return this.service.adminUsers(req.admin); }
}
