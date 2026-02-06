// Copyright (c) Brian Joseph Petro

// Permission is hereby granted, free of charge, to any person obtaining
// a copy of this software and associated documentation files (the
// "Software"), to deal in the Software without restriction, including
// without limitation the rights to use, copy, modify, merge, publish,
// distribute, sublicense, and/or sell copies of the Software, and to
// permit persons to whom the Software is furnished to do so, subject to
// the following conditions:

// The above copyright notice and this permission notice shall be
// included in all copies or substantial portions of the Software.

// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
// EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
// MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND
// NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE
// LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION
// OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION
// WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

/**
 * @class SmartEvents
 * @description
 * A simple event emitter for the Smart Environment.
 * Provides pub/sub functionality for environment-wide events.
 */
export class SmartEvents {
  /**
   * Creates a SmartEvents instance and attaches it to the environment.
   * @param {Object} env - The environment object to attach events to
   * @param {Object} [opts={}] - Configuration options
   * @param {Function} [opts.adapter_class] - Optional adapter class for custom event handling
   * @returns {SmartEvents} The created SmartEvents instance
   */
  static create(env, opts = {}) {
    const instance = new this(env, opts);
    Object.defineProperty(env, 'events', {
      configurable: true,
      enumerable: false,
      get: () => instance,
    });
    return instance;
  }

  /**
   * @param {Object} env - The environment object
   * @param {Object} [opts={}] - Configuration options
   */
  constructor(env, opts = {}) {
    this.env = env;
    this.opts = opts;
    this._listeners = new Map();
    this._adapter = opts.adapter_class ? new opts.adapter_class(this) : null;
  }

  /**
   * Registers an event listener for a given event key.
   * @param {string} event_key - The event identifier
   * @param {Function} handler - The callback function to invoke when the event is emitted
   * @returns {Function} An unsubscribe function to remove the listener
   */
  on(event_key, handler) {
    if (!this._listeners.has(event_key)) {
      this._listeners.set(event_key, new Set());
    }
    this._listeners.get(event_key).add(handler);

    return () => this.off(event_key, handler);
  }

  /**
   * Removes an event listener for a given event key.
   * @param {string} event_key - The event identifier
   * @param {Function} handler - The callback function to remove
   */
  off(event_key, handler) {
    const listeners = this._listeners.get(event_key);
    if (listeners) {
      listeners.delete(handler);
      if (listeners.size === 0) {
        this._listeners.delete(event_key);
      }
    }
  }

  /**
   * Emits an event with the given payload.
   * Automatically adds a timestamp to the payload.
   * @param {string} event_key - The event identifier
   * @param {Object} [payload={}] - The event data
   */
  emit(event_key, payload = {}) {
    const event_data = {
      ...payload,
      at: Date.now(),
    };

    const listeners = this._listeners.get(event_key);
    if (listeners) {
      for (const handler of listeners) {
        try {
          handler(event_data);
        } catch (error) {
          console.error(`SmartEvents: Error in handler for '${event_key}':`, error);
        }
      }
    }

    if (this._adapter?.emit) {
      this._adapter.emit(event_key, event_data);
    }
  }

  /**
   * Removes all listeners for a specific event or all events.
   * @param {string} [event_key] - If provided, only removes listeners for this event
   */
  clear(event_key) {
    if (event_key) {
      this._listeners.delete(event_key);
    } else {
      this._listeners.clear();
    }
  }

  /**
   * Returns the number of listeners for a given event key.
   * @param {string} event_key - The event identifier
   * @returns {number} The number of registered listeners
   */
  listener_count(event_key) {
    return this._listeners.get(event_key)?.size || 0;
  }
}

export default SmartEvents;
