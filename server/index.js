const path = require("path");
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const {
  chooseFaceUp,
  createRoom,
  disconnectPlayer,
  joinRoom,
  makeRoomId,
  pickUpPile,
  playCards,
  serializeRoom,
  startGame,
} = require("./game");

const PORT = process.env.PORT || 3000;
const app = express();
const server = http.createServer(app);
const io = new Server(server);
const rooms = new Map();
const publicDir = path.join(__dirname, "..", "public");

app.use(express.static(publicDir));
app.get("/room/:roomId", (request, response) => {
  response.sendFile(path.join(publicDir, "index.html"));
});
app.get("*", (request, response) => {
  response.sendFile(path.join(publicDir, "index.html"));
});

io.on("connection", (socket) => {
  socket.on("createRoom", (payload, reply) => {
    tryAction(socket, reply, () => {
      const roomId = makeRoomId(new Set(rooms.keys()));
      const room = createRoom(roomId);
      rooms.set(roomId, room);
      joinSocketToRoom(socket, room, payload);
      return { roomId };
    });
  });

  socket.on("joinRoom", (payload, reply) => {
    tryAction(socket, reply, () => {
      const roomId = String(payload.roomId || "").trim().toUpperCase();
      const room = rooms.get(roomId);
      if (!room) {
        throw new Error("Room not found. Ask the host for a fresh link.");
      }
      joinSocketToRoom(socket, room, payload);
      return { roomId };
    });
  });

  socket.on("startGame", (payload, reply) => {
    withRoom(socket, reply, (room, playerId) => {
      startGame(room, playerId);
      emitRoom(room);
    });
  });

  socket.on("chooseFaceUp", (payload, reply) => {
    withRoom(socket, reply, (room, playerId) => {
      chooseFaceUp(room, playerId, payload.cardIds || []);
      emitRoom(room);
    });
  });

  socket.on("playCards", (payload, reply) => {
    withRoom(socket, reply, (room, playerId) => {
      playCards(room, playerId, payload.source, payload.cardIds || []);
      emitRoom(room);
    });
  });

  socket.on("pickUpPile", (payload, reply) => {
    withRoom(socket, reply, (room, playerId) => {
      pickUpPile(room, playerId, payload.faceUpCardId || null);
      emitRoom(room);
    });
  });

  socket.on("disconnect", () => {
    const roomId = socket.data.roomId;
    if (!roomId) {
      return;
    }
    const room = rooms.get(roomId);
    if (!room) {
      return;
    }
    disconnectPlayer(room, socket.id);
    emitRoom(room);
    scheduleRoomCleanup(roomId);
  });
});

function joinSocketToRoom(socket, room, payload) {
  const player = joinRoom(room, {
    playerId: payload.playerId,
    name: payload.name,
    socketId: socket.id,
  });

  socket.data.roomId = room.id;
  socket.data.playerId = player.id;
  socket.join(room.id);
  emitRoom(room);
}

function withRoom(socket, reply, action) {
  tryAction(socket, reply, () => {
    const roomId = socket.data.roomId;
    const playerId = socket.data.playerId;
    if (!roomId || !playerId) {
      throw new Error("Join a room first.");
    }
    const room = rooms.get(roomId);
    if (!room) {
      throw new Error("Room not found.");
    }
    action(room, playerId);
    return {};
  });
}

function tryAction(socket, reply, action) {
  try {
    const result = action();
    if (typeof reply === "function") {
      reply({ ok: true, ...result });
    }
  } catch (error) {
    if (typeof reply === "function") {
      reply({ ok: false, error: error.message });
    } else {
      socket.emit("gameError", error.message);
    }
  }
}

function emitRoom(room) {
  for (const player of room.players) {
    if (player.socketId) {
      io.to(player.socketId).emit("roomState", serializeRoom(room, player.id));
    }
  }
}

function scheduleRoomCleanup(roomId) {
  setTimeout(() => {
    const room = rooms.get(roomId);
    if (!room) {
      return;
    }
    const hasConnectedPlayers = room.players.some((player) => player.connected);
    if (!hasConnectedPlayers) {
      rooms.delete(roomId);
    }
  }, 60 * 60 * 1000);
}

server.listen(PORT, () => {
  console.log(`Poopy Head is running at http://localhost:${PORT}`);
});
