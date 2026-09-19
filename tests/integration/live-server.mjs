import { io } from "socket.io-client";
import assert from "node:assert/strict";

const base = process.env.TEST_SERVER_URL ?? "http://localhost:3101";
const suffix = Date.now().toString().slice(-7);
async function request(path, options = {}) {
  const response = await fetch(`${base}${path}`, {
    ...options,
    headers: { ...(options.body !== undefined ? { "content-type": "application/json" } : {}), ...options.headers }
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error);
  return data;
}
const register = (username) => request("/api/auth/register", { method: "POST", body: JSON.stringify({ username, password: "test-pass-123" }) });
const a = await register(`playerA_${suffix}`);
const b = await register(`playerB_${suffix}`);
const room = await request("/api/rooms", { method: "POST", headers: { authorization: `Bearer ${a.token}` }, body: JSON.stringify({ name: "联机验收" }) });
await request(`/api/rooms/${room.code}/join`, { method: "POST", headers: { authorization: `Bearer ${b.token}` } });

const socketA = io(base, { auth: { token: a.token }, transports: ["websocket"] });
const socketB = io(base, { auth: { token: b.token }, transports: ["websocket"] });
const waitFor = (socket, event) => new Promise((resolve, reject) => { const timer = setTimeout(() => reject(new Error(`${event} timeout`)), 5000); socket.once(event, (data) => { clearTimeout(timer); resolve(data); }); });
await Promise.all([waitFor(socketA, "connect"), waitFor(socketB, "connect")]);
socketA.emit("room:join", { code: room.code }); socketB.emit("room:join", { code: room.code });
const viewAPromise = waitFor(socketA, "game:view");
const viewBPromise = waitFor(socketB, "game:view");
socketA.emit("room:start", { code: room.code });
const [viewA, viewB] = await Promise.all([viewAPromise, viewBPromise]);
const ownA = viewA.players.find((p) => p.id === a.user.id);
const ownB = viewB.players.find((p) => p.id === b.user.id);
const otherForA = viewA.players.find((p) => p.id === b.user.id);
assert.equal(ownA.hand.length, 5);
assert.equal(ownB.hand.length, 5);
assert.equal(ownA.hand[0].color, undefined, "玩家不应看到自己的牌面");
assert.equal(ownB.hand[0].rank, undefined, "玩家不应看到自己的牌面");
assert.ok(otherForA.hand[0].color, "玩家应看到队友的牌面");

const login = await request("/api/auth/login", { method: "POST", body: JSON.stringify({ username: a.user.username, password: "test-pass-123" }) });
assert.equal(login.activeRoomCode, room.code, "重新登录后应能恢复活动房间");
socketA.close(); socketB.close();
console.log(`integration ok: room ${room.code}, two player views isolated, relogin resumes`);
