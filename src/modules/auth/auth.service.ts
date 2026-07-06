import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../prisma/prisma.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
  ) {}

  // ─── Register ──────────────────────────────────────────────────────────────

  async register(dto: RegisterDto) {
    const { fullName, email, phone, password } = dto;

    // Check duplicate email
    const existing = await this.prisma.manager.findFirst({
      where: { email, deletedAt: null },
    });

    if (existing) {
      throw new ConflictException('An account with this email already exists');
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const manager = await this.prisma.manager.create({
      data: { fullName, email, phone, hashedPassword },
      select: { id: true, fullName: true, email: true, phone: true, createdAt: true },
    });

    this.logger.log(`New manager registered: ${email}`);

    const token = this.signToken(manager.id, manager.email);

    return {
      message: 'Registration successful',
      data: {
        manager,
        accessToken: token,
      },
    };
  }

  // ─── Login ─────────────────────────────────────────────────────────────────

  async login(dto: LoginDto) {
    const { email, password } = dto;

    const manager = await this.prisma.manager.findFirst({
      where: { email, deletedAt: null },
    });

    if (!manager) {
      throw new UnauthorizedException('Invalid email or password');
    }

    const isPasswordValid = await bcrypt.compare(password, manager.hashedPassword);

    if (!isPasswordValid) {
      throw new UnauthorizedException('Invalid email or password');
    }

    this.logger.log(`Manager logged in: ${email}`);

    const token = this.signToken(manager.id, manager.email);

    return {
      message: 'Login successful',
      data: {
        manager: {
          id: manager.id,
          fullName: manager.fullName,
          email: manager.email,
          phone: manager.phone,
          createdAt: manager.createdAt,
        },
        accessToken: token,
      },
    };
  }

  // ─── Logout ────────────────────────────────────────────────────────────────

  async logout() {
    // Stateless JWT — client should discard the token
    // Token blacklisting (Redis) is out of scope for hackathon
    return {
      message: 'Logged out successfully',
    };
  }

  // ─── Current manager + estates ───────────────────────────────────────────────

  async me(managerId: string) {
    const manager = await this.prisma.manager.findUnique({
      where: { id: managerId },
      select: { id: true, fullName: true, email: true, phone: true },
    });
    const estates = await this.prisma.estate.findMany({
      where: { managerId, deletedAt: null },
      select: { id: true, name: true, city: true, cycleLabel: true, _count: { select: { Unit: true } } },
      orderBy: { createdAt: 'asc' },
    });
    return {
      message: 'OK',
      data: {
        manager,
        estates: estates.map((e) => ({ id: e.id, name: e.name, city: e.city, cycleLabel: e.cycleLabel, unitsCount: e._count.Unit })),
      },
    };
  }

  // ─── Helpers ───────────────────────────────────────────────────────────────

  private signToken(managerId: string, email: string): string {
    return this.jwtService.sign({ sub: managerId, email });
  }
}
