import argon2 from 'argon2';
import { randomBytes } from 'node:crypto';

const passwordHashOptions = {
  type: 2 as const, // argon2.argon2id
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
  raw: false as const,
};

let dummyHashPromise: Promise<string> | undefined;

export function hashPassword(password: string): Promise<string> {
  return argon2.hash(password, passwordHashOptions);
}

export async function verifyPassword(hash: string, password: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, password);
  } catch {
    return false;
  }
}

export function getDummyPasswordHash(): Promise<string> {
  dummyHashPromise ??= hashPassword(randomBytes(32).toString('base64url'));
  return dummyHashPromise;
}
