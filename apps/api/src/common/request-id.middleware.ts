import { Injectable, NestMiddleware } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { NextFunction, Request, Response } from "express";

/** Assigns a request id to every inbound request, used in logs and error responses. */
@Injectable()
export class RequestIdMiddleware implements NestMiddleware {
  use(req: Request & { requestId?: string }, res: Response, next: NextFunction) {
    const incoming = req.headers["x-request-id"];
    req.requestId = typeof incoming === "string" && incoming.length > 0 ? incoming : randomUUID();
    res.setHeader("x-request-id", req.requestId);
    next();
  }
}
