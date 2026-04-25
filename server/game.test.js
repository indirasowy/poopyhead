const assert = require("assert");
const {
  canPlayRank,
  createRoom,
  getEffectiveTop,
  playCards,
  serializeRoom,
} = require("./game");

function card(rank, id = rank) {
  return {
    id,
    rank,
    suit: "S",
    value: { J: 11, Q: 12, K: 13, A: 14 }[rank] || Number(rank),
    label: `${rank}S`,
  };
}

function makePlayingRoom() {
  const room = createRoom("TEST");
  room.status = "playing";
  room.handSize = 5;
  room.firstMoveDone = true;
  room.players = [
    {
      id: "p1",
      name: "One",
      connected: true,
      hand: [],
      faceUp: [],
      blind: [],
      table: [],
      prepared: true,
      out: false,
    },
    {
      id: "p2",
      name: "Two",
      connected: true,
      hand: [card("9", "p2-9")],
      faceUp: [],
      blind: [],
      table: [],
      prepared: true,
      out: false,
    },
  ];
  room.currentPlayerId = "p1";
  return room;
}

{
  const room = createRoom("OPEN");
  room.status = "playing";
  room.firstMoveDone = false;
  assert.equal(canPlayRank(room, "4"), true);
  assert.equal(canPlayRank(room, "2"), false);
  assert.equal(canPlayRank(room, "A"), false);
}

{
  const room = makePlayingRoom();
  room.discard = [card("A", "a"), card("3", "three")];
  assert.equal(getEffectiveTop(room).rank, "A");
  assert.equal(canPlayRank(room, "K"), false);
  assert.equal(canPlayRank(room, "A"), true);
  assert.equal(canPlayRank(room, "2"), true);
}

{
  const room = makePlayingRoom();
  room.discard = [card("9", "nine"), card("2", "two"), card("3", "three")];
  assert.equal(getEffectiveTop(room), null);
  assert.equal(canPlayRank(room, "4"), true);
}

{
  const room = makePlayingRoom();
  room.discard = [card("7", "seven")];
  assert.equal(canPlayRank(room, "6"), true);
  assert.equal(canPlayRank(room, "7"), true);
  assert.equal(canPlayRank(room, "8"), false);
}

{
  const room = makePlayingRoom();
  room.discard = [card("Q", "q1"), card("Q", "q2"), card("Q", "q3")];
  room.players[0].hand = [card("Q", "q4")];
  room.players[0].table = [{ faceUp: null, blind: card("4", "blind") }];
  playCards(room, "p1", "hand", ["q4"]);
  assert.equal(room.discard.length, 0);
  assert.equal(room.currentPlayerId, "p1");
}

{
  const room = makePlayingRoom();
  room.discard = [card("4", "pile-4")];
  room.players[0].table = [
    { faceUp: card("K", "top-k"), blind: card("5", "under-k") },
    { faceUp: card("6", "top-6"), blind: card("7", "under-6") },
    { faceUp: card("8", "top-8"), blind: card("9", "under-8") },
  ];
  playCards(room, "p1", "faceUp", ["top-k"]);
  room.currentPlayerId = "p1";
  const view = serializeRoom(room, "p1");
  assert.equal(view.players[0].table[0].unlocked, true);
  assert.deepEqual(view.legal.zones, ["faceUp", "blind"]);
  assert.ok(view.legal.playableBlindIds.includes("under-k"));
  assert.equal(view.legal.playableBlindIds.includes("under-6"), false);
}

{
  const room = makePlayingRoom();
  room.discard = [card("A", "a")];
  room.players[0].hand = [];
  room.players[0].table = [
    { faceUp: card("K", "k"), blind: null },
    { faceUp: card("5", "five"), blind: null },
    { faceUp: card("8", "eight"), blind: null },
  ];
  const view = serializeRoom(room, "p1");
  assert.equal(view.legal.canPickUp, true);
  assert.equal(view.legal.needsFaceUpPickupChoice, true);
}

console.log("game tests passed");
