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
    if (token.contents?.isDestroyed?.())
      throw Object.assign(new Error('作品标签页已关闭，请重新读取。'), {
        code: 'READ_PAGE_CLOSED'
      });
  }
  cancel() {
    if (this.current) {
      this.current.cancelled = true;
      this.current.controller.abort();
      const wc = this.current.contents || this.current.window?.webContents;
      if (wc && !wc.isDestroyed?.()) wc.stop();
    }
  }
  finish(token) {
    if (this.current === token) this.current = null;
  }
}
module.exports = { TaskScope };
