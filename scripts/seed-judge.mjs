// Seeds (or re-checks) the judges' fallback account on the live site, through the app's own API:
// account → "Sam's Barbershop" project → demo connection on → planner stack approved (sets the budget) →
// booking page proposed and approved. Safe to re-run: every step checks what already exists.
// Credits are NOT seeded: credits only come from verified PayPal orders, so judges buy a sandbox pack themselves.
//
// Usage: node scripts/seed-judge.mjs [base-url]   (default https://kitpier.com)
// The password is generated once and kept in .env.judge (gitignored, mode 600). It is never printed.
import { randomBytes } from "node:crypto";
import { chmodSync, existsSync, readFileSync, writeFileSync } from "node:fs";

const BASE = (process.argv[2] ?? "https://kitpier.com").replace(/\/$/, "");
const FILE = new URL("../.env.judge", import.meta.url);
const EMAIL = "judge@kitpier.com";
const H = { Origin: BASE, "Content-Type": "application/json" };
let cookie = "";

async function call(method, path, body) {
  const r = await fetch(BASE + path, { method, headers: { ...H, ...(cookie ? { Cookie: cookie } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const set = r.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
  if (set) cookie = set;
  const json = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`${method} ${path} → ${r.status} ${json.error ?? ""}`);
  return json;
}
const step = (msg) => console.log(`✓ ${msg}`);

// 1. Account
let password;
if (existsSync(FILE)) {
  password = /^JUDGE_PASSWORD=(.+)$/m.exec(readFileSync(FILE, "utf8"))?.[1];
  await call("POST", "/api/auth/login", { email: EMAIL, password });
  step(`signed in as ${EMAIL}`);
} else {
  password = randomBytes(15).toString("base64url");
  writeFileSync(FILE, `# Kitpier judge account (for the Devpost private testing field)\nJUDGE_EMAIL=${EMAIL}\nJUDGE_PASSWORD=${password}\n`, { mode: 0o600 });
  chmodSync(FILE, 0o600);
  await call("POST", "/api/auth/signup", { email: EMAIL, name: "Kitpier Judge", password });
  step(`created ${EMAIL} (password saved to .env.judge)`);
}

// 2. Project
const { projects } = await call("GET", "/api/projects");
let project = projects.find((p) => p.name === "Sam's Barbershop");
if (!project) {
  project = await call("POST", "/api/projects", {
    name: "Sam's Barbershop",
    description: "A booking page for my barbershop that emails customers a confirmation. Budget $30 a month.",
  });
  step("created project Sam's Barbershop");
} else step("project Sam's Barbershop exists");
const pid = project.id;

// 3. Demo connection (judges need no Supabase or Resend of their own)
const p = await call("GET", `/api/projects/${pid}`);
if (!p.demoAvailable) throw new Error("The demo connection isn't configured on this server");
if (!p.demo) await call("POST", `/api/projects/${pid}/demo`, { on: true });
step("demo connection on");

// 4. Planner stack, approved (sets the monthly budget the booking page spends against)
let plan = await call("GET", `/api/projects/${pid}/plan`);
if (!plan.proposals.some((x) => x.status === "approved")) {
  if (!plan.proposals.some((x) => x.status === "proposed"))
    plan = await call("POST", `/api/projects/${pid}/plan`, { message: "A booking page for my barbershop that emails customers a confirmation. Budget $30 a month." });
  const proposal = plan.proposals.find((x) => x.status === "proposed");
  if (!proposal) throw new Error("The planner didn't propose a stack; open the project and ask it once");
  await call("POST", `/api/projects/${pid}/stack/approve`, { proposalId: proposal.id });
  step("stack approved (budget set)");
} else step("stack already approved");

// 5. Booking page, approved
let w = await call("GET", `/api/projects/${pid}/widget`);
if (!w.widget) {
  if (w.action?.status !== "pending")
    w = await call("POST", `/api/projects/${pid}/widget`, { business_name: "Sam's Barbershop", services: ["Haircut", "Beard trim"], timezone: "America/Los_Angeles" });
  await call("POST", `/api/actions/${w.action.id}/approve`, {});
  w = await call("GET", `/api/projects/${pid}/widget`);
  step("booking page approved");
} else step("booking page exists");

console.log(`\nJudge project: ${BASE}/projects/${pid}\nBooking page:  ${BASE}/r/${w.widget.id}\nCredits: none yet. The judge buys a sandbox pack with PayPal (that's the demo).`);
