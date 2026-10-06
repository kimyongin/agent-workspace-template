// Experiment-owned identity is durable before any remote mutation.
import { randomUUID } from 'node:crypto';
export async function createOwnedUser(journal, save, admin) {
  if (journal.authCreated) return;
  journal.authUserId ??= randomUUID();
  journal.authEmail ??= `${journal.marker}@fixture.invalid`;
  journal.authPassword ??= randomUUID() + randomUUID();
  await save();
  const { data, error } = await admin.auth.admin.createUser({ id: journal.authUserId, email: journal.authEmail, password: journal.authPassword, email_confirm: true });
  if (error || data?.user?.id !== journal.authUserId) throw new Error('Own synthetic identity creation failed; raw auth data omitted');
  journal.authCreated = true; await save();
}
export async function deleteOwnedUser(journal, save, admin) {
  if (!journal.authUserId || journal.authDeleted) return;
  if (journal.authEmail !== `${journal.marker}@fixture.invalid`) throw new Error('Synthetic identity ownership mismatch');
  await save();
  const { error } = await admin.auth.admin.deleteUser(journal.authUserId);
  if (error && error.status !== 404) throw new Error('Own synthetic identity cleanup failed; raw auth data omitted');
  journal.authDeleted = true; delete journal.authPassword; await save();
}
