'use strict';
class TaskScope {
  constructor() {
    this.sequence = 0;
    this.current = null;
  }
  begin(platform, url) {
    if (this.current)
      throw Object.assign(new Error('已有任务运行中，请先取消或等待完成。'), { code: 'TASK_BUSY' });
    return (this.current = {
      id: ++this.sequence,
      platform,
      url,
      cancelled: false,
      controller: new AbortController(),
      childAudio: []
    });
  }
  ensure(token) {
    if (this.current !== token || token.cancelled || token.controller.signal.aborted)
      throw Object.assign(new Error('任务已取消。'), { code: 'READ_CANCELLED' });
    if (token.navigation?.error) throw token.navigation.error;
  }
  cancel() {
    if (this.current) {
      this.current.cancelled = true;
      this.current.controller.abort();
      this.current.window?.webContents.stop();
    }
  }
  finish(token) {
    if (this.current === token) this.current = null;
  }
}
module.exports = { TaskScope };
