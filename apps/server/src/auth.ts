import jwt from "jsonwebtoken";
import type { FastifyRequest } from "fastify";

export interface TokenPayload { userId: string; username: string }
export function signToken(payload: TokenPayload, secret: string) { return jwt.sign(payload, secret, { expiresIn: "30d" }); }
export function verifyToken(token: string, secret: string) { return jwt.verify(token, secret) as TokenPayload; }
export function authFromRequest(request: FastifyRequest, secret: string) {
  const raw = request.headers.authorization;
  if (!raw?.startsWith("Bearer ")) throw new Error("请先登录");
  return verifyToken(raw.slice(7), secret);
}
