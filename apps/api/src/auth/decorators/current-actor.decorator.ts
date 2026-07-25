import { createParamDecorator, ExecutionContext } from "@nestjs/common";
import { Request } from "express";
import { RequestActor } from "../types";

export const CurrentActor = createParamDecorator((_: unknown, ctx: ExecutionContext): RequestActor => {
  const request = ctx.switchToHttp().getRequest<Request>();
  if (!request.actor) {
    throw new Error("CurrentActor used on a route without JwtAuthGuard.");
  }
  return request.actor;
});
