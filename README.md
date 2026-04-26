# Poopy Head

A realtime browser version of Poopy Head with linkable lobbies for 2 to 10 players.

## Deploy

[Deploy to Render](https://render.com/deploy?repo=https://github.com/indirasowy/poopyhead)

Render is the recommended free hosting path for this app because the game server uses Socket.IO WebSockets and in-memory lobby state. Use the included `render.yaml` Blueprint to create one web service:

- Build command: `npm install`
- Start command: `npm start`
- Environment: `NODE_ENV=production`

After Render finishes the first deploy, open the `.onrender.com` URL, create a lobby, and send that lobby link to other players.

## Run

```bash
npm install
npm start
```

Open `http://localhost:3000` by default. If that port is busy, run with another port:

```bash
PORT=3001 npm start
```

Create a lobby, copy the room link, and send it to players who can reach the same server.

## Rules Implemented

- 2 to 4 players use one deck and 5-card hands.
- 5 players use one deck and 4-card hands.
- 6 to 10 players use two decks and 4-card hands.
- Each player gets 3 blind cards, chooses 3 face-up cards from their opening hand, then redraws to the hand minimum.
- Opening play must be a 4.
- 2 resets the pile and can be played anytime after the opener.
- 3 is invisible and can be played anytime after the opener.
- 7 reverses the next requirement to 7 or lower, but must be played in order.
- 8 skips the next player, but must be played in order.
- Four identical ranks in a row burn the pile, and the player who burns it plays again.
- Players finish hand cards, then table stacks. Playing a face-up card unlocks the blind card underneath that specific stack.
- The last player left with cards is the Poopyhead.
