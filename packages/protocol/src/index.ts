import { z } from "zod";

export const usernameSchema = z.string().trim().min(2).max(20).regex(/^[\p{L}\p{N}_-]+$/u, "仅支持字母、数字、下划线和短横线");
export const passwordSchema = z.string().min(6).max(72);
export const authSchema = z.object({ username: usernameSchema, password: passwordSchema });
export const roomCodeSchema = z.string().trim().toUpperCase().regex(/^[A-Z2-9]{6}$/);
export const createRoomSchema = z.object({ name: z.string().trim().min(1).max(30).default("花火之夜") });
export const clueSchema = z.object({ targetPlayerId: z.string(), kind: z.enum(["color", "rank"]), value: z.union([z.enum(["red", "yellow", "green", "blue", "white"]), z.number().int().min(1).max(5)]) });
export const cardActionSchema = z.object({ cardId: z.string() });

export type AuthInput = z.infer<typeof authSchema>;
export interface UserPublic { id: string; username: string }
export interface UserStats { gamesPlayed: number; totalScore: number; bestScore: number; totalPlaySeconds: number; averageScore: number }
export interface GameHistoryItem { id: string; roomName: string; score: number; outcome: "perfect" | "completed" | "failed"; startedAt: string; endedAt: string; durationSeconds: number; players: string[] }
