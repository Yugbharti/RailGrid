import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import dotenv from 'dotenv';

const candidates = [resolve(process.cwd(), '.env'), resolve(process.cwd(), '../../.env')];
const envPath = candidates.find((candidate) => existsSync(candidate));
if (envPath) dotenv.config({ path: envPath });
