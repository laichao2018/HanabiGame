export const COLORS = ["red", "yellow", "green", "blue", "white"] as const;
export type Color = (typeof COLORS)[number];
export type Rank = 1 | 2 | 3 | 4 | 5;
export interface Card { id: string; color: Color; rank: Rank }
export interface Knowledge { colors: Color[]; ranks: Rank[] }
export interface PlayerState { id: string; username: string; hand: Card[]; knowledge: Record<string, Knowledge>; connected: boolean }
export type GameStatus = "playing" | "final-round" | "finished";
export interface GameState {
  id: string;
  roomId: string;
  players: PlayerState[];
  deck: Card[];
  fireworks: Record<Color, number>;
  discard: Card[];
  clues: number;
  strikes: number;
  currentPlayerIndex: number;
  status: GameStatus;
  finalTurnsRemaining: number | null;
  outcome: "perfect" | "completed" | "failed" | null;
  version: number;
  startedAt: string;
  endedAt?: string;
  log: GameLogEntry[];
}
export interface GameLogEntry { id: string; at: string; text: string; playerId?: string; type: "system" | "clue" | "play" | "discard" }
export type GameAction =
  | { type: "clue"; targetPlayerId: string; kind: "color" | "rank"; value: Color | Rank }
  | { type: "play"; cardId: string }
  | { type: "discard"; cardId: string };

function id(prefix: string): string { return `${prefix}_${crypto.randomUUID()}`; }

export function createDeck(random: () => number = Math.random): Card[] {
  const cards: Card[] = [];
  const copies: Record<Rank, number> = { 1: 3, 2: 2, 3: 2, 4: 2, 5: 1 };
  for (const color of COLORS) for (const rank of [1, 2, 3, 4, 5] as Rank[]) {
    for (let n = 0; n < copies[rank]; n++) cards.push({ id: id("card"), color, rank });
  }
  for (let i = cards.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [cards[i], cards[j]] = [cards[j]!, cards[i]!];
  }
  return cards;
}

export function createGame(roomId: string, users: Array<{id: string; username: string}>, random: () => number = Math.random): GameState {
  if (users.length < 2 || users.length > 5) throw new Error("游戏需要 2–5 名玩家");
  const deck = createDeck(random);
  const handSize = users.length <= 3 ? 5 : 4;
  const players = users.map((user) => {
    const hand = deck.splice(0, handSize);
    return { ...user, hand, connected: true, knowledge: Object.fromEntries(hand.map((c) => [c.id, { colors: [], ranks: [] }])) };
  });
  return { id: id("game"), roomId, players, deck, fireworks: { red: 0, yellow: 0, green: 0, blue: 0, white: 0 }, discard: [], clues: 8, strikes: 0, currentPlayerIndex: 0, status: "playing", finalTurnsRemaining: null, outcome: null, version: 1, startedAt: new Date().toISOString(), log: [{ id: id("log"), at: new Date().toISOString(), text: "烟花表演开始了", type: "system" }] };
}

function draw(state: GameState, player: PlayerState): void {
  const card = state.deck.shift();
  if (card) {
    player.hand.push(card);
    player.knowledge[card.id] = { colors: [], ranks: [] };
    if (state.deck.length === 0 && state.finalTurnsRemaining === null) {
      state.status = "final-round";
      state.finalTurnsRemaining = state.players.length;
      state.log.push({ id: id("log"), at: new Date().toISOString(), text: "牌库已空，进入最后一轮", type: "system" });
    }
  }
}

function finish(state: GameState, outcome: GameState["outcome"]): void {
  state.status = "finished"; state.outcome = outcome; state.endedAt = new Date().toISOString();
}

export function score(state: GameState): number { return COLORS.reduce((sum, c) => sum + state.fireworks[c], 0); }

export function applyAction(source: GameState, actorId: string, action: GameAction): GameState {
  const state = structuredClone(source);
  if (state.status === "finished") throw new Error("游戏已经结束");
  const wasFinalRound = state.finalTurnsRemaining !== null;
  const actor = state.players[state.currentPlayerIndex];
  if (!actor || actor.id !== actorId) throw new Error("还没轮到你");
  const at = new Date().toISOString();
  if (action.type === "clue") {
    if (state.clues <= 0) throw new Error("没有可用的提示标记");
    if (action.targetPlayerId === actorId) throw new Error("不能提示自己");
    const target = state.players.find((p) => p.id === action.targetPlayerId);
    if (!target) throw new Error("目标玩家不存在");
    const matches = target.hand.filter((c) => action.kind === "color" ? c.color === action.value : c.rank === action.value);
    if (!matches.length) throw new Error("提示必须至少命中一张牌");
    for (const card of matches) {
      const known = target.knowledge[card.id]!;
      if (action.kind === "color" && !known.colors.includes(action.value as Color)) known.colors.push(action.value as Color);
      if (action.kind === "rank" && !known.ranks.includes(action.value as Rank)) known.ranks.push(action.value as Rank);
    }
    state.clues--;
    state.log.push({ id: id("log"), at, playerId: actorId, type: "clue", text: `${actor.username} 提示 ${target.username}：${action.kind === "color" ? colorName(action.value as Color) : action.value}` });
  } else {
    const index = actor.hand.findIndex((c) => c.id === action.cardId);
    if (index < 0) throw new Error("这张牌不在你的手中");
    const [card] = actor.hand.splice(index, 1) as [Card];
    delete actor.knowledge[card.id];
    if (action.type === "discard") {
      if (state.clues >= 8) throw new Error("提示标记已满，不能弃牌");
      state.discard.push(card); state.clues++;
      state.log.push({ id: id("log"), at, playerId: actorId, type: "discard", text: `${actor.username} 弃掉了 ${colorName(card.color)} ${card.rank}` });
    } else {
      const expected = state.fireworks[card.color] + 1;
      if (card.rank === expected) {
        state.fireworks[card.color] = card.rank;
        if (card.rank === 5) state.clues = Math.min(8, state.clues + 1);
        state.log.push({ id: id("log"), at, playerId: actorId, type: "play", text: `${actor.username} 成功打出 ${colorName(card.color)} ${card.rank}` });
      } else {
        state.discard.push(card); state.strikes++;
        state.log.push({ id: id("log"), at, playerId: actorId, type: "play", text: `${actor.username} 误打 ${colorName(card.color)} ${card.rank}` });
      }
    }
    if (state.strikes >= 3) finish(state, "failed");
    else if (score(state) === 25) finish(state, "perfect");
    else draw(state, actor);
  }
  if ((state.status as GameStatus) !== "finished") {
    if (wasFinalRound && state.finalTurnsRemaining !== null) {
      state.finalTurnsRemaining--;
      if (state.finalTurnsRemaining <= 0) finish(state, "completed");
    }
    if ((state.status as GameStatus) !== "finished") state.currentPlayerIndex = (state.currentPlayerIndex + 1) % state.players.length;
  }
  state.version++;
  return state;
}

export function colorName(color: Color): string { return ({ red: "红色", yellow: "黄色", green: "绿色", blue: "蓝色", white: "白色" })[color]; }

export function viewFor(state: GameState, viewerId: string) {
  return {
    ...state,
    deck: undefined,
    deckCount: state.deck.length,
    players: state.players.map((p) => ({
      ...p,
      hand: p.hand.map((c) => p.id === viewerId ? { id: c.id } : c),
      knowledge: p.id === viewerId ? p.knowledge : undefined
    }))
  };
}
