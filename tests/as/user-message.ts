// A fixture for tests/user-message.test.ts: a message of the plugin's own,
// each kind of value once, to one player and to everyone.

const jump = new UserMessage("KzJump");
const tooLong = new UserMessage("KzJumpTooLong");

server.addCommand("um_one", ({ player }) => jump.byte(7).char(-5).short(300).long(100000).text("hi").entity(player).send(player));
server.addCommand("um_all", () => jump.angle(90).coord(12.5).sendAll());
server.addCommand("um_big", ({ player }) => jump.text("x".repeat(200)).send(player));
server.addCommand("um_long_name", ({ player }) => tooLong.byte(1).send(player));
