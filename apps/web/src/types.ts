import type { Color, GameStatus, Knowledge, Rank } from "@hanabi/game-engine";
export interface PublicUser { id: string; username: string }
export interface RoomView { id: string; code: string; name: string; hostId: string; status: "lobby" | "playing" | "finished"; players: PublicUser[]; gameId?: string }
export interface VisibleCard { id: string; color?: Color; rank?: Rank }
export interface PlayerView extends PublicUser { hand: VisibleCard[]; connected: boolean; knowledge?: Record<string, Knowledge> }
export interface GameView { id: string; players: PlayerView[]; fireworks: Record<Color, number>; discard: Array<{id:string;color:Color;rank:Rank}>; clues: number; strikes: number; deckCount: number; currentPlayerIndex: number; status: GameStatus; finalTurnsRemaining: number | null; outcome: "perfect" | "completed" | "failed" | null; version: number; startedAt: string; endedAt?: string; log: Array<{id:string;text:string;at:string;type:string}> }
export interface ChatMessage { id:string; userId:string; username:string; message:string; at:string }
