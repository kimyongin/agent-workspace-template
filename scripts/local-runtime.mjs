// One local run owns observation, acquisition and teardown; external effects live in the CLI adapter.
export async function runLocalChecks(adapter, { checks, source, signal, borrowedOnly = false, timeoutMs = 120_000 }) {
  const results = [], errors = [], runtimeObservations = [];
  const started = performance.now();
  let checksStarted, cleanupStarted;
  const observe = async signal => {
    let state;
    try { state = await adapter.observe(signal); }
    catch (error) { runtimeObservations.push({ elapsedMs: performance.now() - started, state: 'observation-failed' }); throw error; }
    runtimeObservations.push({ elapsedMs: performance.now() - started, state: state.state,
      container: state.container ? { id: state.container.id, running: state.container.running, status: state.container.status, oomKilled: state.container.oomKilled, exitCode: state.container.exitCode } : null });
    return state;
  };
  let runtime = 'borrowed', child, ownedContainer;
  const interrupted = () => {
    if (signal?.aborted) throw new Error('Local run interrupted');
  };
  const capture = state => {
    const c = state.container;
    if (child && c && child.ownershipToken && c.ownershipToken === child.ownershipToken && c.source === source) {
      if (ownedContainer && ownedContainer.id !== c.id) throw new Error('Runtime identity changed');
      ownedContainer = c;
    }
  };
  const ready = async state => {
    const until = adapter.now() + timeoutMs;
    while (true) {
      interrupted();
      if (child && state.state === 'absent') state = { ...state, state: 'starting' };
      capture(state);
      if (child && !adapter.childRunning(child)) throw new Error('Owned runtime child exited before readiness');
      if (state.state === 'ready') {
        if (!child || ownedContainer && state.container?.id === ownedContainer.id
          && state.container.ownershipToken === child.ownershipToken && state.container.source === source) return;
        // Docker was read before the readiness probe. A just-created container
        // can appear between those reads; wait for a fresh, nonce-bound proof.
        if (state.container || !child.ownershipToken) throw new Error('New runtime ownership could not be confirmed');
        state = { ...state, state: 'starting' };
      }
      if (state.state !== 'starting' || adapter.now() >= until || (child && !adapter.childRunning(child))) {
        throw new Error('Local runtime did not become ready');
      }
      await adapter.pause(signal);
      state = await observe(signal);
    }
  };
  try {
    interrupted();
    let state = await observe(signal);
    if (state.state === 'absent') {
      if (borrowedOnly) throw new Error('Explicit runtime must already be running; setup and launch are disabled');
      const prepared = await adapter.prepare(signal);
      results.push({ label: 'setup', ...prepared });
      interrupted();
      if (prepared.code !== 0 || prepared.stopFailed || prepared.interrupted) throw new Error('Local preparation failed');
      // Setup may reveal an independently started runtime. Never spawn over it.
      state = await observe(signal);
      if (state.state === 'absent') {
        child = await adapter.start(signal);
        runtime = 'owned';
        state = await observe(signal);
        // Absence immediately after our spawn is a startup observation, not permission to respawn.
        if (state.state === 'absent') state = { ...state, state: 'starting' };
      }
    }
    await ready(state);
    if (child && !ownedContainer) throw new Error('New runtime ownership could not be confirmed');
    checksStarted = performance.now();
    for (const check of checks) {
      const label = typeof check === 'string' ? check : check.id;
      interrupted();
      const result = await adapter.run(check, signal);
      results.push({ label, ...result });
      if (result.interrupted || signal?.aborted) break;
      if (result.stopFailed || result.code === null) throw new Error('Check subprocess execution or cleanup failed');
      interrupted();
      const current = await observe(signal);
      capture(current);
      if (current.state !== 'ready' || child && (!adapter.childRunning(child)
        || current.container?.id !== ownedContainer?.id
        || current.container?.ownershipToken !== child.ownershipToken
        || current.container?.source !== source)) throw new Error('Local runtime lost during checks');
    }
  } catch (error) {
    errors.push({ phase: 'execution', error });
  } finally {
    cleanupStarted = performance.now();
    if (child || ownedContainer) {
      // Stop only our child, and only the exact nonce-proven, source-bound container ID.
      let current;
      try { current = await observe(); capture(current); }
      catch (error) { errors.push({ phase: 'ownership', error }); }
      try { if (child) await adapter.stopChild(child); }
      catch (error) { errors.push({ phase: 'child-cleanup', error }); }
      if (current?.container) {
        if (ownedContainer && current.container.id === ownedContainer.id && current.container.ownershipToken === child?.ownershipToken && current.container.source === source) {
          try { await adapter.stopContainer(ownedContainer.id); }
          catch (error) { errors.push({ phase: 'container-cleanup', error }); }
        } else errors.push({ phase: 'ownership', error: new Error('Unproven container left untouched') });
      }
    }
  }
  const stopped = signal?.aborted || results.some(r => r.interrupted);
  const ended = performance.now();
  const timings = { preparationMs: (checksStarted ?? cleanupStarted) - started,
    checksMs: checksStarted === undefined ? 0 : cleanupStarted - checksStarted,
    cleanupMs: ended - cleanupStarted, totalMs: ended - started };
  return { runtime, results, errors, timings, runtimeObservations, exitCode: stopped ? (signal?.reason === 'SIGTERM' ? 143 : 130) : errors.length || results.some(r => r.code !== 0) ? 1 : 0 };
}
