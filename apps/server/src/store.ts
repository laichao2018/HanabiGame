import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { GameState } from "@hanabi/game-engine";
import type { GameHistoryItem } from "@hanabi/protocol";

export interface StoredUser { id: string; username: string; passwordHash: string; createdAt: string; history: GameHistoryItem[]; activeRoomCode?: string }
export interface StoredRoom { id: string; code: string; name: string; hostId: string; playerIds: string[]; status: "lobby" | "playing" | "finished"; game?: GameState; createdAt: string }
interface Database { users: StoredUser[]; rooms: StoredRoom[] }

export class JsonStore {
  private data: Database = { users: [], rooms: [] };
  private queue = Promise.resolve();
  constructor(private readonly file: string) {}

  async init() {
    await mkdir(dirname(this.file), { recursive: true });
    try { this.data = JSON.parse(await readFile(this.file, "utf8")) as Database; } catch { await this.save(); }
  }
  users() { return this.data.users; }
  rooms() { return this.data.rooms; }
  user(id: string) { return this.data.users.find((u) => u.id === id); }
  userByName(username: string) { return this.data.users.find((u) => u.username.toLocaleLowerCase() === username.toLocaleLowerCase()); }
  room(code: string) { return this.data.rooms.find((r) => r.code === code.toUpperCase()); }
  async mutate(fn: (db: Database) => void) { fn(this.data); await this.save(); }
  async save() {
    this.queue = this.queue.then(async () => {
      const temp = `${this.file}.tmp`;
      await writeFile(temp, JSON.stringify(this.data, null, 2), "utf8");
      await rename(temp, this.file);
    });
    await this.queue;
  }
}
