'use strict';
// Browsing tabs are independent of export/download selection.
class CanvasTabs {
  constructor() {
    this.key = null;
    this.tabs = [];
    this.activeId = null;
    this.dismissed = new Set();
    this.selected = new Set();
  }
  sync(key, works, restore = false) {
    if (this.key !== key) {
      this.key = key;
      this.tabs = [];
      this.activeId = null;
      this.dismissed.clear();
      this.selected.clear();
    }
    const chosen = new Map(works.map((w) => [w.id, w]));
    for (const id of this.selected) if (!chosen.has(id)) this.dismissed.delete(id);
    if (restore) this.dismissed.clear();
    this.selected = new Set(chosen.keys());
    const activeIndex = this.tabs.findIndex((w) => w.id === this.activeId);
    const tabs = this.tabs
      .filter((w) => chosen.has(w.id) && !this.dismissed.has(w.id))
      .map((w) => chosen.get(w.id));
    for (const work of works)
      if (!this.dismissed.has(work.id) && !tabs.some((w) => w.id === work.id)) tabs.push(work);
    this.tabs = tabs;
    if (!tabs.some((w) => w.id === this.activeId))
      this.activeId = tabs[Math.max(0, Math.min(activeIndex, tabs.length - 1))]?.id || null;
  }
  close(id) {
    const index = this.tabs.findIndex((w) => w.id === id);
    if (index < 0) return;
    this.dismissed.add(id);
    this.tabs.splice(index, 1);
    if (this.activeId === id)
      this.activeId = this.tabs[Math.min(index, this.tabs.length - 1)]?.id || null;
  }
  activate(id) {
    if (this.tabs.some((w) => w.id === id)) this.activeId = id;
  }
  reorder(ids) {
    if (!Array.isArray(ids) || ids.length !== this.tabs.length || new Set(ids).size !== ids.length)
      return;
    const items = new Map(this.tabs.map((w) => [w.id, w]));
    if (ids.every((id) => items.has(id))) this.tabs = ids.map((id) => items.get(id));
  }
}
module.exports = { CanvasTabs };
