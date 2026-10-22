'use strict';
const path = require('node:path');
const { spawn } = require('node:child_process');
const { ROOT } = require('../app-paths.cjs');

const EXECUTABLE = path.join(ROOT, 'tools', 'exiftool', 'exiftool.exe');
class ExifToolReader {
  constructor({ executable = EXECUTABLE, timeout = 45000, env = process.env } = {}) {
    Object.assign(this, { executable, timeout, env });
    this.tail = Promise.resolve();
    this.sequence = 0;
    this.closed = false;
  }
  start() {
    if (this.closed) throw new Error('图片信息读取已停止。');
    if (this.child) return;
    // No shell, user Perl configuration, external PATH, or visible helper window.
    const child = spawn(this.executable, ['-config', '', '-stay_open', 'True', '-@', '-'], {
      cwd: path.dirname(this.executable),
      windowsHide: true,
      env: { ...this.env, LC_ALL: 'C', LC_CTYPE: 'C', LANG: 'C' },
      stdio: ['pipe', 'pipe', 'pipe']
    });
    this.child = child;
    this.output = '';
    this.errors = '';
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      if (child !== this.child) return;
      this.output += chunk;
      if (Buffer.byteLength(this.output) > 32 * 1024 * 1024) {
        this.fail(new Error('图片元数据过大，请单独读取此图片。'), child);
        return;
      }
      const pending = this.pending;
      if (!pending) return;
      const marker = '{ready' + pending.id + '}',
        index = this.output.indexOf(marker);
      if (index < 0) return;
      const output = this.output.slice(0, index).trim();
      this.output = this.output.slice(index + marker.length).trimStart();
      this.pending = null;
      clearTimeout(pending.timer);
      try {
        if (pending.text) {
          if (!output) throw new Error('No metadata output');
          pending.resolve(output);
          return;
        }
        const data = JSON.parse(output);
        if (!Array.isArray(data)) throw new Error('图片信息格式无效。');
        pending.resolve(data);
      } catch {
        pending.reject(new Error('无法解析图片信息。' + this.errors.slice(-300)));
      }
    });
    child.stderr.on('data', (chunk) => {
      this.errors = (this.errors + chunk.toString('utf8')).slice(-4000);
    });
    child.stdin.on('error', (error) => this.fail(error, child));
    child.on('error', () =>
      this.fail(new Error('内置 ExifTool 无法启动，请完整复制 tools/exiftool 目录。'), child)
    );
    child.on('exit', () => this.fail(new Error('图片信息读取进程已退出。'), child));
  }
  fail(error, child = this.child) {
    if (child !== this.child) return;
    this.child = null;
    const pending = this.pending;
    this.pending = null;
    if (pending) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    child?.stdin.destroy();
    child?.kill();
  }
  read(files) {
    return this.execute(files);
  }
  readText(files) {
    return this.execute(files, true);
  }
  execute(files, text = false) {
    const next = this.tail
      .catch(() => {})
      .then(() => {
        if (!files.length) return [];
        if (files.some((file) => !path.isAbsolute(file) || /[\r\n\0]/.test(file)))
          throw new Error('图片文件路径无效。');
        this.start();
        return new Promise((resolve, reject) => {
          const id = ++this.sequence;
          this.pending = {
            id,
            text,
            resolve,
            reject,
            timer: setTimeout(
              () => this.fail(new Error('图片信息读取超时，可重试。')),
              this.timeout
            )
          };
          this.errors = '';
          this.child.stdin.write(
            [
              ...(text ? [] : ['-j', '-G1:3:4', '-a', '-s', '-struct', '-n']),
              '-charset',
              'filename=utf8',
              ...files,
              '-execute' + id,
              ''
            ].join('\n')
          );
        });
      });
    this.tail = next;
    return next;
  }
  async close() {
    this.closed = true;
    const child = this.child;
    if (child) {
      await new Promise((resolve) => {
        const timer = setTimeout(() => this.fail(new Error('程序已关闭。'), child), 2000);
        child.once('close', () => {
          clearTimeout(timer);
          resolve();
        });
        child.stdin.end('-stay_open\nFalse\n');
      });
    }
    await this.tail.catch(() => {});
  }
}
module.exports = { ExifToolReader, EXECUTABLE };
