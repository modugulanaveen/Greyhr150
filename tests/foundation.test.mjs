import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
const read = (path) =>
  readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
test("workspaces and environment templates exist", () => {
  for (const p of [
    "package.json",
    "apps/web/package.json",
    "apps/api/package.json",
    "apps/web/.env.example",
    "apps/api/.env.example",
    "README.md",
  ])
    assert.ok(existsSync(new URL(`../${p}`, import.meta.url)), p);
});
test("backend verifies bearer token and scopes membership", () => {
  assert.match(
    read("apps/api/src/middleware/auth.ts"),
    /auth\.getUser\(token\)/,
  );
  assert.match(
    read("apps/api/src/routes/companies.ts"),
    /\.eq\('user_id', req\.userId!\)/,
  );
  assert.match(read("apps/api/src/routes/companies.ts"), /maybeSingle\(\)/);
});
test("schema includes RLS, membership, atomic onboarding and revoked public RPC", () => {
  const sql = read("supabase/migrations/202609300001_phase1_foundation.sql");
  for (const pattern of [
    /create table public\.companies/,
    /create table public\.company_members/,
    /enable row level security/g,
    /create function public\.create_company_for_user/,
    /revoke all on function/,
    /grant execute on function/,
  ])
    assert.match(sql, pattern);
});
test("frontend contains real auth, onboarding and dashboard routes", () => {
  const app = read("apps/web/src/App.tsx");
  for (const path of [
    "/login",
    "/register",
    "/onboarding",
    "/dashboard",
    "/settings",
  ])
    assert.ok(app.includes(path), path);
  assert.match(read("apps/web/src/pages/Auth.tsx"), /signInWithPassword/);
  assert.match(read("apps/web/src/pages/Auth.tsx"), /auth\.signUp/);
  assert.match(read("apps/web/src/pages/Onboarding.tsx"), /api\('\/companies'/);
});
test("local secret env files are ignored", () => {
  const ignore = readFileSync(
    new URL("../.gitignore", import.meta.url),
    "utf8",
  );
  assert.match(ignore, /^\.env\.\*$/m);
  assert.match(ignore, /^!\.env\.example$/m);
  assert.ok(existsSync(new URL("../apps/api/.env.example", import.meta.url)));
  assert.ok(existsSync(new URL("../apps/web/.env.example", import.meta.url)));
});
