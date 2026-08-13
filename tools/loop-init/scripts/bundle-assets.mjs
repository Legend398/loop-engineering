#!/usr/bin/env node
import { cp, rm, access, rename, mkdir, rmdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REPO_ROOT = path.resolve(PACKAGE_ROOT, '../..');
const LOCK_DIR = path.join(PACKAGE_ROOT, '.bundle-assets.lock');
const RETRY_ATTEMPTS = 100;
const RETRY_MS = 50;
const WINDOWS_TRANSIENT_CODES = new Set(['EACCES', 'EBUSY', 'ENOTEMPTY', 'EPERM']);

async function exists(p) {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

async function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function isRetryable(error) {
  return error?.code === 'EEXIST' ||
    (process.platform === 'win32' && WINDOWS_TRANSIENT_CODES.has(error?.code));
}

async function replaceDirectory(src, dest) {
  const tempDest = `${dest}.tmp-${process.pid}-${Date.now()}`;
  let moved = false;
  await rm(tempDest, { recursive: true, force: true });
  try {
    await cp(src, tempDest, { recursive: true });

    for (let attempt = 0; attempt < RETRY_ATTEMPTS; attempt += 1) {
      try {
        await rm(dest, { recursive: true, force: true });
        await rename(tempDest, dest);
        moved = true;
        return;
      } catch (err) {
        if (!isRetryable(err) || attempt === RETRY_ATTEMPTS - 1) {
          throw err;
        }
        await sleep(RETRY_MS);
      }
    }
  } finally {
    if (!moved) {
      await rm(tempDest, { recursive: true, force: true });
    }
  }
}

async function releaseBundleLock() {
  for (let attempt = 0; attempt < RETRY_ATTEMPTS; attempt += 1) {
    try {
      await rmdir(LOCK_DIR);
      return;
    } catch (err) {
      if (err?.code === 'ENOENT') return;
      if (!isRetryable(err) || attempt === RETRY_ATTEMPTS - 1) throw err;
      await sleep(RETRY_MS);
    }
  }
}

async function acquireLock() {
  for (let attempt = 0; attempt < RETRY_ATTEMPTS; attempt += 1) {
    try {
      await mkdir(LOCK_DIR);
      return releaseBundleLock;
    } catch (err) {
      if (!isRetryable(err)) {
        throw err;
      }
      await sleep(RETRY_MS);
    }
  }
  throw new Error(`bundle-assets: timed out waiting for ${LOCK_DIR}`);
}

const releaseLock = await acquireLock();
try {
  for (const dir of ['starters', 'templates']) {
    const dest = path.join(PACKAGE_ROOT, dir);
    const src = path.join(REPO_ROOT, dir);
    if (!(await exists(src))) {
      throw new Error(`bundle-assets: missing ${src}`);
    }
    await replaceDirectory(src, dest);
    console.log(`bundled ${dir}/ → tools/loop-init/${dir}/`);
  }

  const registrySrc = path.join(REPO_ROOT, 'patterns', 'registry.yaml');
  const registryDest = path.join(PACKAGE_ROOT, 'registry.yaml');
  if (await exists(registrySrc)) {
    await cp(registrySrc, registryDest);
    console.log('bundled patterns/registry.yaml → tools/loop-init/registry.yaml');
  }
} finally {
  await releaseLock();
}
