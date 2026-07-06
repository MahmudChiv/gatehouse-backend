import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { memoryStorage } from 'multer';
import { OnboardingService } from './onboarding.service';
import { CreateEstateDto } from './dto/create-estate.dto';
import { CreateFeeDto } from './dto/create-fee.dto';
import { CreateUnitDto } from './dto/create-unit.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentManager } from '../../common/decorators/current-manager.decorator';
import type { CurrentManagerPayload } from '../../common/decorators/current-manager.decorator';

@ApiTags('Onboarding')
@ApiBearerAuth('JWT-auth')
@UseGuards(JwtAuthGuard)
@Controller('onboarding')
export class OnboardingController {
  constructor(private readonly onboardingService: OnboardingService) {}

  // ─── Onboarding progress (resume after refresh) ────────────────────────────

  @Get('state')
  @ApiOperation({
    summary: 'Onboarding progress — resume step + existing estate after a refresh',
  })
  @ApiResponse({ status: 200, description: 'Current onboarding state' })
  async getState(@CurrentManager() manager: CurrentManagerPayload) {
    return this.onboardingService.getState(manager.managerId);
  }

  // ─── Step 1: Create Estate ─────────────────────────────────────────────────

  @Post('estate')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Step 1 — Create the estate profile' })
  @ApiResponse({ status: 201, description: 'Estate created successfully' })
  @ApiResponse({ status: 400, description: 'Duplicate estate name or validation error' })
  async createEstate(
    @CurrentManager() manager: CurrentManagerPayload,
    @Body() dto: CreateEstateDto,
  ) {
    return this.onboardingService.createEstate(manager.managerId, dto);
  }

  // ─── Step 2: Connect Nomba Account ─────────────────────────────────────────

  @Post('connect-nomba-account')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Step 2 — Connect Nomba account (fetches & caches API token)',
  })
  @ApiResponse({ status: 200, description: 'Nomba account connected successfully' })
  @ApiResponse({ status: 502, description: 'Failed to connect to Nomba API' })
  async connectNombaAccount() {
    return this.onboardingService.connectNombaAccount();
  }

  // ─── Step 3: Create Fee Structure ──────────────────────────────────────────

  @Post('fee')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Step 3 — Create fee structure (service fee + levies)',
  })
  @ApiResponse({ status: 201, description: 'Fees created successfully' })
  @ApiResponse({ status: 404, description: 'Estate not found' })
  async createFees(@Body() dto: CreateFeeDto) {
    return this.onboardingService.createFees(dto);
  }

  // ─── Step 4: Onboard Units ─────────────────────────────────────────────────

  @Post('unit')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      fileFilter: (_req, file, cb) => {
        if (
          file.mimetype === 'text/csv' ||
          file.originalname.endsWith('.csv')
        ) {
          cb(null, true);
        } else {
          cb(new Error('Only CSV files are accepted'), false);
        }
      },
      limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB max
    }),
  )
  @ApiConsumes('multipart/form-data', 'application/json')
  @ApiBody({
    description:
      'Upload a CSV file OR provide a "units" JSON array. Include "estateId" in both cases. ' +
      'CSV columns: block, unit_label, occupant_name, email, owner',
    type: CreateUnitDto,
  })
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary:
      'Step 4 — Onboard units (CSV upload or JSON array) and generate permanent virtual accounts',
  })
  @ApiResponse({
    status: 201,
    description: 'Units onboarded and virtual accounts created',
  })
  async createUnits(
    @Body() dto: CreateUnitDto,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    return this.onboardingService.createUnits(dto, file?.buffer);
  }
}
