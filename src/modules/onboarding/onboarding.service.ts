import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { NombaService } from '../nomba/nomba.service';
import { CreateEstateDto } from './dto/create-estate.dto';
import { CreateFeeDto } from './dto/create-fee.dto';
import { CreateUnitDto, OccupantType, UnitItemDto } from './dto/create-unit.dto';
import { parse } from 'csv-parse/sync';
import { randomBytes, randomUUID } from 'crypto';
import { FeeFrequency, FeeType } from '@prisma/client';
import { nairaToKobo } from '../../common/money';

@Injectable()
export class OnboardingService {
  private readonly logger = new Logger(OnboardingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly nombaService: NombaService,
  ) {}

  // ─── Estate ──────────────────────────────────────────────────────────────

  async createEstate(managerId: string, dto: CreateEstateDto) {
    // Prevent duplicate estate names per manager
    const existing = await this.prisma.estate.findFirst({
      where: { managerId, name: dto.name, deletedAt: null },
    });

    if (existing) {
      throw new BadRequestException(
        `You already have an estate named "${dto.name}"`,
      );
    }

    const estate = await this.prisma.estate.create({
      data: {
        managerId,
        name: dto.name,
        address: dto.address,
        city: dto.city,
        state: dto.state,
        units: dto.units,
      },
    });

    this.logger.log(`Estate created: ${estate.name} (${estate.id}) by manager ${managerId}`);

    return {
      message: 'Estate created successfully',
      data: estate,
    };
  }

  // ─── Connect Nomba Account ─────────────────────────────────────────────────

  async connectNombaAccount() {
    // Calling getAccessToken() will:
    //  1. Return cached token if < 25 min old
    //  2. Fetch fresh token otherwise and cache it
    const accessToken = await this.nombaService.getAccessToken();

    this.logger.log('Nomba account connected successfully');

    return {
      message: 'Nomba account connected successfully',
      data: {
        connected: true,
        // Don't expose raw token to client — just confirm connectivity
        tokenPreview: `${accessToken.substring(0, 8)}...`,
      },
    };
  }

  // ─── Fee Structure ─────────────────────────────────────────────────────────

  async createFees(dto: CreateFeeDto) {
    // Ensure the estate exists
    const estate = await this.prisma.estate.findFirst({
      where: { id: dto.estateId, deletedAt: null },
    });

    if (!estate) {
      throw new NotFoundException(`Estate with ID "${dto.estateId}" not found`);
    }

    const created = await this.prisma.fee.createMany({
      data: dto.fees.map((fee) => ({
        estateId: dto.estateId,
        name: fee.name,
        type: fee.type as FeeType,
        amountKobo: nairaToKobo(fee.amount),
        frequency: fee.frequency as FeeFrequency,
      })),
    });

    this.logger.log(`${created.count} fee(s) created for estate ${dto.estateId}`);

    // Return full fee records
    const fees = await this.prisma.fee.findMany({
      where: { estateId: dto.estateId, deletedAt: null },
      orderBy: { createdAt: 'asc' },
    });

    return {
      message: `${created.count} fee(s) created successfully`,
      data: fees,
    };
  }

  // ─── Units + Virtual Accounts ─────────────────────────────────────────────

  async createUnits(
    dto: CreateUnitDto,
    csvBuffer?: Buffer,
  ) {
    // Ensure estate exists
    const estate = await this.prisma.estate.findFirst({
      where: { id: dto.estateId, deletedAt: null },
    });

    if (!estate) {
      throw new NotFoundException(`Estate with ID "${dto.estateId}" not found`);
    }

    let unitItems: UnitItemDto[] = [];

    // ── Option A: CSV upload ────────────────────────────────────────────────
    if (csvBuffer && csvBuffer.length > 0) {
      unitItems = this.parseCsvToUnits(csvBuffer);
    }
    // ── Option B: JSON array ────────────────────────────────────────────────
    else if (dto.units && dto.units.length > 0) {
      unitItems = dto.units;
    } else {
      throw new BadRequestException(
        'Provide either a CSV file or a "units" array in the request body',
      );
    }

    this.logger.log(
      `Processing ${unitItems.length} unit(s) for estate ${dto.estateId}`,
    );

    // ── Create units + virtual accounts concurrently ───────────────────────
    const results = await Promise.allSettled(
      unitItems.map((item) =>
        this.createSingleUnitWithAccount(dto.estateId, item),
      ),
    );

    const succeeded: any[] = [];
    const failed: { unit: string; reason: string }[] = [];

    results.forEach((result, index) => {
      if (result.status === 'fulfilled') {
        succeeded.push(result.value);
      } else {
        failed.push({
          unit: `${unitItems[index].block}-${unitItems[index].unitName}`,
          reason: result.reason?.message ?? 'Unknown error',
        });
      }
    });

    this.logger.log(
      `Unit onboarding complete: ${succeeded.length} succeeded, ${failed.length} failed`,
    );

    return {
      message: `Onboarding complete: ${succeeded.length} unit(s) created, ${failed.length} failed`,
      data: {
        succeeded,
        failed,
        summary: {
          total: unitItems.length,
          successCount: succeeded.length,
          failCount: failed.length,
        },
      },
    };
  }

  // ─── Helpers ───────────────────────────────────────────────────────────────

  private async createSingleUnitWithAccount(
    estateId: string,
    item: UnitItemDto,
  ) {
    // 1. Save unit to DB
    const unit = await this.prisma.unit.create({
      data: {
        estateId,
        block: item.block,
        unitName: item.unitName,
        occupant: item.occupant,
        email: item.email,
        type: item.type as any,
      },
    });

    // 2. Create permanent virtual account on Nomba
    const accountRef = randomUUID();
    const accountName = `Unit-${item.unitName}`;

    const nombaAccount = await this.nombaService.createVirtualAccount({
      accountRef,
      accountName,
    });

    // 3. Save account to DB
    const account = await this.prisma.account.create({
      data: {
        unitId: unit.id,
        accountNumber: nombaAccount.accountNumber,
        accountName: nombaAccount.accountName,
        bankName: nombaAccount.bankName,
        accountRef,
      },
    });

    // 4. Mint a tokenised resident statement link for the unit.
    await this.prisma.residentLink.create({
      data: { unitId: unit.id, token: randomBytes(16).toString('hex') },
    });

    this.logger.log(
      `Unit ${accountName} → Account ${nombaAccount.accountNumber} created`,
    );

    return { unit, account };
  }

  private parseCsvToUnits(buffer: Buffer): UnitItemDto[] {
    try {
      const records = parse(buffer.toString('utf-8'), {
        columns: true,
        skip_empty_lines: true,
        trim: true,
      }) as Record<string, string>[];

      return records.map((row, idx) => {
        const block = row['block'] || row['Block'];
        const unitName = row['unit_label'] || row['unitName'] || row['Unit Label'];
        const occupant = row['occupant_name'] || row['occupant'] || row['Occupant Name'];
        const email = row['email'] || row['Email'];
        const typeRaw = (row['type'] || row['owner_or_tenant'] || row['Owner or Tenant'] || 'tenant').toLowerCase();

        if (!block || !unitName || !occupant || !email) {
          throw new BadRequestException(
            `CSV row ${idx + 2} is missing required fields (block, unit label, occupant name, email)`,
          );
        }

        const type: OccupantType =
          typeRaw === 'owner' ? OccupantType.OWNER : OccupantType.TENANT;

        return { block, unitName, occupant, email, type };
      });
    } catch (err: any) {
      if (err instanceof BadRequestException) throw err;
      throw new BadRequestException(
        `Failed to parse CSV: ${err.message}. Expected columns: block, unit_label, occupant_name, email, owner_or_tenant`,
      );
    }
  }
}
