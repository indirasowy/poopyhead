const crypto = require("crypto");

const MIN_PLAYERS = 2;
const MAX_PLAYERS = 10;
const MAX_NAME_LENGTH = 18;
const RANKS = ["2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K", "A"];
const SUITS = ["S", "H", "D", "C"];
const SUIT_SYMBOLS = {
  S: "♠",
  H: "♥",
  D: "♦",
  C: "♣",
};
const HAND_SORT_ORDER = {
  "4": 0,
  "5": 1,
  "6": 2,
  "7": 3,
  "8": 4,
  "9": 5,
  "10": 6,
  J: 7,
  Q: 8,
  K: 9,
  A: 10,
  "2": 11,
  "3": 12,
};
const SUIT_SORT_ORDER = {
  S: 0,
  H: 1,
  D: 2,
  C: 3,
};
const RANK_VALUES = {
  "2": 2,
  "3": 3,
  "4": 4,
  "5": 5,
  "6": 6,
  "7": 7,
  "8": 8,
  "9": 9,
  "10": 10,
  J: 11,
  Q: 12,
  K: 13,
  A: 14,
};

function createRoom(id) {
  return {
    id,
    hostId: null,
    status: "lobby",
    players: [],
    deck: [],
    discard: [],
    log: [],
    handSize: 5,
    deckCount: 1,
    currentPlayerId: null,
    firstMoveDone: false,
    poopyheadId: null,
    preferredStarterId: null,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

function makeRoomId(existingIds = new Set()) {
  let id = "";
  do {
    id = crypto.randomBytes(3).toString("hex").toUpperCase();
  } while (existingIds.has(id));
  return id;
}

function sanitizeName(name) {
  const clean = String(name || "").trim().replace(/\s+/g, " ").slice(0, MAX_NAME_LENGTH);
  return clean || "Player";
}

function touch(room) {
  room.updatedAt = Date.now();
}

function addLog(room, message) {
  room.log.push({ message, at: Date.now() });
  if (room.log.length > 80) {
    room.log.shift();
  }
}

function createPlayer({ playerId, name, socketId }) {
  return {
    id: playerId,
    socketId,
    name: sanitizeName(name),
    connected: true,
    hand: [],
    blind: [],
    faceUp: [],
    table: [],
    prepared: false,
    out: false,
  };
}

function joinRoom(room, { playerId, name, socketId }) {
  if (!playerId) {
    throw new Error("Missing player id.");
  }

  const existing = room.players.find((player) => player.id === playerId);
  if (existing) {
    existing.socketId = socketId;
    existing.connected = true;
    existing.name = sanitizeName(name || existing.name);
    if (!room.hostId) {
      room.hostId = existing.id;
    }
    touch(room);
    addLog(room, `${existing.name} rejoined.`);
    return existing;
  }

  if (room.status !== "lobby") {
    throw new Error("That game already started.");
  }
  if (room.players.length >= MAX_PLAYERS) {
    throw new Error("This lobby is full.");
  }

  const player = createPlayer({ playerId, name, socketId });
  room.players.push(player);
  if (!room.hostId) {
    room.hostId = player.id;
  }
  touch(room);
  addLog(room, `${player.name} joined the lobby.`);
  return player;
}

function disconnectPlayer(room, socketId) {
  const player = room.players.find((candidate) => candidate.socketId === socketId);
  if (!player) {
    return null;
  }

  player.connected = false;
  player.socketId = null;
  if (room.status === "lobby" && room.hostId === player.id) {
    const nextHost = room.players.find((candidate) => candidate.connected && candidate.id !== player.id);
    if (nextHost) {
      room.hostId = nextHost.id;
    }
  }
  touch(room);
  return player;
}

function createDeck(deckCount) {
  const cards = [];
  for (let deck = 1; deck <= deckCount; deck += 1) {
    for (const suit of SUITS) {
      for (const rank of RANKS) {
        cards.push({
          id: `${deck}-${suit}-${rank}-${crypto.randomBytes(4).toString("hex")}`,
          rank,
          suit,
          suitSymbol: SUIT_SYMBOLS[suit],
          suitColor: suit === "H" || suit === "D" ? "red" : "black",
          value: RANK_VALUES[rank],
          label: `${rank}${SUIT_SYMBOLS[suit]}`,
        });
      }
    }
  }
  return shuffle(cards);
}

function shuffle(cards) {
  const copy = [...cards];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const randomIndex = crypto.randomInt(index + 1);
    [copy[index], copy[randomIndex]] = [copy[randomIndex], copy[index]];
  }
  return copy;
}

function drawCards(room, count) {
  return room.deck.splice(Math.max(0, room.deck.length - count), count);
}

function drawToMinimum(room, player) {
  while (room.deck.length > 0 && player.hand.length < room.handSize) {
    const card = room.deck.pop();
    if (card) {
      player.hand.push(card);
    }
  }
  sortPlayerHand(player);
}

function startGame(room, requesterId) {
  if (room.status !== "lobby") {
    throw new Error("The game has already started.");
  }
  if (room.hostId !== requesterId) {
    throw new Error("Only the host can start the game.");
  }

  dealRound(room, null);
}

function resetRound(room, requesterId) {
  if (room.status !== "finished") {
    throw new Error("The round is not finished yet.");
  }
  getPlayer(room, requesterId);
  const previousPoopyheadId = room.poopyheadId;
  dealRound(room, previousPoopyheadId);
}

function dealRound(room, preferredStarterId) {
  room.players = room.players.filter((player) => player.connected);
  if (room.players.length < MIN_PLAYERS) {
    throw new Error("Poopy Head needs at least 2 players.");
  }
  if (room.players.length > MAX_PLAYERS) {
    throw new Error("Poopy Head supports up to 10 players.");
  }

  room.handSize = room.players.length <= 4 ? 5 : 4;
  room.deckCount = room.players.length > 5 ? 2 : 1;
  room.deck = createDeck(room.deckCount);
  room.discard = [];
  room.firstMoveDone = false;
  room.poopyheadId = null;
  room.currentPlayerId = null;
  room.preferredStarterId = room.players.some((player) => player.id === preferredStarterId) ? preferredStarterId : null;

  for (const player of room.players) {
    player.hand = sortCards(drawCards(room, room.handSize));
    player.blind = drawCards(room, 3);
    player.faceUp = [];
    player.table = player.blind.map((blind) => ({ blind, faceUp: null }));
    player.prepared = false;
    player.out = false;
  }

  room.status = "setup";
  touch(room);
  addLog(
    room,
    `The deal is set: ${room.deckCount} deck${room.deckCount > 1 ? "s" : ""}, ${room.handSize} card hands.`
  );
}

function chooseFaceUp(room, playerId, cardIds) {
  if (room.status !== "setup") {
    throw new Error("The table cards are not being chosen right now.");
  }

  const player = getPlayer(room, playerId);
  if (player.prepared) {
    throw new Error("You have already placed your face-up cards.");
  }

  const uniqueIds = [...new Set(cardIds || [])];
  if (uniqueIds.length !== 3) {
    throw new Error("Choose exactly 3 cards for your face-up table cards.");
  }

  const selected = uniqueIds.map((id) => player.hand.find((card) => card.id === id));
  if (selected.some((card) => !card)) {
    throw new Error("One of those cards is not in your hand.");
  }

  player.hand = player.hand.filter((card) => !uniqueIds.includes(card.id));
  sortPlayerHand(player);
  const slots = ensureTableSlots(player);
  for (let index = 0; index < slots.length; index += 1) {
    slots[index].faceUp = selected[index] || null;
  }
  syncTableArrays(player);
  player.prepared = true;
  touch(room);
  addLog(room, `${player.name} placed their face-up cards.`);

  if (room.players.every((candidate) => candidate.prepared)) {
    finishSetup(room);
  }
}

function finishSetup(room) {
  for (const player of room.players) {
    drawToMinimum(room, player);
  }

  ensureStartingFour(room, room.preferredStarterId);
  const preferredStarter = room.players.find((player) => player.id === room.preferredStarterId) || null;
  const starter = preferredStarter || room.players.find((player) => player.hand.some((card) => card.rank === "4")) || room.players[0];
  room.currentPlayerId = starter.id;
  room.status = "playing";
  room.preferredStarterId = null;
  touch(room);
  addLog(room, `${starter.name} starts. The opening play must be a 4.`);
}

function ensureStartingFour(room, preferredStarterId) {
  const preferredStarter = room.players.find((player) => player.id === preferredStarterId);
  if (preferredStarter) {
    if (preferredStarter.hand.some((card) => card.rank === "4")) {
      return;
    }
    moveFourToPlayer(room, preferredStarter);
    return;
  }

  if (room.players.some((player) => player.hand.some((card) => card.rank === "4"))) {
    return;
  }
  const target = room.players[0];
  moveFourToPlayer(room, target);
}

function moveFourToPlayer(room, target) {
  const found = takeFirstFour(room);
  if (!found || target.hand.length === 0) {
    return;
  }

  const swapIndex = target.hand.findIndex((card) => card.rank !== "4");
  const handIndex = swapIndex >= 0 ? swapIndex : 0;
  const swapCard = target.hand[handIndex];
  target.hand[handIndex] = found.card;
  found.replace(swapCard);
  sortPlayerHand(target);
}

function takeFirstFour(room) {
  for (const player of room.players) {
    const handIndex = player.hand.findIndex((card) => card.rank === "4");
    if (handIndex >= 0) {
      return {
        card: player.hand[handIndex],
        replace(replacement) {
          player.hand[handIndex] = replacement;
          sortPlayerHand(player);
        },
      };
    }
  }

  const deckIndex = room.deck.findIndex((card) => card.rank === "4");
  if (deckIndex >= 0) {
    return {
      card: room.deck[deckIndex],
      replace(replacement) {
        room.deck[deckIndex] = replacement;
      },
    };
  }

  for (const player of room.players) {
    const slots = ensureTableSlots(player);
    for (const slot of slots) {
      if (slot.blind && slot.blind.rank === "4") {
        return {
          card: slot.blind,
          replace(replacement) {
            slot.blind = replacement;
            syncTableArrays(player);
          },
        };
      }
      if (slot.faceUp && slot.faceUp.rank === "4") {
        return {
          card: slot.faceUp,
          replace(replacement) {
            slot.faceUp = replacement;
            syncTableArrays(player);
          },
        };
      }
    }
  }

  return null;
}

function playCards(room, playerId, source, cardIds) {
  if (room.status !== "playing") {
    throw new Error("The game is not in play.");
  }
  if (room.currentPlayerId !== playerId) {
    throw new Error("It is not your turn.");
  }

  const player = getPlayer(room, playerId);
  const allowedSources = getAllowedSources(player);
  if (!allowedSources.includes(source)) {
    throw new Error(`You need to play from your ${zoneLabel(getActiveZone(room, player))} now.`);
  }

  if (source === "blind") {
    playBlindCard(room, player, cardIds);
    return;
  }

  if (source === "faceUp") {
    playFaceUpCards(room, player, cardIds);
    return;
  }

  const selected = getSelectedCards(player[source], cardIds);
  if (selected.length === 0) {
    throw new Error("Choose a card to play.");
  }
  const rank = selected[0].rank;
  if (selected.some((card) => card.rank !== rank)) {
    throw new Error("Selected cards must have the same rank.");
  }
  if (!canPlayRank(room, rank)) {
    throw new Error(`${rank} cannot be played on this pile.`);
  }

  player[source] = player[source].filter((card) => !cardIds.includes(card.id));
  room.discard.push(...selected);
  finishSuccessfulPlay(room, player, selected, source);
}

function playFaceUpCards(room, player, cardIds) {
  const faceUpCards = getFaceUpCards(player);
  const selected = getSelectedCards(faceUpCards, cardIds);
  if (selected.length === 0) {
    throw new Error("Choose a face-up card to play.");
  }
  if (selected.length > 1) {
    throw new Error("Play face-up table cards one at a time.");
  }
  const rank = selected[0].rank;
  if (selected.some((card) => card.rank !== rank)) {
    throw new Error("Selected cards must have the same rank.");
  }
  if (!canPlayRank(room, rank)) {
    throw new Error(`${rank} cannot be played on this pile.`);
  }

  const selectedIds = new Set(selected.map((card) => card.id));
  for (const slot of ensureTableSlots(player)) {
    if (slot.faceUp && selectedIds.has(slot.faceUp.id)) {
      slot.faceUp = null;
    }
  }
  syncTableArrays(player);
  room.discard.push(...selected);
  finishSuccessfulPlay(room, player, selected, "faceUp");
}

function playBlindCard(room, player, cardIds) {
  const uniqueIds = [...new Set(cardIds || [])];
  if (uniqueIds.length !== 1) {
    throw new Error("Flip one blind card.");
  }

  const slot = ensureTableSlots(player).find(
    (candidate) => !candidate.faceUp && candidate.blind && candidate.blind.id === uniqueIds[0]
  );
  if (!slot) {
    throw new Error("That blind card is still covered or is not yours.");
  }

  const card = slot.blind;
  slot.blind = null;
  syncTableArrays(player);
  if (!canPlayRank(room, card.rank)) {
    const pickedUp = room.discard.splice(0);
    player.hand.push(...pickedUp, card);
    sortPlayerHand(player);
    addLog(room, `${player.name} flipped ${formatCards([card])} and picked up the pile.`);
    touch(room);
    advanceTurn(room, 0);
    return;
  }

  room.discard.push(card);
  finishSuccessfulPlay(room, player, [card], "blind");
}

function finishSuccessfulPlay(room, player, cards, source) {
  room.firstMoveDone = true;
  addLog(room, `${player.name} played ${formatCards(cards)}${source === "blind" ? " blind" : ""}.`);

  if (source === "hand") {
    drawToMinimum(room, player);
  }

  const burned = getTopRunLength(room.discard) >= 4;
  if (burned) {
    const rank = room.discard[room.discard.length - 1].rank;
    room.discard = [];
    addLog(room, `Four ${rank}s burned the pile.`);
  }

  if (finishIfNeeded(room)) {
    touch(room);
    return;
  }

  if (burned && !player.out) {
    room.currentPlayerId = player.id;
    addLog(room, `${player.name} plays again.`);
  } else {
    const skipCount = !burned && cards[0].rank === "8" ? cards.length : 0;
    if (skipCount > 0) {
      addLog(room, `${player.name} skipped ${skipCount} player${skipCount > 1 ? "s" : ""}.`);
    }
    advanceTurn(room, skipCount);
  }

  touch(room);
}

function pickUpPile(room, playerId, faceUpCardId) {
  if (room.status !== "playing") {
    throw new Error("The game is not in play.");
  }
  if (room.currentPlayerId !== playerId) {
    throw new Error("It is not your turn.");
  }
  if (room.discard.length === 0) {
    throw new Error("There is no pile to pick up.");
  }

  const player = getPlayer(room, playerId);
  const activeZone = getActiveZone(room, player);

  if (activeZone === "hand") {
    const pickedUp = room.discard.splice(0);
    player.hand.push(...pickedUp);
    sortPlayerHand(player);
    addLog(room, `${player.name} picked up the pile.`);
    advanceTurn(room, 0);
    touch(room);
    return;
  }

  if (activeZone === "faceUp" || activeZone === "table") {
    const faceUpCards = getFaceUpCards(player);
    if (faceUpCards.length === 0) {
      const pickedUp = room.discard.splice(0);
      player.hand.push(...pickedUp);
      sortPlayerHand(player);
      addLog(room, `${player.name} picked up the pile.`);
      advanceTurn(room, 0);
      touch(room);
      return;
    }
    const slot = ensureTableSlots(player).find(
      (candidate) => candidate.faceUp && candidate.faceUp.id === faceUpCardId
    );
    if (!slot) {
      throw new Error("Choose one face-up card to pick up with the pile.");
    }
    const tableCard = slot.faceUp;
    slot.faceUp = null;
    syncTableArrays(player);
    const pickedUp = room.discard.splice(0);
    player.hand.push(...pickedUp, tableCard);
    sortPlayerHand(player);
    addLog(room, `${player.name} picked up the pile and ${formatCards([tableCard])}.`);
    advanceTurn(room, 0);
    touch(room);
    return;
  }

  const pickedUp = room.discard.splice(0);
  player.hand.push(...pickedUp);
  sortPlayerHand(player);
  addLog(room, `${player.name} picked up the pile.`);
  advanceTurn(room, 0);
  touch(room);
}

function getSelectedCards(cards, cardIds) {
  const uniqueIds = [...new Set(cardIds || [])];
  const selected = uniqueIds.map((id) => cards.find((card) => card.id === id)).filter(Boolean);
  if (selected.length !== uniqueIds.length) {
    throw new Error("One of those cards is not available.");
  }
  return selected;
}

function canPlayRank(room, rank) {
  if (!room.firstMoveDone && room.discard.length === 0) {
    return rank === "4";
  }

  if (rank === "2" || rank === "3") {
    return true;
  }

  const effectiveTop = getEffectiveTop(room);
  if (!effectiveTop) {
    return true;
  }

  if (effectiveTop.rank === "7") {
    return RANK_VALUES[rank] <= 7;
  }

  return RANK_VALUES[rank] >= RANK_VALUES[effectiveTop.rank];
}

function getEffectiveTop(room) {
  for (let index = room.discard.length - 1; index >= 0; index -= 1) {
    const card = room.discard[index];
    if (card.rank === "3") {
      continue;
    }
    if (card.rank === "2") {
      return null;
    }
    return card;
  }
  return null;
}

function getTopRunLength(cards) {
  if (cards.length === 0) {
    return 0;
  }
  const rank = cards[cards.length - 1].rank;
  let count = 0;
  for (let index = cards.length - 1; index >= 0; index -= 1) {
    if (cards[index].rank !== rank) {
      break;
    }
    count += 1;
  }
  return count;
}

function getActiveZone(room, player) {
  if (player.hand.length > 0) {
    return "hand";
  }
  const sources = getAllowedSources(player);
  if (sources.includes("faceUp") && sources.includes("blind")) {
    return "table";
  }
  if (sources.includes("faceUp")) {
    return "faceUp";
  }
  if (sources.includes("blind")) {
    return "blind";
  }
  return "out";
}

function getAllowedSources(player) {
  if (player.hand.length > 0) {
    return ["hand"];
  }

  const sources = [];
  if (getFaceUpCards(player).length > 0) {
    sources.push("faceUp");
  }
  if (getUnlockedBlindCards(player).length > 0) {
    sources.push("blind");
  }
  return sources.length > 0 ? sources : ["out"];
}

function finishIfNeeded(room) {
  for (const player of room.players) {
    if (!player.out && totalCards(player) === 0) {
      player.out = true;
      addLog(room, `${player.name} is safe.`);
    }
  }

  const playersWithCards = room.players.filter((player) => !player.out);
  if (room.status === "playing" && playersWithCards.length <= 1) {
    room.status = "finished";
    room.currentPlayerId = null;
    room.poopyheadId = playersWithCards[0] ? playersWithCards[0].id : null;
    if (room.poopyheadId) {
      const poopyhead = getPlayer(room, room.poopyheadId);
      addLog(room, `${poopyhead.name} is the Poopyhead.`);
    } else {
      addLog(room, "The game ended with no cards left.");
    }
    return true;
  }

  return false;
}

function advanceTurn(room, skipCount) {
  const activeCount = room.players.filter((player) => !player.out).length;
  if (activeCount === 0) {
    room.currentPlayerId = null;
    return;
  }

  let index = room.players.findIndex((player) => player.id === room.currentPlayerId);
  if (index < 0) {
    index = 0;
  }

  let steps = 1 + skipCount;
  while (steps > 0) {
    index = (index + 1) % room.players.length;
    if (!room.players[index].out) {
      steps -= 1;
    }
  }
  room.currentPlayerId = room.players[index].id;
}

function totalCards(player) {
  const tableCount = ensureTableSlots(player).reduce(
    (count, slot) => count + (slot.faceUp ? 1 : 0) + (slot.blind ? 1 : 0),
    0
  );
  return player.hand.length + tableCount;
}

function getPlayer(room, playerId) {
  const player = room.players.find((candidate) => candidate.id === playerId);
  if (!player) {
    throw new Error("Player not found.");
  }
  return player;
}

function zoneLabel(zone) {
  if (zone === "faceUp") {
    return "face-up cards";
  }
  if (zone === "blind") {
    return "blind cards";
  }
  if (zone === "table") {
    return "table cards";
  }
  return zone;
}

function formatCards(cards) {
  return cards.map((card) => card.label).join(", ");
}

function sortCards(cards) {
  return [...cards].sort((a, b) => {
    const rankDiff = HAND_SORT_ORDER[a.rank] - HAND_SORT_ORDER[b.rank];
    if (rankDiff !== 0) {
      return rankDiff;
    }
    return (SUIT_SORT_ORDER[a.suit] ?? 99) - (SUIT_SORT_ORDER[b.suit] ?? 99);
  });
}

function sortPlayerHand(player) {
  player.hand = sortCards(player.hand);
}

function publicCard(card) {
  return {
    id: card.id,
    rank: card.rank,
    suit: card.suit,
    suitSymbol: card.suitSymbol || SUIT_SYMBOLS[card.suit] || card.suit,
    suitColor: card.suitColor || (card.suit === "H" || card.suit === "D" ? "red" : "black"),
    value: card.value,
    label: card.label,
    special: card.rank === "2" || card.rank === "3" || card.rank === "7" || card.rank === "8",
  };
}

function hiddenCard(card) {
  return {
    id: card.id,
    hidden: true,
  };
}

function ensureTableSlots(player) {
  if (Array.isArray(player.table) && player.table.length > 0) {
    return player.table;
  }

  const faceUp = Array.isArray(player.faceUp) ? player.faceUp : [];
  const blind = Array.isArray(player.blind) ? player.blind : [];
  const slotCount = Math.max(faceUp.length, blind.length);
  player.table = Array.from({ length: slotCount }, (_, index) => ({
    faceUp: faceUp[index] || null,
    blind: blind[index] || null,
  }));
  return player.table;
}

function syncTableArrays(player) {
  const slots = ensureTableSlots(player);
  player.faceUp = slots.map((slot) => slot.faceUp).filter(Boolean);
  player.blind = slots.map((slot) => slot.blind).filter(Boolean);
}

function getFaceUpCards(player) {
  return ensureTableSlots(player)
    .map((slot) => slot.faceUp)
    .filter(Boolean);
}

function getBlindCards(player) {
  return ensureTableSlots(player)
    .map((slot) => slot.blind)
    .filter(Boolean);
}

function getUnlockedBlindCards(player) {
  return ensureTableSlots(player)
    .filter((slot) => !slot.faceUp && slot.blind)
    .map((slot) => slot.blind);
}

function serializeTable(player, isViewer) {
  return ensureTableSlots(player).map((slot) => ({
    faceUp: slot.faceUp ? publicCard(slot.faceUp) : null,
    blind: slot.blind ? (isViewer ? hiddenCard(slot.blind) : { hidden: true }) : null,
    unlocked: Boolean(!slot.faceUp && slot.blind),
  }));
}

function getPileRule(room) {
  if (!room.firstMoveDone && room.discard.length === 0) {
    return "Opening card must be 4";
  }

  const effectiveTop = getEffectiveTop(room);
  if (!effectiveTop) {
    return "Any card can be played";
  }
  if (effectiveTop.rank === "7") {
    return "Play 7 or lower";
  }
  return `Play ${effectiveTop.rank} or higher`;
}

function serializeRoom(room, viewerId) {
  const viewer = room.players.find((player) => player.id === viewerId) || null;
  const currentPlayer = room.players.find((player) => player.id === room.currentPlayerId) || null;
  const pileTail = room.discard.slice(-8).map(publicCard);
  const legal = viewer ? getLegalState(room, viewer) : null;

  return {
    id: room.id,
    status: room.status,
    hostId: room.hostId,
    yourId: viewerId,
    handSize: room.handSize,
    deckCount: room.deckCount,
    drawCount: room.deck.length,
    discardCount: room.discard.length,
    discardTop: room.discard.length ? publicCard(room.discard[room.discard.length - 1]) : null,
    effectiveTop: getEffectiveTop(room) ? publicCard(getEffectiveTop(room)) : null,
    pileRule: getPileRule(room),
    pileTail,
    currentPlayerId: room.currentPlayerId,
    currentPlayerName: currentPlayer ? currentPlayer.name : null,
    poopyheadId: room.poopyheadId,
    canStart: room.status === "lobby" && room.hostId === viewerId && room.players.filter((player) => player.connected).length >= MIN_PLAYERS,
    players: room.players.map((player) => ({
      id: player.id,
      name: player.name,
      connected: player.connected,
      isHost: player.id === room.hostId,
      out: player.out,
      prepared: player.prepared,
      totalCount: totalCards(player),
      handCount: player.hand.length,
      hand: player.id === viewerId ? sortCards(player.hand).map(publicCard) : [],
      table: serializeTable(player, player.id === viewerId),
      faceUp: getFaceUpCards(player).map(publicCard),
      blindCount: getBlindCards(player).length,
      blind: player.id === viewerId ? getBlindCards(player).map(hiddenCard) : [],
    })),
    legal,
    log: room.log.slice(-14),
  };
}

function getLegalState(room, player) {
  if (room.status === "setup") {
    return {
      canChooseFaceUp: !player.prepared,
      setupNeeded: !player.prepared,
    };
  }

  if (room.status !== "playing" || player.out) {
    return {
      isYourTurn: false,
      zone: "out",
      zones: [],
      playableHandIds: [],
      playableFaceUpIds: [],
      playableBlindIds: [],
      canPickUp: false,
      needsFaceUpPickupChoice: false,
    };
  }

  const isYourTurn = room.currentPlayerId === player.id;
  const zone = getActiveZone(room, player);
  const zones = getAllowedSources(player).filter((source) => source !== "out");
  const playableHandIds = zone === "hand" ? player.hand.filter((card) => canPlayRank(room, card.rank)).map((card) => card.id) : [];
  const playableFaceUpIds =
    zones.includes("faceUp") ? getFaceUpCards(player).filter((card) => canPlayRank(room, card.rank)).map((card) => card.id) : [];
  const playableBlindIds = zones.includes("blind") ? getUnlockedBlindCards(player).map((card) => card.id) : [];
  const canPickUp = isYourTurn && room.discard.length > 0 && zone !== "out";

  return {
    isYourTurn,
    zone,
    zones,
    playableHandIds,
    playableFaceUpIds,
    playableBlindIds,
    canPickUp,
    needsFaceUpPickupChoice: canPickUp && (zone === "faceUp" || zone === "table") && getFaceUpCards(player).length > 0,
  };
}

module.exports = {
  MAX_PLAYERS,
  MIN_PLAYERS,
  RANK_VALUES,
  canPlayRank,
  chooseFaceUp,
  createRoom,
  disconnectPlayer,
  getEffectiveTop,
  joinRoom,
  makeRoomId,
  pickUpPile,
  playCards,
  resetRound,
  serializeRoom,
  startGame,
};
