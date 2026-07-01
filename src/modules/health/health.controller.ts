import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  HealthCheck,
  HealthCheckService,
  MemoryHealthIndicator,
} from '@nestjs/terminus';

@ApiTags('Health')
@Controller('health')
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly memory: MemoryHealthIndicator,
  ) {}

  @Get()
  @HealthCheck()
  @ApiOperation({ summary: 'Health check — memory & app status' })
  check() {
    return this.health.check([
      // Heap must not exceed 512 MB
      () => this.memory.checkHeap('memory_heap', 512 * 1024 * 1024),
      // RSS must not exceed 768 MB
      () => this.memory.checkRSS('memory_rss', 768 * 1024 * 1024),
    ]);
  }
}
