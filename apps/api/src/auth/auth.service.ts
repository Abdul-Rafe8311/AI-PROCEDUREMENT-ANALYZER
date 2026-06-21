import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { AuditAction, Role } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../prisma/prisma.service';
import { UsersRepository } from '../users/users.repository';
import { AuditService } from '../audit/audit.service';
import {
  ForgotPasswordDto,
  LoginDto,
  RegisterDto,
  ResetPasswordDto,
} from './dto/auth.dto';

interface RequestMeta {
  ip?: string;
  userAgent?: string;
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly users: UsersRepository,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  private async signTokens(userId: string, email: string, role: string) {
    const payload = { sub: userId, email, role };
    const accessToken = await this.jwt.signAsync(payload, {
      secret: this.config.get<string>('jwt.accessSecret'),
      expiresIn: this.config.get<string>('jwt.accessExpires'),
    });
    const refreshToken = await this.jwt.signAsync(payload, {
      secret: this.config.get<string>('jwt.refreshSecret'),
      expiresIn: this.config.get<string>('jwt.refreshExpires'),
    });

    // Persist a hash of the refresh token so it can be revoked
    const tokenHash = await bcrypt.hash(refreshToken, 10);
    await this.prisma.refreshToken.create({
      data: {
        userId,
        tokenHash,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      },
    });

    return { accessToken, refreshToken };
  }

  async register(dto: RegisterDto, meta: RequestMeta = {}) {
    const existing = await this.users.findByEmail(dto.email);
    if (existing) throw new ConflictException('Email already registered');

    const passwordHash = await bcrypt.hash(dto.password, 12);
    const user = await this.users.create({
      email: dto.email.toLowerCase(),
      passwordHash,
      firstName: dto.firstName,
      lastName: dto.lastName,
      role: dto.role ?? Role.PROCUREMENT_MANAGER,
    });

    await this.audit.log({
      userId: user.id,
      action: AuditAction.CREATE,
      entityType: 'User',
      entityId: user.id,
      metadata: { event: 'register' },
      ipAddress: meta.ip,
      userAgent: meta.userAgent,
    });

    const tokens = await this.signTokens(user.id, user.email, user.role);
    return { user: this.publicUser(user), ...tokens };
  }

  async login(dto: LoginDto, meta: RequestMeta = {}) {
    const user = await this.users.findByEmail(dto.email);
    if (!user || !user.isActive) {
      throw new UnauthorizedException('Invalid credentials');
    }
    const valid = await bcrypt.compare(dto.password, user.passwordHash);
    if (!valid) throw new UnauthorizedException('Invalid credentials');

    await this.users.update(user.id, { lastLoginAt: new Date() });
    await this.audit.log({
      userId: user.id,
      action: AuditAction.LOGIN,
      entityType: 'User',
      entityId: user.id,
      ipAddress: meta.ip,
      userAgent: meta.userAgent,
    });

    const tokens = await this.signTokens(user.id, user.email, user.role);
    return { user: this.publicUser(user), ...tokens };
  }

  async refresh(refreshToken: string) {
    let payload: { sub: string; email: string; role: string };
    try {
      payload = await this.jwt.verifyAsync(refreshToken, {
        secret: this.config.get<string>('jwt.refreshSecret'),
      });
    } catch {
      throw new UnauthorizedException('Invalid refresh token');
    }

    // Verify the token has not been revoked
    const stored = await this.prisma.refreshToken.findMany({
      where: { userId: payload.sub, revoked: false, expiresAt: { gt: new Date() } },
    });
    const match = await Promise.all(
      stored.map((t) => bcrypt.compare(refreshToken, t.tokenHash)),
    );
    if (!match.some(Boolean)) {
      throw new UnauthorizedException('Refresh token revoked or expired');
    }

    return this.signTokens(payload.sub, payload.email, payload.role);
  }

  async logout(userId: string) {
    await this.prisma.refreshToken.updateMany({
      where: { userId, revoked: false },
      data: { revoked: true },
    });
    await this.audit.log({
      userId,
      action: AuditAction.LOGOUT,
      entityType: 'User',
      entityId: userId,
    });
    return { success: true };
  }

  /**
   * Generates a short-lived reset token. In production this would be emailed;
   * here it is returned so the flow is testable end-to-end without SMTP.
   */
  async forgotPassword(dto: ForgotPasswordDto) {
    const user = await this.users.findByEmail(dto.email);
    // Always return success to avoid user enumeration
    if (!user) {
      return { message: 'If the account exists, a reset link has been sent.' };
    }
    const resetToken = await this.jwt.signAsync(
      { sub: user.id, email: user.email },
      {
        secret: this.config.get<string>('jwt.resetSecret'),
        expiresIn: this.config.get<string>('jwt.resetExpires'),
      },
    );
    this.logger.log(`Password reset token issued for ${user.email}`);
    return {
      message: 'If the account exists, a reset link has been sent.',
      // Exposed for dev/testing only — remove in real email-backed deployments.
      resetToken,
    };
  }

  async resetPassword(dto: ResetPasswordDto) {
    let payload: { sub: string };
    try {
      payload = await this.jwt.verifyAsync(dto.token, {
        secret: this.config.get<string>('jwt.resetSecret'),
      });
    } catch {
      throw new BadRequestException('Invalid or expired reset token');
    }
    const passwordHash = await bcrypt.hash(dto.password, 12);
    await this.users.update(payload.sub, { passwordHash });
    // Revoke all sessions after a password reset
    await this.prisma.refreshToken.updateMany({
      where: { userId: payload.sub },
      data: { revoked: true },
    });
    await this.audit.log({
      userId: payload.sub,
      action: AuditAction.UPDATE,
      entityType: 'User',
      entityId: payload.sub,
      metadata: { event: 'password_reset' },
    });
    return { success: true };
  }

  private publicUser(user: {
    id: string;
    email: string;
    firstName: string;
    lastName: string;
    role: Role;
  }) {
    return {
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      role: user.role,
    };
  }
}
