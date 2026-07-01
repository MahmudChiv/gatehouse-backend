import { createParamDecorator, ExecutionContext } from '@nestjs/common';

export interface CurrentManagerPayload {
  managerId: string;
  email: string;
}

export const CurrentManager = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): CurrentManagerPayload => {
    const request = ctx.switchToHttp().getRequest();
    return request.user as CurrentManagerPayload;
  },
);
