import { describe, expect, it } from "vitest";
import { applyAction, COLORS, createDeck, createGame, score, viewFor } from "./index.js";

const users = [{ id: "a", username: "甲" }, { id: "b", username: "乙" }];

describe("Hanabi engine", () => {
  it("creates the standard 50-card distribution", () => {
    const deck = createDeck(() => 0.5);
    expect(deck).toHaveLength(50);
    for (const color of COLORS) {
      expect(deck.filter((c) => c.color === color && c.rank === 1)).toHaveLength(3);
      expect(deck.filter((c) => c.color === color && c.rank === 5)).toHaveLength(1);
    }
  });
  it("deals five cards to two players and hides own faces", () => {
    const game = createGame("r", users, () => 0.5);
    expect(game.players.every((p) => p.hand.length === 5)).toBe(true);
    const view = viewFor(game, "a");
    expect(view.players[0]!.hand[0]).toEqual({ id: game.players[0]!.hand[0]!.id });
    expect(view.players[1]!.hand[0]).toHaveProperty("color");
  });
  it("rejects an empty clue and advances valid clues", () => {
    const game = createGame("r", users, () => 0.5);
    const target = game.players[1]!;
    const color = target.hand[0]!.color;
    const next = applyAction(game, "a", { type: "clue", targetPlayerId: "b", kind: "color", value: color });
    expect(next.clues).toBe(7);
    expect(next.currentPlayerIndex).toBe(1);
  });
  it("scores fireworks", () => {
    const game = createGame("r", users);
    game.fireworks.red = 3; game.fireworks.blue = 2;
    expect(score(game)).toBe(5);
  });
  it("adds a strike for a misplay and draws a replacement", () => {
    const game = createGame("r", users, () => 0.5);
    const card = game.players[0]!.hand[0]!;
    card.rank = 3;
    const deckBefore = game.deck.length;
    const next = applyAction(game, "a", { type: "play", cardId: card.id });
    expect(next.strikes).toBe(1);
    expect(next.discard.at(-1)?.id).toBe(card.id);
    expect(next.deck.length).toBe(deckBefore - 1);
    expect(next.players[0]!.hand).toHaveLength(5);
  });
  it("returns one clue for a successful five without exceeding eight", () => {
    const game = createGame("r", users, () => 0.5);
    const card = game.players[0]!.hand[0]!;
    card.rank = 5; game.fireworks[card.color] = 4; game.clues = 7;
    const next = applyAction(game, "a", { type: "play", cardId: card.id });
    expect(next.clues).toBe(8);
    expect(next.fireworks[card.color]).toBe(5);
  });
  it("gives a full final round after the last card is drawn", () => {
    const game = createGame("r", users, () => 0.5);
    game.deck = [{ id: "last", color: "white", rank: 1 }];
    game.clues = 7;
    const firstCard = game.players[0]!.hand[0]!;
    const afterDraw = applyAction(game, "a", { type: "discard", cardId: firstCard.id });
    expect(afterDraw.status).toBe("final-round");
    expect(afterDraw.finalTurnsRemaining).toBe(2);
    const targetColor = afterDraw.players[0]!.hand[0]!.color;
    const afterOne = applyAction(afterDraw, "b", { type: "clue", targetPlayerId: "a", kind: "color", value: targetColor });
    expect(afterOne.finalTurnsRemaining).toBe(1);
    const finalTargetColor = afterOne.players[1]!.hand[0]!.color;
    const finished = applyAction(afterOne, "a", { type: "clue", targetPlayerId: "b", kind: "color", value: finalTargetColor });
    expect(finished.status).toBe("finished");
    expect(finished.outcome).toBe("completed");
  });
  it("rejects discarding while clue tokens are full", () => {
    const game = createGame("r", users);
    expect(() => applyAction(game, "a", { type: "discard", cardId: game.players[0]!.hand[0]!.id })).toThrow("提示标记已满");
  });
});
