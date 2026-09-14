export function pickCurrentNodeApproverIds(instance: {
  currentNode: number;
  flow: { nodes: { nodeOrder: number; multiType: string }[] };
  tasks: { approverId: string; nodeOrder: number; sequence: number }[];
}): string[] {
  const currentTasks = instance.tasks.filter((t) => t.nodeOrder === instance.currentNode);
  if (currentTasks.length === 0) return [];

  const node = instance.flow.nodes.find((n) => n.nodeOrder === instance.currentNode);
  if (node?.multiType === 'sequence') {
    const sorted = [...currentTasks].sort((a, b) => a.sequence - b.sequence);
    const minSeq = sorted[0]!.sequence;
    return sorted.filter((t) => t.sequence === minSeq).map((t) => t.approverId);
  }
  return currentTasks.map((t) => t.approverId);
}
