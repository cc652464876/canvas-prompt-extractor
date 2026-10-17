'use strict';
function completeness(
  snapshot,
  {
    unsupportedNodes = [],
    unreadableTextCount = 0,
    partialTextCount = 0,
    parserWarningCount = 0
  } = {}
) {
  const issues = [];
  if (snapshot.expectedNodes != null && (snapshot.nodes || []).length !== snapshot.expectedNodes)
    issues.push('NODE_COUNT_MISMATCH');
  if (snapshot.expectedEdges != null && (snapshot.edges || []).length !== snapshot.expectedEdges)
    issues.push('EDGE_COUNT_MISMATCH');
  if (unsupportedNodes.length) issues.push('UNSUPPORTED_NODES');
  if (unreadableTextCount || partialTextCount) issues.push('UNREADABLE_TEXT');
  if (parserWarningCount) issues.push('UNRESOLVED_GENERATION_PARTS');
  return {
    completeness: issues.length
      ? 'partial'
      : snapshot.expectedNodes != null && snapshot.expectedEdges != null
        ? 'complete'
        : 'unverified',
    completenessIssues: issues,
    unsupportedNodes
  };
}
module.exports = { completeness };
