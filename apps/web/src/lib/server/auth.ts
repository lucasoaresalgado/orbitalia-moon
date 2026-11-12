// Single-user authentication (scope §6): an argon2id password hash from the
// environment and a session cookie. The cookie holds a random token; the
// database keeps only its SHA-256, so a database dump holds no live session.
import { createHash, randomBytes } from "node:crypto";
import { verify } from "@node-rs/argon2";
import type { Cookies } from "@sveltejs/kit";
import { sessions, eq, lte } from "@miniasys/db";
import { db, server } from "./db.ts";

export const COOKIE = "miniasys_session";
const DAYS = 30;
const hashToken = (t: string) => createHash("sha256").update(t).digest("hex");

const attempts: number[] = [];

/** A little friction against guessing: 10 password tries a minute for the whole app (login and token exchange). */
export function tooManyAttempts(): boolean {
  const now = Date.now();
  while (attempts.length && now - attempts[0]! > 60_000) attempts.shift();
  if (attempts.length >= 10) return true;
  attempts.push(now);
  return false;
}

export async function checkPassword(password: string): Promise<boolean> {
  const h = server().config.passwordHash;
  if (!h) return false;
  try {
    return await verify(h, password);
  } catch {
    return false;
  }
}

export async function createSession(cookies: Cookies, secure: boolean) {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + DAYS * 86_400_000);
  await db().insert(sessions).values({ id: hashToken(token), expiresAt });
  await db().delete(sessions).where(lte(sessions.expiresAt, new Date()));
  cookies.set(COOKIE, token, { path: "/", httpOnly: true, sameSite: "strict", secure, expires: expiresAt });
}

export async function validSession(token: string | undefined): Promise<boolean> {
  if (!token) return false;
  const [row] = await db().select().from(sessions).where(eq(sessions.id, hashToken(token)));
  return !!row && row.expiresAt > new Date();
}

export async function destroySession(cookies: Cookies) {
  const token = cookies.get(COOKIE);
  if (token) await db().delete(sessions).where(eq(sessions.id, hashToken(token)));
  cookies.delete(COOKIE, { path: "/" });
}
