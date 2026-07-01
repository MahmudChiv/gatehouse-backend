import { Injectable, Logger, HttpException, HttpStatus } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import axios from 'axios';

interface TokenCache {
  accessToken: string;
  fetchedAt: Date;
}

@Injectable()
export class NombaService {
  private readonly logger = new Logger(NombaService.name);

  // In-memory token cache
  private tokenCache: TokenCache | null = null;

  // 25 minutes in ms — refresh before 30-min expiry
  private readonly REFRESH_THRESHOLD_MS = 25 * 60 * 1000;

  private readonly baseUrl: string;
  private readonly accountId: string;
  private readonly clientId: string;
  private readonly clientSecret: string;

  constructor(private readonly configService: ConfigService) {
    this.baseUrl = this.configService.get<string>('NOMBA_BASE_URL', 'https://sandbox.nomba.com/v1');
    this.accountId = this.configService.getOrThrow<string>('NOMBA_ACCOUNT_ID');
    this.clientId = this.configService.getOrThrow<string>('NOMBA_CLIENT_ID');
    this.clientSecret = this.configService.getOrThrow<string>('NOMBA_CLIENT_SECRET');
  }

  // ─── Token Management ────────────────────────────────────────────────────

  /**
   * Returns a valid Nomba access token.
   * Serves from in-memory cache if token is younger than 25 minutes.
   * Fetches fresh token otherwise.
   */
  async getAccessToken(): Promise<string> {
    const now = new Date();

    if (this.tokenCache) {
      const ageMs = now.getTime() - this.tokenCache.fetchedAt.getTime();
      if (ageMs < this.REFRESH_THRESHOLD_MS) {
        this.logger.debug('Returning cached Nomba access token');
        return this.tokenCache.accessToken;
      }
    }

    return this.fetchAndCacheToken();
  }

  /**
   * Proactively refresh token every 25 minutes via cron job.
   * This ensures token is always warm in cache.
   */
  @Cron('0 */25 * * * *') // every 25 minutes
  async refreshToken(): Promise<void> {
    this.logger.log('🔄 Proactively refreshing Nomba access token...');
    await this.fetchAndCacheToken();
  }

  private async fetchAndCacheToken(): Promise<string> {
    try {
      this.logger.log('Fetching fresh Nomba access token...');

      const response = await axios.post(
        `${this.baseUrl}/auth/token/issue`,
        {
          grant_type: 'client_credentials',
          client_id: this.clientId,
          client_secret: this.clientSecret,
        },
        {
          headers: {
            'Content-Type': 'application/json',
            accountId: this.accountId,
          },
          timeout: 15000,
        },
      );

      const accessToken: string = response.data?.data?.access_token ?? response.data?.access_token;

      if (!accessToken) {
        throw new Error('No access_token in Nomba response');
      }

      this.tokenCache = {
        accessToken,
        fetchedAt: new Date(),
      };

      this.logger.log('✅ Nomba access token cached successfully');
      return accessToken;
    } catch (error: any) {
      this.logger.error('Failed to obtain Nomba access token', error?.response?.data ?? error?.message);
      throw new HttpException(
        'Failed to connect to Nomba — check credentials and try again',
        HttpStatus.BAD_GATEWAY,
      );
    }
  }

  // ─── Virtual Account Creation ─────────────────────────────────────────────

  /**
   * Creates a permanent virtual account for a unit.
   * accountRef must be unique per call.
   */
  async createVirtualAccount(params: {
    accountRef: string;
    accountName: string;
  }): Promise<{ accountNumber: string; accountName: string; bankName: string }> {
    const token = await this.getAccessToken();

    try {
      this.logger.log(`Creating virtual account for: ${params.accountName}`);

      const response = await axios.post(
        `${this.baseUrl}/accounts/virtual`,
        {
          accountRef: params.accountRef,
          accountName: params.accountName,
          // No expiryDate → permanent account
        },
        {
          headers: {
            Authorization: `Bearer ${token}`,
            accountId: this.accountId,
            'Content-Type': 'application/json',
          },
          timeout: 20000,
        },
      );

      const data = response.data?.data ?? response.data;

      return {
        accountNumber: data.accountNumber ?? data.account_number,
        accountName: data.accountName ?? data.account_name ?? params.accountName,
        bankName: data.bankName ?? data.bank_name ?? 'Nomba',
      };
    } catch (error: any) {
      this.logger.error(
        `Failed to create virtual account for ${params.accountName}`,
        error?.response?.data ?? error?.message,
      );
      throw new HttpException(
        `Failed to create virtual account for ${params.accountName}`,
        HttpStatus.BAD_GATEWAY,
      );
    }
  }

  /**
   * Exposes the cached token state for connectivity health check.
   */
  isConnected(): boolean {
    if (!this.tokenCache) return false;
    const ageMs = new Date().getTime() - this.tokenCache.fetchedAt.getTime();
    return ageMs < 30 * 60 * 1000; // within 30-min TTL
  }
}
