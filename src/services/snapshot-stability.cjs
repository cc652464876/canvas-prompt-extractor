'use strict';
const { createHash } = require('node:crypto');
function snapshotSignature(snapshot) {
  // Resource addresses and completeness declarations are part of readiness,
  // not just nodes/edges. Equal node counts alone cannot prove a stable result.
  return createHash('sha256')
    .update(
      JSON.stringify([
        snapshot.nodes,
        snapshot.edges,
        snapshot.mediaResources,
        snapshot.expectedNodes,
        snapshot.expectedEdges
      ])
    )
    .digest('hex');
}
module.exports = { snapshotSignature };
