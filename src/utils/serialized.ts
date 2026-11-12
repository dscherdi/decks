/** Runs one call of `task` at a time; calls made while one runs share the run after it. */
export function serialized(task: () => Promise<void>): () => Promise<void> {
  let running: Promise<void> | null = null;
  let queued: Promise<void> | null = null;

  const run = (): Promise<void> => {
    if (!running) {
      const current = task().finally(() => {
        if (running === current) running = null;
      });
      running = current;
      return current;
    }
    if (!queued) {
      queued = running
        .catch(() => {})
        .then(() => {
          queued = null;
          return run();
        });
    }
    return queued;
  };

  return run;
}
