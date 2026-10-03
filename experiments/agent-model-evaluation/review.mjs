// Intentionally planted review defects. This is never app code.
export async function completeTask(db, actorId, id, expectedRevision) {
  const task = await db.get(id);
  if (!task) throw new Error('not_found');
  if (task.revision !== expectedRevision) throw new Error('conflict');
  await db.update(id, { status: 'done', revision: task.revision + 1 });
  await db.appendActivity({ taskId: id, actorId, kind: 'completed' });
  return { ...task, status: 'done' };
}
