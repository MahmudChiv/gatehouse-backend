import {
  BadRequestException,
  Controller,
  MessageEvent,
  Query,
  Sse,
  UnauthorizedException,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtService } from '@nestjs/jwt';
import { concat, interval, map, merge, of, Observable } from 'rxjs';
import { RealtimeService } from './realtime.service';

// SSE lives here because EventSource can't send Authorization headers — the JWT
// and estateId are passed as query params instead.
@ApiTags('Realtime')
@Controller()
export class RealtimeController {
  constructor(
    private readonly realtime: RealtimeService,
    private readonly jwt: JwtService,
  ) {}

  @Sse('stream')
  @ApiOperation({ summary: 'SSE stream of estate changes (auth via ?token=&estateId=)' })
  stream(
    @Query('token') token: string,
    @Query('estateId') estateId: string,
  ): Observable<MessageEvent> {
    try {
      this.jwt.verify(token);
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
