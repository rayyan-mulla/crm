// socket.js
let io;

function init(server) {
  const { Server } = require("socket.io");
  io = new Server(server, {
    cors: {
      origin: "*", // you can restrict this to your domain later
    },
  });
  return io;
}

function getIO() {
  if (!io) throw new Error("Socket.io not initialized");
  return io;
}

module.exports = { init, getIO };
