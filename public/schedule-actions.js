/* One source of truth for the small edits made from desktop Field view and Sitely Field. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.ScheduleActions = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  function subWorkDays(iso, count) {
    const d = new Date(String(iso) + 'T00:00:00Z');
    let left = Math.max(0, Math.round(Number(count)) || 0);
    while (left > 0) {
      d.setUTCDate(d.getUTCDate() - 1);
      const day = d.getUTCDay();
      if (day !== 0 && day !== 6) left--;
    }
    return d.toISOString().slice(0, 10);
  }
  function setDueDate(task, due) {
    if (!task || !/^\d{4}-\d{2}-\d{2}$/.test(String(due || ''))) return false;
    if (due === (task.finish || task.start)) return false;
    const start = subWorkDays(due, Math.max(0, (Number(task.days) || 1) - 1));
    task.fixed = start; task.start = start; task.finish = due;
    return true;
  }
  function setComplete(task, checked) {
    if (!task) return false;
    task.status = checked ? 'Complete' : 'In Progress';
    task.pct = checked ? 1 : 0.5;
    return true;
  }
  function toggleConfirmed(task) {
    if (!task) return false;
    task.confirmed = !task.confirmed;
    return true;
  }
  return { subWorkDays, setDueDate, setComplete, toggleConfirmed };
});
