import Fastify from "fastify";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import bcrypt from "bcryptjs";
import { Server } from "socket.io";
import { applyAction, createGame, score, viewFor, type GameAction } from "@hanabi/game-engine";
import { authSchema, cardActionSchema, clueSchema, createRoomSchema, roomCodeSchema } from "@hanabi/protocol";
import { authFromRequest, signToken, verifyToken, type TokenPayload } from "./auth.js";
import { JsonStore, type StoredRoom } from "./store.js";

const port = Number(process.env.PORT ?? 3001);
const origin = process.env.WEB_ORIGIN ?? "http://localhost:5173";
const secret = process.env.JWT_SECRET ?? "development-only-change-me";
const store = new JsonStore(process.env.DATA_FILE ?? "./data/hanabi.json");
await store.init();

const app = Fastify({ logger: true, bodyLimit: 64 * 1024 });
await app.register(cors, { origin, credentials: true });
await app.register(helmet, { contentSecurityPolicy: false });

function requireUser(request: Parameters<typeof authFromRequest>[0]) { return authFromRequest(request, secret); }
function newCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  do {
    let code = ""; for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
    if (!store.room(code)) return code;
  } while (true);
}
function publicRoom(room: StoredRoom) {
  return { id: room.id, code: room.code, name: room.name, hostId: room.hostId, status: room.status, players: room.playerIds.map((id) => { const u = store.user(id); return { id, username: u?.username ?? "未知玩家" }; }), gameId: room.game?.id };
}
function stats(userId: string) {
  const history = store.user(userId)?.history ?? [];
  const totalScore = history.reduce((n, g) => n + g.score, 0);
  return { gamesPlayed: history.length, totalScore, bestScore: Math.max(0, ...history.map((g) => g.score)), totalPlaySeconds: history.reduce((n, g) => n + g.durationSeconds, 0), averageScore: history.length ? Math.round(totalScore / history.length * 10) / 10 : 0 };
}

app.get("/api/health/live", async () => ({ ok: true }));
app.get("/api/health/ready", async () => ({ ok: true, storage: "ready" }));
app.post("/api/auth/register", async (request, reply) => {
  const parsed = authSchema.safeParse(request.body);
  if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues[0]?.message });
  if (store.userByName(parsed.data.username)) return reply.code(409).send({ error: "用户名已存在" });
  const user = { id: crypto.randomUUID(), username: parsed.data.username, passwordHash: await bcrypt.hash(parsed.data.password, 11), createdAt: new Date().toISOString(), history: [] };
  await store.mutate((db) => db.users.push(user));
  return { token: signToken({ userId: user.id, username: user.username }, secret), user: { id: user.id, username: user.username } };
});
app.post("/api/auth/login", async (request, reply) => {
  const parsed = authSchema.safeParse(request.body);
  if (!parsed.success) return reply.code(400).send({ error: "用户名或密码格式不正确" });
  const user = store.userByName(parsed.data.username);
  if (!user || !(await bcrypt.compare(parsed.data.password, user.passwordHash))) return reply.code(401).send({ error: "用户名或密码错误" });
  return { token: signToken({ userId: user.id, username: user.username }, secret), user: { id: user.id, username: user.username }, activeRoomCode: user.activeRoomCode };
});
app.get("/api/me", async (request, reply) => {
  try {
    const auth = requireUser(request); const user = store.user(auth.userId);
    if (!user) return reply.code(401).send({ error: "用户不存在" });
    return { user: { id: user.id, username: user.username }, stats: stats(user.id), history: user.history.slice().reverse(), activeRoomCode: user.activeRoomCode };
  } catch { return reply.code(401).send({ error: "登录已过期" }); }
});
app.post("/api/rooms", async (request, reply) => {
  try {
    const auth = requireUser(request); const parsed = createRoomSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "房间名不正确" });
    const room: StoredRoom = { id: crypto.randomUUID(), code: newCode(), name: parsed.data.name, hostId: auth.userId, playerIds: [auth.userId], status: "lobby", createdAt: new Date().toISOString() };
    await store.mutate((db) => { db.rooms.push(room); const u = db.users.find((x) => x.id === auth.userId); if (u) u.activeRoomCode = room.code; });
    return publicRoom(room);
  } catch { return reply.code(401).send({ error: "请先登录" }); }
});
app.post("/api/rooms/:code/join", async (request, reply) => {
  try {
    const auth = requireUser(request); const parsed = roomCodeSchema.safeParse((request.params as {code: string}).code);
    if (!parsed.success) return reply.code(404).send({ error: "房间码无效" });
    const room = store.room(parsed.data); if (!room) return reply.code(404).send({ error: "房间不存在" });
    if (!room.playerIds.includes(auth.userId)) {
      if (room.status !== "lobby") return reply.code(409).send({ error: "游戏已经开始" });
      if (room.playerIds.length >= 5) return reply.code(409).send({ error: "房间已满" });
      await store.mutate((db) => { room.playerIds.push(auth.userId); const u = db.users.find((x) => x.id === auth.userId); if (u) u.activeRoomCode = room.code; });
    }
    return publicRoom(room);
  } catch { return reply.code(401).send({ error: "请先登录" }); }
});
app.get("/api/rooms/:code", async (request, reply) => {
  try { requireUser(request); const room = store.room((request.params as {code: string}).code); return room ? publicRoom(room) : reply.code(404).send({ error: "房间不存在" }); }
  catch { return reply.code(401).send({ error: "请先登录" }); }
});

const io = new Server(app.server, { cors: { origin, credentials: true }, transports: ["websocket", "polling"] });
io.use((socket, next) => {
  try { socket.data.auth = verifyToken(String(socket.handshake.auth.token ?? ""), secret); next(); }
  catch { next(new Error("unauthorized")); }
});

function emitRoom(room: StoredRoom) {
  io.to(`room:${room.code}`).emit("room:view", publicRoom(room));
  if (room.game) for (const playerId of room.playerIds) io.to(`user:${playerId}`).emit("game:view", viewFor(room.game, playerId));
}
async function finishGame(room: StoredRoom) {
  const endedAt = room.game?.endedAt;
  if (!room.game || !endedAt || room.status === "finished") return;
  room.status = "finished";
  const game = room.game; const durationSeconds = Math.max(1, Math.floor((Date.parse(endedAt) - Date.parse(game.startedAt)) / 1000));
  const players = game.players.map((p) => p.username);
  await store.mutate((db) => {
    for (const player of game.players) {
      const user = db.users.find((u) => u.id === player.id); if (!user) continue;
      user.history.push({ id: game.id, roomName: room.name, score: score(game), outcome: game.outcome!, startedAt: game.startedAt, endedAt: game.endedAt!, durationSeconds, players });
      delete user.activeRoomCode;
    }
  });
}

io.on("connection", (socket) => {
  const auth = socket.data.auth as TokenPayload;
  socket.join(`user:${auth.userId}`);
  socket.on("room:join", async ({ code }: { code: string }, ack?: (v: unknown) => void) => {
    const room = store.room(code); if (!room || !room.playerIds.includes(auth.userId)) return ack?.({ ok: false, error: "你不在这个房间" });
    socket.join(`room:${room.code}`);
    if (room.game) { const p = room.game.players.find((x) => x.id === auth.userId); if (p) p.connected = true; await store.save(); }
    emitRoom(room); ack?.({ ok: true });
  });
  socket.on("room:start", async ({ code }: { code: string }, ack?: (v: unknown) => void) => {
    const room = store.room(code); if (!room) return ack?.({ ok: false, error: "房间不存在" });
    if (room.hostId !== auth.userId) return ack?.({ ok: false, error: "只有房主可以开始" });
    if (room.playerIds.length < 2) return ack?.({ ok: false, error: "至少需要两名玩家" });
    room.game = createGame(room.id, room.playerIds.map((id) => { const u = store.user(id)!; return { id, username: u.username }; })); room.status = "playing";
    await store.save(); emitRoom(room); ack?.({ ok: true });
  });
  const act = async (code: string, action: GameAction, expectedVersion: number, ack?: (v: unknown) => void) => {
    const room = store.room(code); if (!room?.game) return ack?.({ ok: false, error: "游戏不存在" });
    if (room.game.version !== expectedVersion) { emitRoom(room); return ack?.({ ok: false, error: "状态已更新，请重试" }); }
    try {
      const actedCard = action.type === "play" || action.type === "discard" ? room.game.players.find((player) => player.id === auth.userId)?.hand.find((card) => card.id === action.cardId) : undefined;
      const playSucceeded = action.type === "play" && actedCard ? actedCard.rank === room.game.fireworks[actedCard.color] + 1 : false;
      room.game = applyAction(room.game, auth.userId, action); await store.save(); await finishGame(room); emitRoom(room);
      if (actedCard) io.to(`room:${room.code}`).emit("game:event", { id: crypto.randomUUID(), type: action.type, playerId: auth.userId, card: actedCard, success: action.type === "play" ? playSucceeded : undefined });
      ack?.({ ok: true });
    }
    catch (error) { ack?.({ ok: false, error: error instanceof Error ? error.message : "操作失败" }); }
  };
  socket.on("game:clue", ({ code, expectedVersion, ...raw }, ack) => { const p = clueSchema.safeParse(raw); if (!p.success) return ack?.({ ok: false, error: "提示无效" }); void act(code, { type: "clue", ...p.data } as GameAction, expectedVersion, ack); });
  socket.on("game:play", ({ code, expectedVersion, ...raw }, ack) => { const p = cardActionSchema.safeParse(raw); if (!p.success) return ack?.({ ok: false, error: "牌无效" }); void act(code, { type: "play", cardId: p.data.cardId }, expectedVersion, ack); });
  socket.on("game:discard", ({ code, expectedVersion, ...raw }, ack) => { const p = cardActionSchema.safeParse(raw); if (!p.success) return ack?.({ ok: false, error: "牌无效" }); void act(code, { type: "discard", cardId: p.data.cardId }, expectedVersion, ack); });
  socket.on("chat:send", ({ code, message }, ack) => {
    const room = store.room(code); const clean = String(message ?? "").trim().slice(0, 300);
    if (!room?.playerIds.includes(auth.userId) || !clean) return ack?.({ ok: false, error: "消息无效" });
    io.to(`room:${code}`).emit("chat:message", { id: crypto.randomUUID(), userId: auth.userId, username: auth.username, message: clean, at: new Date().toISOString() }); ack?.({ ok: true });
  });
  socket.on("disconnect", async () => {
    for (const room of store.rooms()) if (room.game) { const p = room.game.players.find((x) => x.id === auth.userId); if (p) { p.connected = false; emitRoom(room); } }
    await store.save();
  });
});

await app.listen({ port, host: "0.0.0.0" });
