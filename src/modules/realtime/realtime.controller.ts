import {
  BadRequestException,
  Controller,
  Get,
  MessageEvent,
  Query,
  Sse,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtService } from '@nestjs/jwt';
import { concat, interval, map, merge, of, Observable } from 'rxjs';
import { RealtimeService } from './realtime.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentManager } from '../../common/decorators/current-manager.decorator';
import type { CurrentManagerPayload } from '../../common/decorators/current-manager.decorator';

// SSE lives here because EventSource can't send Authorization headers. Putting the
// long-lived API JWT in the URL leaks it into logs/history/proxies, so instead the
// client calls GET /stream/ticket (with its normal Bearer token) to mint a
// short-lived, stream-scoped ticket and passes THAT as ?token=. A leaked ticket is
// useless within a minute.
@ApiTags('Realtime')
@Controller()
export class RealtimeController {
  constructor(
    private readonly realtime: RealtimeService,
    private readonly jwt: JwtService,
  ) {}

  @Get('stream/ticket')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Mint a short-lived, stream-scoped ticket for the SSE URL' })
  ticket(@CurrentManager() manager: CurrentManagerPayload) {
    const ticket = this.jwt.sign(
      { sub: manager.managerId, scope: 'stream' },
      { expiresIn: '60s' },
    );
    return { message: 'OK', data: { ticket } };
  }

  @Sse('stream')
  @ApiOperation({ summary: 'SSE stream of estate changes (auth via ?token=&estateId=)' })
  stream(
    @Query('token') token: string,
    @Query('estateId') estateId: string,
  ): Observable<MessageEvent> {
    try {
      const payload = this.jwt.verify<{ scope?: string }>(token);
      // Only accept purpose-minted stream tickets — never the long-lived API token.
      if (payload.scope !== 'stream') throw new Error('not a stream ticket');
    } catch {
      throw new UnauthorizedException('Invalid or missing token');
    }
    if (!estateId) throw new BadRequestException('estateId is required');

    const connected = of({ type: 'connected', at: Date.now() });
    const heartbeat = interval(25_000).pipe(map(() => ({ type: 'ping', at: Date.now() })));
    return concat(connected, merge(this.realtime.stream(estateId), heartbeat)).pipe(
      map((event) => ({ data: JSON.stringify(event) }) as MessageEvent),
    );
  }
}
