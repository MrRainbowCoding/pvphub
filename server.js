const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const root = __dirname;
const dataDir = path.join(root, "data");
const usersFile = path.join(dataDir, "users.json");
const leaderboardFile = path.join(dataDir, "leaderboards.json");
const sessions = new Map();
const port = Number(process.env.PORT) || 3000;

function readJson(file) { return JSON.parse(fs.readFileSync(file, "utf8")); }
function writeJson(file, value) { fs.writeFileSync(file, JSON.stringify(value, null, 2) + "\n"); }
function passwordHash(password, salt = crypto.randomBytes(16).toString("hex")) { return `scrypt$${salt}$${crypto.scryptSync(password, salt, 64).toString("hex")}`; }
function passwordMatches(password, stored) { const [, salt, expected] = stored.split("$"); const actual = crypto.scryptSync(password, salt, 64).toString("hex"); return crypto.timingSafeEqual(Buffer.from(actual, "hex"), Buffer.from(expected, "hex")); }
function ensureMaster() { const users = readJson(usersFile); if (!users.some(user => user.role === "master")) { users.push({ username: "admin", role: "master", password: passwordHash(process.env.MASTER_PASSWORD || "change-me-please") }); writeJson(usersFile, users); console.log("Master account: admin / change-me-please (set MASTER_PASSWORD in production)"); } }
function send(response, status, body, headers = {}) { response.writeHead(status, { "Content-Type": "application/json; charset=utf-8", ...headers }); response.end(JSON.stringify(body)); }
function userFromRequest(request) { const cookie = request.headers.cookie || ""; const token = cookie.split(";").map(item => item.trim()).find(item => item.startsWith("session="))?.slice(8); return token ? sessions.get(token) : null; }
function body(request) { return new Promise((resolve, reject) => { let text = ""; request.on("data", chunk => text += chunk); request.on("end", () => { try { resolve(JSON.parse(text || "{}")); } catch (error) { reject(error); } }); }); }
function requireRole(request, response, roles) { const user = userFromRequest(request); if (!user || !roles.includes(user.role)) { send(response, 401, { error: "Authentication required" }); return null; } return user; }
function serveFile(request, response) { const requested = request.url === "/" ? "/index.html" : request.url.split("?")[0]; const file = path.join(root, "public", path.normalize(requested)); if (!file.startsWith(path.join(root, "public")) || !fs.existsSync(file)) return send(response, 404, { error: "Not found" }); const types = { ".html": "text/html", ".css": "text/css", ".js": "text/javascript" }; response.writeHead(200, { "Content-Type": types[path.extname(file)] || "application/octet-stream" }); fs.createReadStream(file).pipe(response); }

ensureMaster();
const server = http.createServer(async (request, response) => {
  try {
    const url = new URL(request.url, `http://${request.headers.host}`);
    if (url.pathname === "/api/leaderboards" && request.method === "GET") return send(response, 200, readJson(leaderboardFile));
    if (url.pathname === "/api/me" && request.method === "GET") return send(response, 200, { user: userFromRequest(request) });
    if (url.pathname === "/api/login" && request.method === "POST") { const input = await body(request); const user = readJson(usersFile).find(item => item.username === input.username); if (!user || !passwordMatches(input.password || "", user.password)) return send(response, 401, { error: "Invalid username or password" }); const token = crypto.randomBytes(32).toString("hex"); sessions.set(token, { username: user.username, role: user.role }); return send(response, 200, { user: { username: user.username, role: user.role } }, { "Set-Cookie": `session=${token}; HttpOnly; SameSite=Strict; Path=/` }); }
    if (url.pathname === "/api/logout" && request.method === "POST") { const token = (request.headers.cookie || "").match(/session=([^;]+)/)?.[1]; if (token) sessions.delete(token); return send(response, 200, { ok: true }, { "Set-Cookie": "session=; Max-Age=0; Path=/" }); }
    if (url.pathname === "/api/me/password" && request.method === "PATCH") { const sessionUser = requireRole(request, response, ["master"]); if (!sessionUser) return; const input = await body(request); if ((input.newPassword || "").length < 8) return send(response, 400, { error: "New password must be at least 8 characters" }); const users = readJson(usersFile); const user = users.find(item => item.username === sessionUser.username); if (!user || !passwordMatches(input.currentPassword || "", user.password)) return send(response, 401, { error: "Current password is incorrect" }); user.password = passwordHash(input.newPassword); writeJson(usersFile, users); return send(response, 200, { ok: true }); }
    if (url.pathname === "/api/accounts" && request.method === "GET") { if (!requireRole(request, response, ["master"])) return; return send(response, 200, readJson(usersFile).map(({ username, role }) => ({ username, role }))); }
    if (url.pathname === "/api/editors" && request.method === "GET") { if (!requireRole(request, response, ["master"])) return; return send(response, 200, readJson(usersFile).filter(user => user.role === "editor").map(({ username, role }) => ({ username, role }))); }
    if (url.pathname === "/api/editors" && request.method === "POST") { if (!requireRole(request, response, ["master"])) return; const input = await body(request); if (!/^[a-zA-Z0-9_-]{3,30}$/.test(input.username || "") || (input.password || "").length < 8) return send(response, 400, { error: "Username must be 3-30 characters and password at least 8" }); const users = readJson(usersFile); if (users.some(user => user.username === input.username)) return send(response, 409, { error: "Username already exists" }); users.push({ username: input.username, role: "editor", password: passwordHash(input.password) }); writeJson(usersFile, users); return send(response, 201, { username: input.username, role: "editor" }); }
    const editorMatch = url.pathname.match(/^\/api\/editors\/([^/]+)$/);
    if (editorMatch && request.method === "DELETE") { if (!requireRole(request, response, ["master"])) return; writeJson(usersFile, readJson(usersFile).filter(user => user.username !== decodeURIComponent(editorMatch[1]))); return send(response, 200, { ok: true }); }
    const passwordMatch = url.pathname.match(/^\/api\/accounts\/([^/]+)\/password$/);
    if (passwordMatch && request.method === "PATCH") { const sessionUser = requireRole(request, response, ["master"]); if (!sessionUser) return; const username = decodeURIComponent(passwordMatch[1]); if (username === sessionUser.username) return send(response, 403, { error: "Use the admin password form to change this password" }); const input = await body(request); if ((input.password || "").length < 8) return send(response, 400, { error: "Password must be at least 8 characters" }); const users = readJson(usersFile); const user = users.find(item => item.username === username); if (!user || user.role !== "editor") return send(response, 404, { error: "Editor account not found" }); user.password = passwordHash(input.password); writeJson(usersFile, users); return send(response, 200, { username, ok: true }); }
    if (url.pathname.startsWith("/api/")) return send(response, 404, { error: "API route not found" });
    return serveFile(request, response);
  } catch (error) { console.error(error); send(response, 500, { error: "Server error" }); }
});
server.listen(port, () => console.log(`PVP Hub running at http://localhost:${port}`));