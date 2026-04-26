const socket = io();
const app = document.getElementById("app");
const toast = document.getElementById("toast");
const seatKey = new URLSearchParams(window.location.search).get("seat");
const CLIENT_ID_KEY = seatKey ? `poopyhead.clientId.${seatKey}` : "poopyhead.clientId";
const NAME_KEY = "poopyhead.name";
const MAX_NAME_LENGTH = 18;
const SUIT_SYMBOLS = {
  S: "♠",
  H: "♥",
  D: "♦",
  C: "♣",
};

let state = null;
let selectedSource = null;
let selectedIds = new Set();
let toastTimer = null;

const clientId = getClientId();

socket.on("roomState", (nextState) => {
  state = nextState;
  reconcileSelection();
  render();
});

socket.on("gameError", (message) => {
  showToast(message);
});

app.addEventListener("click", (event) => {
  const actionTarget = event.target.closest("[data-action]");
  if (actionTarget) {
    handleAction(actionTarget.dataset.action);
    return;
  }

  const cardTarget = event.target.closest("[data-card-id]");
  if (cardTarget) {
    toggleCard(cardTarget.dataset.source, cardTarget.dataset.cardId);
  }
});

app.addEventListener("keydown", (event) => {
  if (event.key !== "Enter") {
    return;
  }
  const action = event.target.dataset.enterAction;
  if (action) {
    event.preventDefault();
    handleAction(action);
  }
});

render();

function getClientId() {
  const existing = localStorage.getItem(CLIENT_ID_KEY);
  if (existing) {
    return existing;
  }
  const id =
    window.crypto && window.crypto.randomUUID
      ? window.crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  localStorage.setItem(CLIENT_ID_KEY, id);
  return id;
}

function getRouteRoomId() {
  const match = window.location.pathname.match(/^\/room\/([A-Z0-9]+)$/i);
  return match ? match[1].toUpperCase() : "";
}

function getNameInput() {
  return document.getElementById("playerName");
}

function getRoomInput() {
  return document.getElementById("roomCode");
}

function saveName(name) {
  localStorage.setItem(NAME_KEY, name);
}

function handleAction(action) {
  if (action === "createRoom") {
    const name = readName();
    if (!name) return;
    emit("createRoom", { name, playerId: clientId }, (response) => {
      history.pushState({}, "", `/room/${response.roomId}`);
    });
    return;
  }

  if (action === "joinRoom") {
    const name = readName();
    if (!name) return;
    const roomId = (getRouteRoomId() || (getRoomInput() && getRoomInput().value) || "").trim().toUpperCase();
    if (!roomId) {
      showToast("Enter a room code.");
      return;
    }
    emit("joinRoom", { roomId, name, playerId: clientId }, (response) => {
      history.pushState({}, "", `/room/${response.roomId}`);
    });
    return;
  }

  if (action === "copyLink") {
    copyRoomLink();
    return;
  }

  if (action === "startGame") {
    emit("startGame", {});
    return;
  }

  if (action === "resetRound") {
    emit("resetRound", {}, clearSelection);
    return;
  }

  if (action === "autoPick") {
    autoPickFaceUp();
    return;
  }

  if (action === "placeFaceUp") {
    if (selectedIds.size !== 3) {
      showToast("Choose exactly 3 cards.");
      return;
    }
    emit("chooseFaceUp", { cardIds: [...selectedIds] }, clearSelection);
    return;
  }

  if (action === "playSelected") {
    if (!selectedSource || selectedIds.size === 0) {
      showToast("Choose a card first.");
      return;
    }
    emit("playCards", { source: selectedSource, cardIds: [...selectedIds] }, clearSelection);
    return;
  }

  if (action === "pickUpPile") {
    const payload = {};
    if (state && state.legal && state.legal.needsFaceUpPickupChoice) {
      if (selectedSource !== "faceUp" || selectedIds.size !== 1) {
        showToast("Choose one face-up card.");
        return;
      }
      payload.faceUpCardId = [...selectedIds][0];
    }
    emit("pickUpPile", payload, clearSelection);
  }
}

function readName() {
  const input = getNameInput();
  const name = normalizeName(input ? input.value : "");
  if (!name) {
    showToast("Enter your name.");
    return "";
  }
  if (input) {
    input.value = name;
  }
  saveName(name);
  return name;
}

function normalizeName(name) {
  return String(name || "").trim().replace(/\s+/g, " ").slice(0, MAX_NAME_LENGTH);
}

function emit(eventName, payload, onOk) {
  socket.emit(eventName, payload, (response) => {
    if (!response || !response.ok) {
      showToast((response && response.error) || "Something went sideways.");
      return;
    }
    if (onOk) {
      onOk(response);
    }
  });
}

function render() {
  if (!state) {
    renderEntry();
    return;
  }

  if (state.status === "lobby") {
    app.innerHTML = `${renderTopbar()}${renderLobby()}`;
    return;
  }

  if (state.status === "setup") {
    app.innerHTML = `${renderTopbar()}${renderSetup()}`;
    return;
  }

  app.innerHTML = `${renderTopbar()}${renderGame()}${renderPoopRain()}`;
}

function renderTopbar() {
  const roomTools = state
    ? `<div class="room-tools">
        <span class="room-code">Room ${escapeHtml(state.id)}</span>
        <button class="ghost-button" data-action="copyLink" type="button">Copy Link</button>
      </div>`
    : "";

  return `<header class="topbar">
    <div class="brand">
      <div class="mark">PH</div>
      <h1>Poopy Head</h1>
    </div>
    ${roomTools}
  </header>`;
}

function renderEntry() {
  const routeRoomId = getRouteRoomId();
  const savedName = normalizeName(localStorage.getItem(NAME_KEY) || "");
  const joinTitle = routeRoomId ? `Join Room ${escapeHtml(routeRoomId)}` : "Create Or Join";
  const joinText = routeRoomId
    ? "Pick a name and sit down at the table."
    : "Start a lobby or enter a room code from a friend.";
  const roomInput = routeRoomId
    ? ""
    : `<input id="roomCode" autocomplete="off" maxlength="8" placeholder="Room code" data-enter-action="joinRoom" />`;

  app.innerHTML = `${renderTopbar()}
    <section class="entry">
      <div class="table-preview" aria-hidden="true">
        <div class="preview-card"><span>4</span><strong>♠</strong></div>
        <div class="preview-card"><span>2</span><strong>♣</strong></div>
        <div class="preview-card red"><span>A</span><strong>♥</strong></div>
      </div>
      <div class="join-panel">
        <h2>${joinTitle}</h2>
        <p>${joinText}</p>
        <div class="form-grid">
          <input id="playerName" autocomplete="name" maxlength="${MAX_NAME_LENGTH}" placeholder="Your name" value="${escapeHtml(
            savedName
          )}" data-enter-action="${routeRoomId ? "joinRoom" : "createRoom"}" />
          ${roomInput}
          <button data-action="${routeRoomId ? "joinRoom" : "createRoom"}" type="button">${
            routeRoomId ? "Join Lobby" : "Create Lobby"
          }</button>
          ${
            routeRoomId
              ? ""
              : '<button class="ghost-button" data-action="joinRoom" type="button">Join Code</button>'
          }
        </div>
      </div>
    </section>`;
}

function renderLobby() {
  const connectedCount = state.players.filter((player) => player.connected).length;
  const nextHandSize = connectedCount <= 4 ? 5 : 4;
  const nextDeckCount = connectedCount > 5 ? 2 : 1;

  return `<section class="lobby-grid">
    <div class="lobby-panel">
      <div class="section-head">
        <div>
          <h2>Lobby</h2>
          <div class="subtle">${connectedCount} / 10 players seated</div>
        </div>
        <button data-action="startGame" type="button" ${state.canStart ? "" : "disabled"}>Start Game</button>
      </div>
      <ul class="player-list">${state.players.map(renderLobbyPlayer).join("")}</ul>
    </div>
    <aside class="side-panel">
      <h2>Table Setup</h2>
      <div class="status-strip">
        <div class="stat"><strong>${nextDeckCount}</strong><span>deck${nextDeckCount > 1 ? "s" : ""}</span></div>
        <div class="stat"><strong>${nextHandSize}</strong><span>hand cards</span></div>
        <div class="stat"><strong>3</strong><span>blind cards</span></div>
      </div>
      <p class="subtle">Minimum 2 players. Maximum 10 players.</p>
    </aside>
  </section>`;
}

function renderLobbyPlayer(player) {
  return `<li class="player-row">
    <div class="player-name">
      <span>${escapeHtml(player.name)}</span>
      ${player.isHost ? '<em class="badge host">Host</em>' : ""}
    </div>
    <span class="badge">${player.connected ? "Ready" : "Away"}</span>
  </li>`;
}

function renderSetup() {
  const you = getYou();
  const chosenCount = selectedSource === "hand" ? selectedIds.size : 0;
  const canPlace = state.legal && state.legal.canChooseFaceUp && chosenCount === 3;

  return `<section class="setup-layout">
    <div class="setup-panel">
      <div class="section-head">
        <div>
          <h2>Choose Table Cards</h2>
          <div class="subtle">${chosenCount} / 3 selected</div>
        </div>
        <div class="actions">
          <button class="ghost-button" data-action="autoPick" type="button" ${
            state.legal && state.legal.canChooseFaceUp ? "" : "disabled"
          }>Auto Pick</button>
          <button data-action="placeFaceUp" type="button" ${canPlace ? "" : "disabled"}>Place Cards</button>
        </div>
      </div>
      ${renderCardZone("Hand", "hand", you.hand, {
        selectable: state.legal && state.legal.canChooseFaceUp,
        setup: true,
      })}
      ${renderTableZone(you, { title: "Table Stacks" })}
    </div>
    <aside class="side-panel">
      <h2>Players</h2>
      <ul class="player-list">${state.players.map(renderSetupPlayer).join("")}</ul>
    </aside>
  </section>`;
}

function renderSetupPlayer(player) {
  return `<li class="player-row">
    <div class="player-name">
      <span>${escapeHtml(player.name)}</span>
      ${player.isHost ? '<em class="badge host">Host</em>' : ""}
    </div>
    <span class="badge ${player.prepared ? "turn" : ""}">${player.prepared ? "Set" : "Choosing"}</span>
  </li>`;
}

function renderGame() {
  return `<section class="game-grid">
    ${renderPlayersPanel()}
    <div class="game-panel">
      ${renderTable()}
      ${renderYourBoard()}
    </div>
    ${renderLogPanel()}
  </section>`;
}

function renderPlayersPanel() {
  return `<aside class="side-panel players-panel">
    <h2>Players</h2>
    <div class="player-list">${state.players.map(renderGamePlayer).join("")}</div>
  </aside>`;
}

function renderGamePlayer(player) {
  const tableCards = renderTableStacks(player, { small: true, compact: true });

  return `<div class="opponent">
    <div class="opponent-head">
      <div class="player-name">
        <span>${escapeHtml(player.name)}</span>
        ${player.id === state.currentPlayerId ? '<em class="badge turn">Turn</em>' : ""}
        ${player.out ? '<em class="badge out">Safe</em>' : ""}
      </div>
      <span class="mini-counts">${player.handCount} hand</span>
    </div>
    ${tableCards}
  </div>`;
}

function renderTable() {
  const pileCards = state.pileTail.length
    ? state.pileTail.map((card) => renderCard(card, { small: false })).join("")
    : '<div class="empty">Empty pile</div>';
  const turnText =
    state.status === "finished"
      ? renderFinished()
      : `<strong>${escapeHtml(state.currentPlayerName || "Table")}</strong><span class="badge turn">${
          state.pileRule
        }</span>`;

  return `<div class="table">
    <div class="table-status">
      <div class="stat"><strong>${state.drawCount}</strong><span>draw pile</span></div>
      <div class="stat"><strong>${state.discardCount}</strong><span>discard pile</span></div>
      <div class="stat"><strong>${state.handSize}</strong><span>minimum hand</span></div>
    </div>
    <div class="pile-area">
      <div class="pile-stack">${pileCards}</div>
      <div class="turn-callout">${turnText}</div>
    </div>
  </div>`;
}

function renderFinished() {
  const poopyhead = state.players.find((player) => player.id === state.poopyheadId);
  const title = poopyhead
    ? `<strong>${escapeHtml(poopyhead.name)} is the Poopyhead</strong>`
    : "<strong>Game finished</strong>";
  return `${title}<button class="ghost-button" data-action="resetRound" type="button">Reset Round</button>`;
}

function renderYourBoard() {
  const you = getYou();
  const legal = state.legal || {};
  const legalSources = getLegalSources();
  const selectedCount = selectedIds.size;
  const isPlaying = state.status === "playing";
  const canPlay = isPlaying && legal.isYourTurn && selectedCount > 0 && selectedCanPlay(legalSources, legal);
  const canPickUp =
    isPlaying &&
    legal.canPickUp &&
    (!legal.needsFaceUpPickupChoice || (selectedSource === "faceUp" && selectedIds.size === 1));
  const playLabel = selectedSource === "blind" || (legalSources.length === 1 && legalSources[0] === "blind") ? "Flip Card" : "Play";

  return `<div class="your-board">
    <div class="section-head">
      <div>
        <h2>Your Cards</h2>
        <div class="subtle">${legal.isYourTurn ? "Your turn" : `Waiting for ${escapeHtml(
          state.currentPlayerName || "the table"
        )}`}</div>
      </div>
      <div class="actions">
        <button data-action="playSelected" type="button" ${canPlay ? "" : "disabled"}>${playLabel}</button>
        <button class="danger-button" data-action="pickUpPile" type="button" ${canPickUp ? "" : "disabled"}>Pick Up</button>
      </div>
    </div>
    ${renderCardZone("Hand", "hand", you.hand, {
      active: legal.zone === "hand" && legal.isYourTurn,
      selectable: legalSources.includes("hand") && legal.isYourTurn,
      playableIds: legal.playableHandIds || [],
    })}
    ${renderTableZone(you, {
      title: "Table Stacks",
      active: (legal.zone === "faceUp" || legal.zone === "blind" || legal.zone === "table") && legal.isYourTurn,
      selectableSources: legal.isYourTurn ? legalSources : [],
      playableFaceUpIds: legal.playableFaceUpIds || [],
      playableBlindIds: legal.playableBlindIds || [],
      pickupChoice: legal.needsFaceUpPickupChoice,
    })}
  </div>`;
}

function renderLogPanel() {
  const logs = state.log.length
    ? state.log
        .slice()
        .reverse()
        .map((entry) => `<li>${escapeHtml(entry.message)}</li>`)
        .join("")
    : '<li class="subtle">No moves yet</li>';

  return `<aside class="side-panel">
    <h2>Game Log</h2>
    <ul class="event-log">${logs}</ul>
  </aside>`;
}

function renderCardZone(title, source, cards, options = {}) {
  const activeClass = options.active ? " active" : "";
  const cardMarkup = cards.length
    ? cards.map((card) => renderCard(card, { ...options, source })).join("")
    : '<div class="empty">No cards</div>';
  return `<section class="zone${activeClass}">
    <div class="section-head">
      <h3>${title}</h3>
      <span class="badge">${cards.length}</span>
    </div>
    <div class="cards">${cardMarkup}</div>
  </section>`;
}

function renderBlindZone(cards, selectable) {
  const cardMarkup = cards.length
    ? cards.map((card) => renderCard(card, { source: "blind", selectable })).join("")
    : '<div class="empty">No blind cards</div>';
  return `<section class="zone${selectable ? " active" : ""}">
    <div class="section-head">
      <h3>Blind</h3>
      <span class="badge">${cards.length}</span>
    </div>
    <div class="cards">${cardMarkup}</div>
  </section>`;
}

function renderTableZone(player, options = {}) {
  const activeClass = options.active ? " active" : "";
  return `<section class="zone${activeClass}">
    <div class="section-head">
      <h3>${options.title || "Table"}</h3>
      <span class="badge">${player.faceUp.length + player.blindCount}</span>
    </div>
    ${renderTableStacks(player, options)}
  </section>`;
}

function renderTableStacks(player, options = {}) {
  const slots = getTableSlots(player);
  if (slots.length === 0) {
    return '<div class="empty">No table cards</div>';
  }

  const stackClass = options.compact ? " table-stacks compact" : "table-stacks";
  return `<div class="${stackClass}">${slots.map((slot) => renderTableSlot(slot, options)).join("")}</div>`;
}

function renderTableSlot(slot, options = {}) {
  const selectableSources = options.selectableSources || [];
  const blindSelectable =
    selectableSources.includes("blind") &&
    slot.unlocked &&
    slot.blind &&
    (options.playableBlindIds || []).includes(slot.blind.id);
  const faceUpSelectable =
    selectableSources.includes("faceUp") &&
    slot.faceUp &&
    (options.pickupChoice || (options.playableFaceUpIds || []).includes(slot.faceUp.id));
  const blind = slot.blind
    ? renderCard(slot.blind, {
        source: "blind",
        selectable: blindSelectable,
        small: options.small,
      })
    : '<div class="card-placeholder">Cleared</div>';
  const faceUp = slot.faceUp
    ? renderCard(slot.faceUp, {
        source: "faceUp",
        selectable: faceUpSelectable,
        playableIds: options.playableFaceUpIds || [],
        pickupChoice: options.pickupChoice,
        small: options.small,
      })
    : "";

  return `<div class="table-slot${slot.unlocked ? " unlocked" : ""}">
    ${blind}
    ${faceUp}
  </div>`;
}

function renderCard(card, options = {}) {
  const hidden = card.hidden;
  const source = options.source || "";
  const smallClass = options.small ? " small" : "";
  const selected = selectedIds.has(card.id) && selectedSource === source;
  const selectedClass = selected ? " selected" : "";
  const selectableClass = options.selectable ? " selectable" : "";
  const playableIds = options.playableIds || [];
  const isPlayable = !options.selectable || options.setup || options.pickupChoice || hidden || playableIds.includes(card.id);
  const unplayableClass = options.selectable && !isPlayable ? " unplayable" : "";
  const specialClass = card.special ? " special" : "";
  const data = options.selectable ? `data-source="${source}" data-card-id="${card.id}"` : "";
  const symbol = getSuitSymbol(card);
  const color = card.suitColor || (card.suit === "H" || card.suit === "D" ? "red" : "black");

  if (hidden) {
    return `<div class="card back${smallClass}${selectedClass}${selectableClass}" ${data} role="${
      options.selectable ? "button" : "img"
    }" tabindex="${options.selectable ? "0" : "-1"}"><span class="rank">?</span></div>`;
  }

  return `<div class="card${smallClass}${selectedClass}${selectableClass}${unplayableClass}${specialClass}" data-suit="${escapeHtml(
    card.suit
  )}" data-color="${color}" ${data} role="${options.selectable ? "button" : "img"}" tabindex="${options.selectable ? "0" : "-1"}">
    <span class="rank">${escapeHtml(card.rank)}</span>
    <span></span>
    <span class="suit">${escapeHtml(symbol)}</span>
  </div>`;
}

function toggleCard(source, cardId) {
  if (!state) {
    return;
  }

  if (state.status === "setup") {
    if (!state.legal || !state.legal.canChooseFaceUp || source !== "hand") {
      return;
    }
    if (selectedSource !== "hand") {
      selectedIds = new Set();
      selectedSource = "hand";
    }
    if (selectedIds.has(cardId)) {
      selectedIds.delete(cardId);
    } else if (selectedIds.size < 3) {
      selectedIds.add(cardId);
    } else {
      showToast("Three face-up cards only.");
    }
    render();
    return;
  }

  const legal = state.legal || {};
  const legalSources = getLegalSources();
  if (!legal.isYourTurn || !legalSources.includes(source)) {
    return;
  }

  if (source === "blind") {
    if (!(legal.playableBlindIds || []).includes(cardId)) {
      return;
    }
    selectedSource = "blind";
    selectedIds = new Set([cardId]);
    render();
    return;
  }

  const card = findYourCard(source, cardId);
  if (!card) {
    return;
  }

  if (legal.needsFaceUpPickupChoice && source === "faceUp") {
    selectedSource = "faceUp";
    selectedIds = new Set([cardId]);
    render();
    return;
  }

  const playableIds = source === "hand" ? legal.playableHandIds || [] : legal.playableFaceUpIds || [];
  const selectingForPickup = legal.needsFaceUpPickupChoice && source === "faceUp";
  if (!selectingForPickup && !playableIds.includes(cardId)) {
    showToast("That card cannot be played here.");
    return;
  }

  if (selectedSource !== source) {
    selectedIds = new Set();
    selectedSource = source;
  }

  if (source === "faceUp") {
    if (selectedIds.has(cardId) && selectedIds.size === 1) {
      selectedIds = new Set();
    } else {
      selectedIds = new Set([cardId]);
    }
  } else if (selectedIds.has(cardId)) {
    selectedIds.delete(cardId);
  } else {
    const selectedCards = [...selectedIds].map((id) => findYourCard(source, id)).filter(Boolean);
    if (selectedCards.length > 0 && selectedCards[0].rank !== card.rank) {
      selectedIds = new Set();
    }
    selectedIds.add(cardId);
  }

  render();
}

function selectedCanPlay(legalSources, legal) {
  if (!selectedSource || !legalSources.includes(selectedSource) || selectedIds.size === 0) {
    return false;
  }

  const ids = [...selectedIds];
  if (selectedSource === "hand") {
    return ids.every((id) => (legal.playableHandIds || []).includes(id));
  }
  if (selectedSource === "faceUp") {
    return ids.length === 1 && ids.every((id) => (legal.playableFaceUpIds || []).includes(id));
  }
  if (selectedSource === "blind") {
    return ids.length === 1 && ids.every((id) => (legal.playableBlindIds || []).includes(id));
  }
  return false;
}

function autoPickFaceUp() {
  if (!state || state.status !== "setup" || !state.legal || !state.legal.canChooseFaceUp) {
    return;
  }
  const cards = getYou().hand.slice();
  selectedSource = "hand";
  selectedIds = new Set(cards.sort((a, b) => scoreCard(b) - scoreCard(a)).slice(0, 3).map((card) => card.id));
  render();
}

function scoreCard(card) {
  if (card.rank === "2") return 180;
  if (card.rank === "3") return 170;
  if (card.rank === "8") return 160;
  if (card.rank === "7") return 90;
  return card.value * 10;
}

function copyRoomLink() {
  if (!state) {
    return;
  }
  const link = `${window.location.origin}/room/${state.id}`;
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(link).then(
      () => showToast("Lobby link copied."),
      () => showToast(link)
    );
  } else {
    showToast(link);
  }
}

function getYou() {
  return state.players.find((player) => player.id === state.yourId) || state.players[0];
}

function findYourCard(source, cardId) {
  const you = getYou();
  const cards = getCardsBySource(you, source);
  return cards.find((card) => card.id === cardId);
}

function reconcileSelection() {
  if (!state) {
    clearSelection();
    return;
  }
  const you = getYou();
  const validIds = new Set([...getCardsBySource(you, "hand"), ...getCardsBySource(you, "faceUp"), ...getCardsBySource(you, "blind")].map((card) => card.id));
  selectedIds = new Set([...selectedIds].filter((id) => validIds.has(id)));
  if (selectedIds.size === 0) {
    selectedSource = null;
  }
}

function clearSelection() {
  selectedSource = null;
  selectedIds = new Set();
}

function showToast(message) {
  toast.textContent = message;
  toast.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toast.classList.remove("show");
  }, 2400);
}

function renderPoopRain() {
  if (!state || state.status !== "finished" || state.poopyheadId !== state.yourId) {
    return "";
  }

  return `<div class="poop-rain" aria-hidden="true">${Array.from({ length: 36 }, (_, index) => {
    const x = (index * 37) % 100;
    const delay = (index % 12) * 180;
    const duration = 2400 + (index % 7) * 240;
    const size = 22 + (index % 5) * 5;
    return `<span style="--x:${x}%;--delay:${delay}ms;--duration:${duration}ms;--size:${size}px">&#128169;</span>`;
  }).join("")}</div>`;
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function getLegalSources() {
  if (!state || !state.legal) {
    return [];
  }
  if (Array.isArray(state.legal.zones)) {
    return state.legal.zones;
  }
  return state.legal.zone ? [state.legal.zone] : [];
}

function getTableSlots(player) {
  if (Array.isArray(player.table) && player.table.length > 0) {
    return player.table;
  }
  const count = Math.max(player.faceUp.length, player.blindCount || player.blind.length);
  return Array.from({ length: count }, (_, index) => ({
    faceUp: player.faceUp[index] || null,
    blind: player.blind[index] || (index < player.blindCount ? { id: `${player.id}-blind-${index}`, hidden: true } : null),
    unlocked: !player.faceUp[index],
  }));
}

function getCardsBySource(player, source) {
  if (source === "hand") {
    return player.hand || [];
  }
  if (source === "faceUp") {
    return getTableSlots(player)
      .map((slot) => slot.faceUp)
      .filter(Boolean);
  }
  if (source === "blind") {
    return getTableSlots(player)
      .map((slot) => slot.blind)
      .filter(Boolean);
  }
  return [];
}

function getSuitSymbol(card) {
  return card.suitSymbol || SUIT_SYMBOLS[card.suit] || card.suit || "";
}
