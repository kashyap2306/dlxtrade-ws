// Redis is completely disabled - no connections, no errors, no logs
// This file exists only to maintain compatibility with imports

export function getRedis(): null {
  return null;
}

export async function initRedis(): Promise<void> {
  // Redis is disabled - resolve immediately without any action
  return Promise.resolve();
}

