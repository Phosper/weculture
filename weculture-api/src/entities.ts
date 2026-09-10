import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

abstract class BaseEntity {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @CreateDateColumn() createdAt!: Date;
  @UpdateDateColumn() updatedAt!: Date;
}

@Entity('schools')
export class School extends BaseEntity {
  @Column({ unique: true }) name!: string;
  @Column() shortName!: string;
  @Column({ default: 'active' }) status!: 'active' | 'inactive';
}

@Entity('users')
export class User extends BaseEntity {
  @Index({ unique: true }) @Column() wechatOpenId!: string;
  @Column({ default: '' }) nickname!: string;
  @Column({ default: '' }) avatarUrl!: string;
  @Column({ default: 'active' }) status!: 'active' | 'disabled' | 'deleted';
}

@Entity('school_memberships')
@Index(['userId', 'schoolId'], { unique: true })
export class SchoolMembership extends BaseEntity {
  @Column() userId!: string;
  @Column() schoolId!: string;
  @Column({ default: 'verified' }) verificationStatus!: 'verified' | 'revoked';
  @Column({ default: 'member' }) memberRole!: string;
}

@Entity('invite_codes')
export class InviteCode extends BaseEntity {
  @Index({ unique: true }) @Column() code!: string;
  @Column() schoolId!: string;
  @Column() batchName!: string;
  @Column({ default: 1 }) maxUses!: number;
  @Column({ default: 0 }) usedCount!: number;
  @Column({ type: 'datetime', nullable: true }) expiresAt!: Date | null;
  @Column({ default: 'active' }) status!: 'active' | 'revoked';
}

@Entity('posts')
export class Post extends BaseEntity {
  @Column({ type: 'varchar', nullable: true }) schoolId!: string | null;
  @Column() authorId!: string;
  @Column() type!: 'dynamic' | 'event' | 'market';
  @Column({ default: 'school' }) visibility!: 'platform' | 'school';
  @Column({ default: 'pending' }) status!: 'draft' | 'pending' | 'approved' | 'rejected' | 'offline';
  @Column() title!: string;
  @Column('text') content!: string;
  @Column({ default: '' }) imageUrl!: string;
  @Column({ default: '' }) tag!: string;
  @Column({ default: 0 }) likeCount!: number;
  @Column({ default: '' }) rejectionReason!: string;
  @Column({ type: 'varchar', nullable: true }) reviewedBy!: string | null;
}

@Entity('events')
export class Event extends BaseEntity {
  @Index({ unique: true }) @Column() postId!: string;
  @Column() startsAt!: Date;
  @Column() endsAt!: Date;
  @Column() location!: string;
  @Column() registrationDeadline!: Date;
  @Column({ default: 30 }) capacity!: number;
  @Column({ default: 0 }) registeredCount!: number;
  @Column({ default: 'active' }) status!: 'active' | 'changed' | 'cancelled';
}

@Entity('event_registrations')
@Index(['eventId', 'userId'], { unique: true })
export class EventRegistration extends BaseEntity {
  @Column() eventId!: string;
  @Column() userId!: string;
  @Column({ default: 'registered' }) status!: 'registered' | 'cancelled';
}

@Entity('likes')
@Index(['userId', 'postId'], { unique: true })
export class Like extends BaseEntity { @Column() userId!: string; @Column() postId!: string; }

@Entity('favorites')
@Index(['userId', 'targetType', 'targetId'], { unique: true })
export class Favorite extends BaseEntity { @Column() userId!: string; @Column() targetType!: string; @Column() targetId!: string; }

@Entity('travel_routes')
export class TravelRoute extends BaseEntity {
  @Column({ type: 'varchar', nullable: true }) schoolId!: string | null;
  @Column({ default: 'platform' }) visibility!: 'platform' | 'school';
  @Column({ default: 'active' }) status!: 'active' | 'offline';
  @Column() title!: string;
  @Column() destination!: string;
  @Column() days!: string;
  @Column() budget!: number;
  @Column('text') preferences!: string;
  @Column('text') stops!: string;
  @Column('text') highlights!: string;
  @Column({ default: '' }) coverUrl!: string;
}

@Entity('user_plans')
@Index(['userId', 'targetType', 'targetId'], { unique: true })
export class UserPlan extends BaseEntity { @Column() userId!: string; @Column() targetType!: string; @Column() targetId!: string; @Column({ default: 'active' }) status!: string; }

@Entity('assistant_knowledge')
export class AssistantKnowledge extends BaseEntity {
  @Column({ type: 'varchar', nullable: true }) schoolId!: string | null;
  @Column() question!: string;
  @Column('text') keywords!: string;
  @Column('text') answer!: string;
  @Column({ default: 'active' }) status!: string;
}

@Entity('assistant_messages')
export class AssistantMessage extends BaseEntity {
  @Column() userId!: string;
  @Column({ type: 'varchar', nullable: true }) schoolId!: string | null;
  @Column() role!: 'user' | 'assistant';
  @Column('text') content!: string;
}

@Entity('admin_accounts')
export class AdminAccount extends BaseEntity {
  @Index({ unique: true }) @Column() username!: string;
  @Column() passwordHash!: string;
  @Column({ default: 'operator' }) role!: 'super_admin' | 'operator' | 'reviewer';
  @Column({ type: 'varchar', nullable: true }) schoolId!: string | null;
  @Column({ default: 'active' }) status!: string;
}

@Entity('audit_logs')
export class AuditLog extends BaseEntity {
  @Column() adminId!: string;
  @Column({ type: 'varchar', nullable: true }) schoolId!: string | null;
  @Column() action!: string;
  @Column() resourceType!: string;
  @Column() resourceId!: string;
  @Column({ default: 'success' }) result!: string;
  @Column('text', { default: '' }) detail!: string;
}

export const ENTITIES = [School, User, SchoolMembership, InviteCode, Post, Event, EventRegistration, Like, Favorite, TravelRoute, UserPlan, AssistantKnowledge, AssistantMessage, AdminAccount, AuditLog];
