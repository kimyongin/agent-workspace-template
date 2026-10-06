// One local run owns observation, acquisition and teardown; external effects live in the CLI adapter.
export async function runLocalChecks(adapter, { checks, source, signal, timeoutMs = 120_000 }) {
  const results = [], errors = [];
  let runtime = 'borrowed', child, ownedContainer;
  const interrupted = () => {
    if (signal?.aborted) throw new Error('Local run interrupted');
  };
  const capture = state => {
    const c = state.container;
    if (child && c && c.createdAt >= child.startedAt && c.source === source && adapter.childRunning(child)) {
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
      const preparedContainer = prepared.createdContainer;
      if (preparedContainer && preparedContainer.createdAt >= prepared.startedAt && preparedContainer.source === source) {
        ownedContainer = preparedContainer;
        runtime = 'owned';
      }
      interrupted();
      if (prepared.code !== 0) throw new Error('Local preparation failed');
      // Setup may reveal an independently started runtime. Never spawn over it.
      state = await adapter.observe(signal);
      if (ownedContainer) {
        if (state.container?.id !== ownedContainer.id) throw new Error('Prepared runtime identity changed');
        // Supabase start can create an Edge container before setup writes function env.
        // Replace only that exact owned container, so serve reads the completed env.
        await adapter.stopContainer(ownedContainer.id);
        ownedContainer = undefined;
        state = await adapter.observe(signal);
      }
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
      // Stop only our child, and only the exact newly-created, source-bound container ID.
      let current;
      try { current = await adapter.observe(); capture(current); }
      catch (error) { errors.push({ phase: 'ownership', error }); }
      try { if (child) await adapter.stopChild(child); }
      catch (error) { errors.push({ phase: 'child-cleanup', error }); }
      if (current?.container) {
        if (ownedContainer && current.container.id === ownedContainer.id) {
          try { await adapter.stopContainer(ownedContainer.id); }
          catch (error) { errors.push({ phase: 'container-cleanup', error }); }
        } else errors.push({ phase: 'ownership', error: new Error('Unproven container left untouched') });
      }
    }
  }
  const stopped = signal?.aborted || results.some(r => r.interrupted);
  return { runtime, results, errors, exitCode: stopped ? (signal?.reason === 'SIGTERM' ? 143 : 130) : errors.length || results.some(r => r.code !== 0) ? 1 : 0 };
}
