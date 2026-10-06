// Supplemental native-event evidence for dynamic or relative command paths.
// Full exact canonical file, normalized line endings only; no text is persisted.
export function hasCompletedSharedSkillOutput(item, canonicalSkill) {
  return item?.type === 'command_execution' && item.status === 'completed' && item.exit_code === 0 && typeof item.aggregated_output === 'string' && typeof canonicalSkill === 'string' && canonicalSkill.length > 0 && item.aggregated_output.replaceAll('\r\n', '\n').includes(canonicalSkill.replaceAll('\r\n', '\n'));
}
