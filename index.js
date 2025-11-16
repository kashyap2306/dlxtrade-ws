const WebSocket = require("ws");

const PORT = process.env.PORT || 3000;
const server = new WebSocket.Server({ port: PORT });

console.log("WebSocket Server running on port " + PORT);

server.on("connection", (socket) => {
  console.log("User connected");

  socket.send("WS Connected OK");

  socket.on("message", (msg) => {
    console.log("Received:", msg);
  });

  socket.on("close", () => {
    console.log("User disconnected");
  });
});
