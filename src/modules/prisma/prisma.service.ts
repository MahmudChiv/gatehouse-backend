import {
  Injectable,
  OnModuleInit,
  OnModuleDestroy,
  Logger,
} from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(PrismaService.name);

  constructor() {
    super({
      log: [
        { emit: 'stdout', level: 'warn' },
        { emit: 'stdout', level: 'error' },
      ],
    });
  }

  async onModuleInit() {
    await this.connectWithRetry();
  }

  async onModuleDestroy() {
    await this.$disconnect();
    this.logger.log('Database connection closed');
  }

  // ─── Retry Logic ───────────────────────────────────────────────────────────
  // Retries up to 5 times with 3-second backoff so the app doesn't hard-crash
  // when the DB is momentarily unreachable (e.g. Railway cold-start).

  private async connectWithRetry(attempts = 5, delayMs = 3000): Promise<void> {
    for (let attempt = 1; attempt <= attempts; attempt++) {
      try {
        await this.$connect();
        this.logger.log('✅ Database connection established');
        return;
      } catch (err: any) {
        const isLast = attempt === attempts;
        const code = err?.errorCode ?? err?.code ?? 'UNKNOWN';

        if (isLast) {
          this.logger.error(
            `❌ Failed to connect to database after ${attempts} attempts (${code}): ${err?.message}`,
          );
          // Rethrow so NestJS knows initialisation failed
          throw err;
        }

        this.logger.warn(
          `⚠️  DB connection attempt ${attempt}/${attempts} failed (${code}) — retrying in ${delayMs / 1000}s...`,
        );
        await this.sleep(delayMs);
      }
    }
  }

  private sleep(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
