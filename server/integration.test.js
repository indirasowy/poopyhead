const assert = require("assert");
const { io } = require("socket.io-client");

const BASE_URL = process.env.TEST_URL || "http://localhost:3001";

function connectClient() {
  const socket = io(BASE_URL, {
    reconnection: false,
    transports: ["websocket"],
  });
  socket.latestState = null;
  socket.on("roomState", (state) => {
    socket.latestState = state;
  });
  return new Promise((resolve, reject) => {
    socket.on("connect", () => resolve(socket));
    socket.on("connect_error", reject);
    setTimeout(() => reject(new Error(`Timed out connecting to ${BASE_URL}`)), 5000);
  });
}

function emitAck(socket, eventName, payload) {
  return new Promise((resolve, reject) => {
    socket.emit(eventName, payload, (response) => {
      if (!response || !response.ok) {
        reject(new Error((response && response.error) || `${eventName} failed`));
        return;
      }
      resolve(response);
    });
  });
}

function waitForState(socket, predicate, label) {
  if (socket.latestState && predicate(socket.latestState)) {
    return Promise.resolve(socket.latestState);
  }

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      socket.off("roomState", onState);
      reject(new Error(`Timed out waiting for ${label}`));
    }, 5000);

    function onState(state) {
      if (!predicate(state)) {
        return;
      }
      clearTimeout(timeout);
      socket.off("roomState", onState);
      resolve(state);
    }

    socket.on("roomState", onState);
  });
}

(async () => {
  const host = await connectClient();
  const guest = await connectClient();

  try {
    const created = await emitAck(host, "createRoom", { name: "Host", playerId: "host-test" });
    const roomId = created.roomId;
    await waitForState(host, (state) => state.id === roomId && state.players.length === 1, "host lobby");

    await emitAck(guest, "joinRoom", { roomId, name: "Guest", playerId: "guest-test" });
    const hostLobby = await waitForState(
      host,
      (state) => state.players.length === 2 && state.canStart,
      "two-player lobby"
    );
    const guestLobby = await waitForState(guest, (state) => state.players.length === 2, "guest lobby");
    assert.equal(hostLobby.players.filter((player) => player.connected).length, 2);
    assert.equal(guestLobby.players.map((player) => player.name).join(","), "Host,Guest");

    await emitAck(host, "startGame", {});
    const hostSetup = await waitForState(host, (state) => state.status === "setup", "host setup");
    const guestSetup = await waitForState(guest, (state) => state.status === "setup", "guest setup");
    assert.equal(hostSetup.handSize, 5);
    assert.equal(hostSetup.deckCount, 1);
    assert.equal(hostSetup.players.find((player) => player.id === "host-test").hand.length, 5);
    assert.equal(guestSetup.players.find((player) => player.id === "guest-test").blind.length, 3);
    assert.equal(hostSetup.players.find((player) => player.id === "host-test").table.length, 3);

    await emitAck(host, "chooseFaceUp", {
      cardIds: hostSetup.players.find((player) => player.id === "host-test").hand.slice(0, 3).map((card) => card.id),
    });
    await emitAck(guest, "chooseFaceUp", {
      cardIds: guestSetup.players.find((player) => player.id === "guest-test").hand.slice(0, 3).map((card) => card.id),
    });
    const playing = await waitForState(host, (state) => state.status === "playing", "playing state");
    assert.equal(Boolean(playing.currentPlayerId), true);
    assert.equal(playing.pileRule, "Opening card must be 4");
    assert.equal(playing.players.find((player) => player.id === "host-test").table.every((slot) => slot.faceUp && slot.blind), true);

    console.log("integration test passed");
  } finally {
    host.close();
    guest.close();
  }
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
