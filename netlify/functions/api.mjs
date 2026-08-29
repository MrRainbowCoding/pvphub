import { getStore } from "@netlify/blobs";
import crypto from "node:crypto";
import leaderboardData from "../../public/data/leaderboards.json" with { type: "json" };

const sessions = new Map();
const store = getStore("pvp-hub");

function hashPassword(password, salt = crypto.randomBytes(16).toString("hex")) {
  return `scrypt$${salt}$${crypto.scryptSync(password, salt, 64).toString("hex")}`;
}
function matches(password, stored) {
  const [, salt, expected] = stored.split("$");
  const actual = crypto.scryptSync(password, salt, 64).toString("hex");
  return crypto.timingSafeEqual(Buffer.from(actual, "hex"), Buffer.from(expected, "hex"));
}
async function users() {
  let value = await store.get("users", { type: "json" });
  if (!value) {
    value = [{ username: "admin", role: "master", password: hashPassword(process.env.MASTER_PASSWORD || "change-me-please") }];
    await store.setJSON("users", value);
  }
  return value;
}
function response(statusCode, body, headers = {}) {
  return { statusCode, headers: { "content-type": "application/json; charset=utf-8", ...headers }, body: JSON.stringify(body) };
}
function currentUser(event) {
  const token = (event.headers.cookie || "").match(/session=([^;]+)/)?.[1];
  return token ? sessions.get(token) : null;
}
function requireMaster(event) {
  const user = currentUser(event);
  return user?.role === "master" ? user : null;
}
function input(event) {
  try { return JSON.parse(event.body || "{}"); } catch { return null; }
}

export async function handler(event) {
  const route = event.path.replace(/^\/\.netlify\/functions\/api/, "").replace(/^\/api/, "") || "/";
  if (route === "/leaderboards" && event.httpMethod === "GET") return response(200, leaderboardData);
  if (route === "/me" && event.httpMethod === "GET") return response(200, { user: currentUser(event) || null });
  if (route === "/login" && event.httpMethod === "POST") {
    const data = input(event); const account = (await users()).find(user => user.username === data?.username);
    if (!account || !matches(data?.password || "", account.password)) return response(401, { error: "Invalid username or password" });
    const token = crypto.randomBytes(32).toString("hex"); sessions.set(token, { username: account.username, role: account.role });
    return response(200, { user: { username: account.username, role: account.role } }, { "set-cookie": `session=${token}; HttpOnly; SameSite=Strict; Path=/` });
  }
  if (route === "/logout" && event.httpMethod === "POST") { const token = (event.headers.cookie || "").match(/session=([^;]+)/)?.[1]; if (token) sessions.delete(token); return response(200, { ok: true }, { "set-cookie": "session=; Max-Age=0; Path=/" }); }
  if (route === "/accounts" && event.httpMethod === "GET") { if (!requireMaster(event)) return response(401, { error: "Authentication required" }); return response(200, (await users()).map(({ username, role }) => ({ username, role }))); }
  if (route === "/editors" && event.httpMethod === "GET") { if (!requireMaster(event)) return response(401, { error: "Authentication required" }); return response(200, (await users()).filter(user => user.role === "editor").map(({ username, role }) => ({ username, role }))); }
  if (route === "/editors" && event.httpMethod === "POST") {
    if (!requireMaster(event)) return response(401, { error: "Authentication required" }); const data = input(event);
    if (!/^[a-zA-Z0-9_-]{3,30}$/.test(data?.username || "") || (data?.password || "").length < 8) return response(400, { error: "Username must be 3-30 characters and password at least 8" });
    const list = await users(); if (list.some(user => user.username === data.username)) return response(409, { error: "Username already exists" });
    list.push({ username: data.username, role: "editor", password: hashPassword(data.password) }); await store.setJSON("users", list); return response(201, { username: data.username, role: "editor" });
  }
  const editorMatch = route.match(/^\/editors\/([^/]+)$/);
  if (editorMatch && event.httpMethod === "DELETE") { if (!requireMaster(event)) return response(401, { error: "Authentication required" }); const username = decodeURIComponent(editorMatch[1]); await store.setJSON("users", (await users()).filter(user => user.username !== username)); return response(200, { ok: true }); }
  const passwordMatch = route.match(/^\/accounts\/([^/]+)\/password$/);
  if (passwordMatch && event.httpMethod === "PATCH") { if (!requireMaster(event)) return response(401, { error: "Authentication required" }); const username = decodeURIComponent(passwordMatch[1]); const data = input(event); if ((data?.password || "").length < 8) return response(400, { error: "Password must be at least 8 characters" }); const list = await users(); const account = list.find(user => user.username === username && user.role === "editor"); if (!account) return response(404, { error: "Editor account not found" }); account.password = hashPassword(data.password); await store.setJSON("users", list); return response(200, { username, ok: true }); }
  if (route === "/me/password" && event.httpMethod === "PATCH") { const session = requireMaster(event); if (!session) return response(401, { error: "Authentication required" }); const data = input(event); const list = await users(); const account = list.find(user => user.username === session.username); if (!account || !matches(data?.currentPassword || "", account.password)) return response(401, { error: "Current password is incorrect" }); if ((data?.newPassword || "").length < 8) return response(400, { error: "New password must be at least 8 characters" }); account.password = hashPassword(data.newPassword); await store.setJSON("users", list); return response(200, { ok: true }); }
  return response(404, { error: "API route not found" });
}
