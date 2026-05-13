import { readFile, writeFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
import type { Database, Job, Settings, JobListing, ListingsCache, ScoreCacheEntry, ListingFlag, ListingFlagEntry } from './types';

const DATA_DIR = path.join(process.cwd(), 'data');
const DB_PATH = path.join(DATA_DIR, 'db.json');

// Simple mutex to prevent concurrent writes corrupting the file
let writeLock: Promise<void> = Promise.resolve();

const DEFAULT_DB: Database = {
  settings: {
    baseResumeFileName: null,
    baseResumeText: null,
    userName: '',
    preferredRoles: [],
    preferredLevels: [],
    preferredLocations: [],
    workMode: [],
    salaryMin: null,
    salaryMax: null,
    salaryBaseMin: null,
    salaryBaseMax: null,
    salaryBonusMin: null,
    salaryBonusMax: null,
    salaryEquityMin: null,
    salaryEquityMax: null,
    salarySkipped: false,
    onboardingComplete: false,
    excludedCompanies: [],
  },
  jobs: [],
  listingsCache: {
    listings: [],
    lastFetchedAt: null,
    fetchErrors: [],
  },
};

async function ensureDataDir() {
  if (!existsSync(DATA_DIR)) {
    await mkdir(DATA_DIR, { recursive: true });
  }
}

export async function readDb(): Promise<Database> {
  await ensureDataDir();
  if (!existsSync(DB_PATH)) {
    await writeFile(DB_PATH, JSON.stringify(DEFAULT_DB, null, 2));
    return structuredClone(DEFAULT_DB);
  }
  const raw = await readFile(DB_PATH, 'utf-8');
  const db = JSON.parse(raw) as Database;
  // Ensure listingsCache exists (migration for old DBs)
  if (!db.listingsCache) {
    db.listingsCache = { listings: [], lastFetchedAt: null, fetchErrors: [] };
  }
  // Merge in any missing settings fields from defaults (migration for old DBs)
  db.settings = { ...DEFAULT_DB.settings, ...db.settings };
  return db;
}

export async function writeDb(db: Database): Promise<void> {
  await ensureDataDir();
  // Serialize writes to prevent concurrent corruption
  const prev = writeLock;
  let resolve: () => void;
  writeLock = new Promise<void>(r => { resolve = r; });
  await prev;
  try {
    await writeFile(DB_PATH, JSON.stringify(db, null, 2));
  } finally {
    resolve!();
  }
}

// Jobs
export async function getJobs(): Promise<Job[]> {
  const db = await readDb();
  return db.jobs;
}

export async function getJob(id: string): Promise<Job | null> {
  const db = await readDb();
  return db.jobs.find((j) => j.id === id) ?? null;
}

export async function addJob(job: Job): Promise<Job> {
  const db = await readDb();
  db.jobs.push(job);
  await writeDb(db);
  return job;
}

export async function updateJob(id: string, updates: Partial<Job>): Promise<Job | null> {
  const db = await readDb();
  const idx = db.jobs.findIndex((j) => j.id === id);
  if (idx === -1) return null;
  db.jobs[idx] = { ...db.jobs[idx], ...updates };
  await writeDb(db);
  return db.jobs[idx];
}

export async function deleteJob(id: string): Promise<boolean> {
  const db = await readDb();
  const before = db.jobs.length;
  db.jobs = db.jobs.filter((j) => j.id !== id);
  if (db.jobs.length === before) return false;
  await writeDb(db);
  return true;
}

// Settings
export async function getSettings(): Promise<Settings> {
  const db = await readDb();
  return db.settings;
}

export async function updateSettings(updates: Partial<Settings>): Promise<Settings> {
  const db = await readDb();
  db.settings = { ...db.settings, ...updates };
  await writeDb(db);
  return db.settings;
}

// Listings Cache
export async function getListingsCache(): Promise<ListingsCache> {
  const db = await readDb();
  return db.listingsCache;
}

export async function saveListingsCache(cache: ListingsCache): Promise<void> {
  const db = await readDb();
  db.listingsCache = cache;
  await writeDb(db);
}

export async function getListingById(id: string): Promise<JobListing | null> {
  const db = await readDb();
  return db.listingsCache.listings.find((l) => l.id === id) ?? null;
}

/**
 * Patch a single listing in the cache with new salary fields. Used
 * by detail-fetch routes so that subsequent salary-intel cohort
 * computations have a larger sample. No-op if any field is null AND
 * the listing already has a value (we never overwrite known salary
 * with null).
 */
export async function updateListingSalary(
  id: string,
  patch: { salary?: string | null; salaryMin?: number | null; salaryMax?: number | null },
): Promise<void> {
  const db = await readDb();
  const idx = db.listingsCache.listings.findIndex((l) => l.id === id);
  if (idx === -1) return;
  const cur = db.listingsCache.listings[idx];
  const next: JobListing = {
    ...cur,
    salary: patch.salary ?? cur.salary,
    salaryMin: patch.salaryMin ?? cur.salaryMin,
    salaryMax: patch.salaryMax ?? cur.salaryMax,
  };
  // Only write if something actually changed — avoids unnecessary
  // disk IO when detail-fetch returns the same data we already have.
  if (
    next.salary === cur.salary &&
    next.salaryMin === cur.salaryMin &&
    next.salaryMax === cur.salaryMax
  ) {
    return;
  }
  db.listingsCache.listings[idx] = next;
  await writeDb(db);
}

// Score Cache
export async function getScoreCache(): Promise<Record<string, ScoreCacheEntry>> {
  const db = await readDb();
  return db.scoreCache ?? {};
}

export async function saveScore(entry: ScoreCacheEntry): Promise<void> {
  const db = await readDb();
  if (!db.scoreCache) db.scoreCache = {};
  db.scoreCache[entry.listingId] = entry;
  await writeDb(db);
}

export async function getScore(listingId: string): Promise<ScoreCacheEntry | null> {
  const db = await readDb();
  return db.scoreCache?.[listingId] ?? null;
}

export async function saveScoresBatch(entries: ScoreCacheEntry[]): Promise<void> {
  const db = await readDb();
  if (!db.scoreCache) db.scoreCache = {};
  for (const entry of entries) {
    db.scoreCache[entry.listingId] = entry;
  }
  await writeDb(db);
}

// Listing Flags
export async function getListingFlags(): Promise<Record<string, ListingFlagEntry>> {
  const db = await readDb();
  return db.listingFlags ?? {};
}

export async function setListingFlag(listingId: string, flag: ListingFlag): Promise<ListingFlagEntry> {
  const db = await readDb();
  if (!db.listingFlags) db.listingFlags = {};
  const entry: ListingFlagEntry = { listingId, flag, flaggedAt: new Date().toISOString() };
  db.listingFlags[listingId] = entry;
  await writeDb(db);
  return entry;
}

export async function clearListingFlag(listingId: string): Promise<boolean> {
  const db = await readDb();
  if (!db.listingFlags || !db.listingFlags[listingId]) return false;
  delete db.listingFlags[listingId];
  await writeDb(db);
  return true;
}
