// One local run owns observation, acquisition and teardown; external effects live in the CLI adapter.
export async function runLocalChecks(adapter, { checks, source, signal, timeoutMs = 120_000 }) {
  const results = [], errors = [];
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
      if (state.state === 'ready') return;
      if (state.state !== 'starting' || adapter.now() >= until || (child && !adapter.childRunning(child))) {
        throw new Error('Local runtime did not become ready');
      }
      await adapter.pause(signal);
      state = await adapter.observe(signal);
    }
  };
  try {
    interrupted();
    let state = await adapter.observe(signal);
    if (state.state === 'absent') {
      const prepared = await adapter.prepare(signal);
      results.push({ label: 'setup', ...prepared });
      interrupted();
      if (prepared.code !== 0) throw new Error('Local preparation failed');
      // Setup may reveal an independently started runtime. Never spawn over it.
      state = await adapter.observe(signal);
      if (state.state === 'absent') {
        child = await adapter.start(signal);
        runtime = 'owned';
        state = await adapter.observe(signal);
        // Absence immediately after our spawn is a startup observation, not permission to respawn.
        if (state.state === 'absent') state = { ...state, state: 'starting' };
      }
    }
    await ready(state);
    if (child && !ownedContainer) throw new Error('New runtime ownership could not be confirmed');
    for (const label of checks) {
      interrupted();
      const result = await adapter.run(label, signal);
      results.push({ label, ...result });
      if (result.interrupted) break;
    }
  } catch (error) {
    errors.push({ phase: 'execution', error });
  } finally {
    if (child || ownedContainer) {
      // Stop only our child, and only the exact nonce-proven, source-bound container ID.
      let current;
      try { current = await adapter.observe(); capture(current); }
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
  return { runtime, results, errors, exitCode: stopped ? (signal?.reason === 'SIGTERM' ? 143 : 130) : errors.length || results.some(r => r.code !== 0) ? 1 : 0 };
}
