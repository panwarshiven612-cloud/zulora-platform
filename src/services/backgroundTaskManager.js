/**
 * backgroundTaskManager.js — Non-blocking background task runner
 * Manages long-running AI tasks (code gen, video rendering, email campaigns, computer automation)
 * so switching views or starting a new chat does not interrupt execution.
 * Dispatches browser/toast notifications upon completion.
 */

class BackgroundTaskManager {
  constructor() {
    this.tasks = new Map();
    this.listeners = new Set();
  }

  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  notify() {
    const taskList = Array.from(this.tasks.values());
    this.listeners.forEach(fn => fn(taskList));
  }

  notifyUser(title, body) {
    try {
      if (typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'granted') {
        new Notification(title, { body, icon: '/favicon.ico' });
      }
    } catch {}
    // Dispatch custom DOM event for in-app toast notification
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('zulora-toast', { detail: { title, message: body } }));
    }
  }

  /**
   * Run a task in the background without blocking the UI
   * @param {string} type 'video' | 'code' | 'email' | 'automation' | 'generation'
   * @param {string} label Human-readable description
   * @param {(updateProgress?: (percent: number) => void) => Promise<any>} executeFn
   */
  run(type, label, executeFn) {
    const id = `task_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const task = {
      id,
      type,
      label,
      status: 'running',
      progress: 0,
      startedAt: Date.now(),
      error: null,
      result: null
    };

    this.tasks.set(id, task);
    this.notify();

    // Execute detached promise so component unmount never aborts it
    (async () => {
      try {
        const result = await executeFn(progress => {
          task.progress = progress;
          this.notify();
        });
        task.status = 'completed';
        task.result = result;
        task.completedAt = Date.now();
        this.notifyUser('Task Complete', `"${label}" has finished successfully.`);
      } catch (err) {
        task.status = 'failed';
        task.error = err.message || 'Task failed';
        this.notifyUser('Task Failed', `"${label}" encountered an error: ${task.error}`);
      } finally {
        this.notify();
        // Prune finished task after 10 minutes
        setTimeout(() => {
          this.tasks.delete(id);
          this.notify();
        }, 600_000);
      }
    })();

    return id;
  }

  getTasks() {
    return Array.from(this.tasks.values());
  }
}

export const backgroundTaskManager = new BackgroundTaskManager();
export default backgroundTaskManager;
