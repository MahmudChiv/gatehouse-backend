import { Injectable, Logger, HttpException, HttpStatus } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import { createHmac, timingSafeEqual } from 'crypto';
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

  /**
   * In-flight fetch lock — ensures concurrent callers share a single
   * token fetch rather than stampeding the Nomba auth endpoint.
   */
  private fetchingToken: Promise<string> | null = null;

  private readonly baseUrl: string; // version-less, e.g. https://sandbox.nomba.com
  private readonly accountId: string; // parent accountId (sent as the `accountId` header)
  private readonly subAccountId: string; // YOUR sub-account id (from Nomba); VAs are created under it
  private readonly clientId: string;
  private readonly clientSecret: string;
  private readonly webhookSignatureKey: string;

  constructor(private readonly configService: ConfigService) {
    // Normalise the base URL: Nomba endpoints live under different versions
    // (/v1/auth, /v1/accounts, /v2/transfers), so strip any trailing version
    // segment and add it per-endpoint instead.
    const raw = this.configService.get<string>('NOMBA_BASE_URL', 'https://sandbox.nomba.com');
    this.baseUrl = raw.replace(/\/(v\d+)?\/?$/i, '');
    this.accountId = this.configService.getOrThrow<string>('NOMBA_ACCOUNT_ID');
    this.subAccountId = this.configService.get<string>('NOMBA_SUB_ACCOUNT_ID', '');
    this.clientId = this.configService.getOrThrow<string>('NOMBA_CLIENT_ID');
    this.clientSecret = this.configService.getOrThrow<string>('NOMBA_CLIENT_SECRET');
    this.webhookSignatureKey = this.configService.get<string>('NOMBA_WEBHOOK_SIGNATURE_KEY', '');
  }

  // ─── Token Management ────────────────────────────────────────────────────

  /**
   * Returns a valid Nomba access token.
   * Serves from in-memory cache if token is younger than 25 minutes.
   * If a fetch is already in progress (e.g. from concurrent unit creation),
   * all callers await the same promise instead of firing duplicate requests.
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

    // If a fetch is already in flight, share it — don't fire a second request
    if (this.fetchingToken) {
      this.logger.debug('Token fetch already in progress — awaiting shared promise');
      return this.fetchingToken;
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
    // Set the shared in-flight promise so concurrent callers wait on this
    this.fetchingToken = this._doFetchToken().finally(() => {
      this.fetchingToken = null;
    });
    return this.fetchingToken;
  }

  private async _doFetchToken(): Promise<string> {
    try {
      this.logger.log('Fetching fresh Nomba access token...');

      const response = await axios.post(
        `${this.baseUrl}/v1/auth/token/issue`,
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
        this.logger.error(
          `Nomba auth response missing access_token. Full response: ${JSON.stringify(response.data)}`,
        );
        throw new Error('No access_token in Nomba response');
      }

      this.tokenCache = {
        accessToken,
        fetchedAt: new Date(),
      };

      this.logger.log('✅ Nomba access token cached successfully');
      return accessToken;
    } catch (error: any) {
      const detail = error?.response
        ? `HTTP ${error.response.status}: ${JSON.stringify(error.response.data)}`
        : error?.message;
      this.logger.error(`Failed to obtain Nomba access token — ${detail}`);
      throw new HttpException(
        'Failed to connect to Nomba — check credentials and try again',
        HttpStatus.BAD_GATEWAY,
      );
    }
  }

  // ─── Virtual Account Creation ─────────────────────────────────────────────

  /**
   * Creates a permanent virtual account under YOUR sub-account, so inbound funds
   * settle into your sub-account (not the parent/mothership). Uses
   * POST /v1/accounts/virtual/{subAccountId} when NOMBA_SUB_ACCOUNT_ID is set
   * (the hackathon pattern); falls back to the parent-level endpoint otherwise.
   * accountRef must be unique per call.
   */
  async createVirtualAccount(params: {
    accountRef: string;
    accountName: string;
  }): Promise<{ accountNumber: string; accountName: string; bankName: string }> {
    const token = await this.getAccessToken();

    try {
      this.logger.log(`Creating virtual account for: ${params.accountName}`);

      const path = this.subAccountId
        ? `/v1/accounts/virtual/${this.subAccountId}`
        : `/v1/accounts/virtual`;

      const response = await axios.post(
        `${this.baseUrl}${path}`,
        {
          accountRef: params.accountRef,
          accountName: params.accountName,
          currency: 'NGN',
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

      // Nomba sandbox returns `bankAccountNumber` / `bankAccountName`
      // Some API versions may return `accountNumber` / `accountName` — handle both
      const accountNumber =
        data.bankAccountNumber ??
        data.accountNumber ??
        data.account_number;

      if (!accountNumber) {
        this.logger.error(
          `Nomba virtual account response missing account number. Full data: ${JSON.stringify(data)}`,
        );
        throw new Error(
          `Nomba did not return an account number for ${params.accountName}`,
        );
      }

      const accountName =
        data.bankAccountName ??
        data.accountName ??
        data.account_name ??
        params.accountName;

      const bankName = data.bankName ?? data.bank_name ?? 'Nomba';

      return { accountNumber, accountName, bankName };
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

  // ─── Transfers / Payouts ──────────────────────────────────────────────────

  /**
   * Pays out to a vendor bank account via the Nomba Transfers API.
   * `merchantTxRef` is the idempotency key and must be unique per payout.
   */
  async transferToBank(params: {
    amountNaira: number;
    accountNumber: string;
    accountName: string;
    bankCode: string;
    merchantTxRef: string;
    senderName?: string;
    narration?: string;
  }): Promise<{ id: string | null; status: string }> {
    const token = await this.getAccessToken();
    // Pay out FROM your sub-account (where collections settle) when configured,
    // else from the parent account.
    const path = this.subAccountId
      ? `/v2/transfers/bank/${this.subAccountId}`
      : `/v2/transfers/bank`;
    try {
      const response = await axios.post(
        `${this.baseUrl}${path}`,
        {
          amount: params.amountNaira,
          accountNumber: params.accountNumber,
          accountName: params.accountName,
          bankCode: params.bankCode,
          merchantTxRef: params.merchantTxRef,
          senderName: params.senderName,
          narration: params.narration,
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
      return { id: data?.id ?? null, status: data?.status ?? 'PENDING' };
    } catch (error: any) {
      this.logger.error(
        `Nomba transfer failed for ${params.merchantTxRef}`,
        error?.response?.data ?? error?.message,
      );
      throw new HttpException('Failed to process payout via Nomba', HttpStatus.BAD_GATEWAY);
    }
  }

  // ─── Bank list ────────────────────────────────────────────────────────────

  /**
   * Lists the banks Nomba can transfer to. Each `code` is what the account lookup
   * and payout endpoints expect as `bankCode`. GET /v1/transfers/banks nests the
   * banks under `data` — which the sandbox returns as the array itself (the docs
   * show `data.results[]`), so we handle both — each entry being { code, name }.
   */
  async listBanks(): Promise<{ name: string; code: string }[]> {
    const token = await this.getAccessToken();
    try {
      const response = await axios.get(`${this.baseUrl}/v1/transfers/banks`, {
        headers: { Authorization: `Bearer ${token}`, accountId: this.accountId },
        timeout: 15000,
      });
      const body = response.data?.data ?? response.data;
      const results = Array.isArray(body) ? body : (body?.results ?? []);
      return results
        .map((b: any) => ({ name: b.name ?? b.bankName, code: b.code ?? b.bankCode }))
        .filter((b: { name?: string; code?: string }) => b.name && b.code);
    } catch (error: any) {
      const detail = error?.response
        ? `HTTP ${error.response.status}: ${JSON.stringify(error.response.data)}`
        : error?.message;
      this.logger.error(`Failed to fetch Nomba bank list — ${detail}`);
      throw new HttpException('Could not load bank list', HttpStatus.BAD_GATEWAY);
    }
  }

  // ─── Account name lookup (name enquiry) ───────────────────────────────────

  /**
   * Resolves the registered account-holder name for a bank account, so a manager
   * can confirm a vendor's details before saving or paying. Wraps Nomba's
   * POST /v1/transfers/bank/lookup (accountNumber + bankCode). Throws BAD_GATEWAY
   * when Nomba can't verify, so the caller surfaces "couldn't verify" rather than
   * storing an unchecked name.
   */
  async resolveAccountName(params: {
    accountNumber: string;
    bankCode: string;
  }): Promise<{ accountName: string }> {
    const token = await this.getAccessToken();
    try {
      const response = await axios.post(
        `${this.baseUrl}/v1/transfers/bank/lookup`,
        { accountNumber: params.accountNumber, bankCode: params.bankCode },
        {
          headers: {
            Authorization: `Bearer ${token}`,
            accountId: this.accountId,
            'Content-Type': 'application/json',
          },
          timeout: 15000,
        },
      );
      const data = response.data?.data ?? response.data;
      const accountName = data?.accountName ?? data?.account_name;
      if (!accountName) {
        this.logger.error(
          `Nomba account lookup returned no name: ${JSON.stringify(response.data)}`,
        );
        throw new Error('no accountName in Nomba lookup response');
      }
      return { accountName };
    } catch (error: any) {
      const detail = error?.response
        ? `HTTP ${error.response.status}: ${JSON.stringify(error.response.data)}`
        : error?.message;
      this.logger.error(`Nomba account lookup failed — ${detail}`);
      throw new HttpException(
        'Could not verify account — check the number and bank and try again',
        HttpStatus.BAD_GATEWAY,
      );
    }
  }

  // ─── Transactions (verify / backfill) ─────────────────────────────────────

  /**
   * Lists transactions for YOUR sub-account (where unit virtual accounts settle),
   * used to poll for inbound payments the webhook may have missed. Cursor-based:
   * pass the returned `cursor` back on the next call to page forward until it is
   * empty. Ref: GET /v1/transactions/accounts/{subAccountId}.
   */
  async fetchSubAccountTransactions(params?: {
    limit?: number;
    cursor?: string;
    dateFrom?: string; // ISO 8601 UTC, e.g. 2026-07-05T00:00:00.000Z
    dateTo?: string; // ISO 8601 UTC
  }): Promise<{ results: any[]; cursor: string }> {
    if (!this.subAccountId) {
      throw new HttpException('NOMBA_SUB_ACCOUNT_ID is not configured', HttpStatus.PRECONDITION_FAILED);
    }
    const token = await this.getAccessToken();
    const query = new URLSearchParams();
    if (params?.limit) query.set('limit', String(params.limit));
    if (params?.cursor) query.set('cursor', params.cursor);
    if (params?.dateFrom) query.set('dateFrom', params.dateFrom);
    if (params?.dateTo) query.set('dateTo', params.dateTo);
    const suffix = query.toString() ? `?${query.toString()}` : '';
    const response = await axios.get(
      `${this.baseUrl}/v1/transactions/accounts/${this.subAccountId}${suffix}`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          accountId: this.accountId,
        },
        timeout: 20000,
      },
    );
    const data = response.data?.data ?? {};
    return { results: data.results ?? [], cursor: data.cursor ?? '' };
  }

  // ─── Sub-account balance ──────────────────────────────────────────────────

  /**
   * Live balance of YOUR Nomba sub-account (the settlement account VAs are
   * created under and payouts leave from). This is the whole float, not a
   * per-estate figure. GET /v1/accounts/{subAccountId}/balance returns the
   * amount as a naira string (e.g. "281946.0").
   *
   * Soft-fails to `{ available: false }` (not configured / Nomba error) so the
   * balance widget degrades gracefully instead of breaking the dashboard.
   */
  async fetchSubAccountBalance(): Promise<{
    available: boolean;
    amountNaira?: number;
    currency?: string;
    asOf?: number;
  }> {
    if (!this.subAccountId) {
      this.logger.warn('Sub-account balance requested but NOMBA_SUB_ACCOUNT_ID is not set');
      return { available: false };
    }
    try {
      const token = await this.getAccessToken();
      const response = await axios.get(
        `${this.baseUrl}/v1/accounts/${this.subAccountId}/balance`,
        {
          headers: { Authorization: `Bearer ${token}`, accountId: this.accountId },
          timeout: 15000,
        },
      );
      const data = response.data?.data ?? response.data;
      const amountNaira = Number(data?.amount);
      if (!Number.isFinite(amountNaira)) {
        this.logger.error(
          `Nomba balance response missing a numeric amount: ${JSON.stringify(response.data)}`,
        );
        return { available: false };
      }
      return {
        available: true,
        amountNaira,
        currency: data?.currency ?? 'NGN',
        asOf: data?.timeCreated ? new Date(data.timeCreated).getTime() : Date.now(),
      };
    } catch (error: any) {
      const detail = error?.response
        ? `HTTP ${error.response.status}: ${JSON.stringify(error.response.data)}`
        : error?.message;
      this.logger.error(`Failed to fetch Nomba sub-account balance — ${detail}`);
      return { available: false };
    }
  }

  // ─── Webhook signature ────────────────────────────────────────────────────

  /**
   * Verifies a Nomba webhook. Nomba signs the colon-joined string
   * event_type:requestId:userId:walletId:transactionId:type:time:responseCode:nomba-timestamp
   * with HmacSHA256 using the dashboard signature key, delivered in `nomba-signature`.
   */
  verifyWebhookSignature(payload: any, signature: string, nombaTimestamp: string): boolean {
    if (!this.webhookSignatureKey || !signature) return false;
    const tx = payload?.data?.transaction ?? {};
    const merchant = payload?.data?.merchant ?? {};
    const signed = [
      payload?.event_type,
      payload?.requestId,
      merchant?.userId,
      merchant?.walletId,
      tx?.transactionId,
      tx?.type,
      tx?.time,
      tx?.responseCode,
      nombaTimestamp,
    ].join(':');
    const expected = createHmac('sha256', this.webhookSignatureKey).update(signed).digest('hex');
    try {
      const a = Buffer.from(expected);
      const b = Buffer.from(signature);
      return a.length === b.length && timingSafeEqual(a, b);
    } catch {
      return false;
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
