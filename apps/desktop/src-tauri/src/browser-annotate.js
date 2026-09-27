/* global window, document, location, CSS, getComputedStyle, addEventListener, removeEventListener, innerWidth, innerHeight, scrollX, scrollY */
// Annotate mode, evaluated by the JAM host inside a browsed page.
//
// A click annotates the element under the pointer; a press-and-drag annotates
// the dragged region. Each capture asks for an optional comment, then leaves
// a numbered marker. Everything is drawn by the page itself because nothing
// in JAM's interface can paint above a native view. Finished annotations wait
// in a queue until the host collects them. The page can see and alter all of
// this, so JAM treats every field as page data.
(() => {
  if (window.__jamAnnotate) {
    window.__jamAnnotate.resume();
    return;
  }
  const ACCENT = '#6F9BFF';
  const DRAG = 4;

  const host = document.createElement('div');
  host.style.cssText = 'position:absolute;left:0;top:0;width:0;height:0;z-index:2147483647';
  const root = host.attachShadow({ mode: 'closed' });
  root.innerHTML = `<style>
    :host { all: initial; }
    * { box-sizing: border-box; font-family: ui-sans-serif, system-ui, sans-serif; }
    .fixed { position: fixed; pointer-events: none; }
    .box { border: 1.5px solid ${ACCENT}; background: rgb(111 155 255 / 12%); border-radius: 2px; display: none; }
    .drag { border: 1.5px dashed ${ACCENT}; background: rgb(111 155 255 / 10%); display: none; }
    .tag { font: 11px/16px ui-monospace, monospace; color: #07101F; background: #A8C3FF; padding: 1px 6px; border-radius: 4px; white-space: nowrap; display: none; }
    .marker { position: absolute; pointer-events: none; }
    .marker .outline { position: absolute; inset: 0; border: 1.5px solid ${ACCENT}; border-radius: 2px; }
    .marker.region .outline { border-style: dashed; background: rgb(111 155 255 / 8%); }
    .marker .badge { position: absolute; left: -9px; top: -9px; width: 20px; height: 20px; border-radius: 50%;
      background: ${ACCENT}; color: #07101F; border: 2px solid #0F1119; font: 700 10px/16px system-ui; text-align: center; }
    .composer { position: fixed; width: 260px; padding: 12px; border-radius: 10px; background: #14151B;
      border: 1px solid rgb(190 210 255 / 12%); box-shadow: 0 16px 40px rgb(0 0 0 / 45%); color: #E3E6EE; display: none; pointer-events: auto; }
    .composer .title { font-size: 11.5px; color: #9095A3; margin-bottom: 8px; }
    .composer textarea { width: 100%; min-height: 56px; resize: none; border: 1px solid rgb(190 210 255 / 12%);
      border-radius: 7px; background: rgb(190 210 255 / 6%); color: #E3E6EE; font-size: 13px; line-height: 18px; padding: 7px 8px; outline: none; }
    .composer textarea:focus { border-color: rgb(111 155 255 / 55%); }
    .composer .actions { display: flex; justify-content: flex-end; gap: 6px; margin-top: 10px; }
    .composer button { border: 0; border-radius: 6px; padding: 5px 10px; font-size: 12px; cursor: pointer; }
    .composer .cancel { background: transparent; color: #9095A3; }
    .composer .add { background: ${ACCENT}; color: #07101F; font-weight: 500; }
  </style>
  <div class="fixed box"></div><div class="fixed drag"></div><div class="fixed tag"></div>
  <div class="markers"></div>
  <div class="composer" role="dialog" aria-label="Annotation comment">
    <div class="title"></div>
    <textarea placeholder="What should the agent know? (optional)"></textarea>
    <div class="actions"><button class="cancel" type="button">Cancel</button><button class="add" type="button">Add</button></div>
  </div>`;
  const $ = (selector) => root.querySelector(selector);
  const box = $('.box');
  const drag = $('.drag');
  const tag = $('.tag');
  const markers = $('.markers');
  const composer = $('.composer');
  const composerTitle = $('.title');
  const textarea = $('textarea');
  document.documentElement.appendChild(host);

  let state = 'active';
  let queue = [];
  let count = 0;
  let pending = null;
  let press = null;
  let current = null;

  const clip = (text, max) => (text || '').replace(/\s+/g, ' ').trim().slice(0, max);
  const selectorOf = (el) => {
    const parts = [];
    for (
      let node = el;
      node && node.nodeType === 1 && parts.length < 5;
      node = node.parentElement
    ) {
      let part = node.localName;
      if (node.id) {
        parts.unshift(part + '#' + CSS.escape(node.id));
        break;
      }
      const classes = Array.from(node.classList).slice(0, 2);
      if (classes.length) part += '.' + classes.map((c) => CSS.escape(c)).join('.');
      const parent = node.parentElement;
      if (parent) {
        const same = Array.from(parent.children).filter((c) => c.localName === node.localName);
        if (same.length > 1) part += ':nth-of-type(' + (same.indexOf(node) + 1) + ')';
      }
      parts.unshift(part);
    }
    return parts.join(' > ');
  };
  const labelOf = (el) => {
    let text = el.localName;
    if (el.id) text += '#' + el.id;
    const classes = Array.from(el.classList).slice(0, 2);
    if (classes.length) text += '.' + classes.join('.');
    return text;
  };
  const round = (r) => ({
    x: Math.round(r.x),
    y: Math.round(r.y),
    width: Math.round(r.width),
    height: Math.round(r.height),
  });
  const pageContext = () => {
    const ring = window.__jamConsole || [];
    return {
      url: location.href,
      title: clip(document.title, 200),
      console: ring.slice(-10),
      consoleErrors: ring.filter((entry) => entry.level === 'error').length,
    };
  };
  const describeElement = (el) => {
    const style = getComputedStyle(el);
    const styles = {};
    for (const name of [
      'display',
      'position',
      'color',
      'background-color',
      'font-size',
      'width',
      'height',
      'overflow',
    ])
      styles[name] = style.getPropertyValue(name);
    return {
      kind: 'element',
      selector: selectorOf(el),
      label: labelOf(el),
      text: clip(el.innerText, 200),
      html: clip(el.outerHTML, 600),
      rect: round(el.getBoundingClientRect()),
      styles,
      ...pageContext(),
    };
  };
  /** A region records its rectangle and the elements it mostly covers. */
  const describeRegion = (rect) => {
    const inside = [];
    const walker = document.createTreeWalker(document.body || document.documentElement, 1);
    for (let node = walker.nextNode(); node && inside.length < 12; node = walker.nextNode()) {
      if (node === host) continue;
      const r = node.getBoundingClientRect();
      if (!r.width || !r.height) continue;
      const overlap =
        Math.max(0, Math.min(r.right, rect.x + rect.width) - Math.max(r.left, rect.x)) *
        Math.max(0, Math.min(r.bottom, rect.y + rect.height) - Math.max(r.top, rect.y));
      if (overlap / (r.width * r.height) > 0.6 && !inside.some((p) => p.contains(node)))
        inside.push(node);
    }
    return {
      kind: 'region',
      selector: inside.map(selectorOf).join(', ').slice(0, 1000),
      label: `Region ${Math.round(rect.width)}×${Math.round(rect.height)}`,
      text: clip(inside.map((n) => n.innerText).join(' '), 300),
      html: '',
      rect: round(rect),
      styles: {},
      ...pageContext(),
    };
  };

  const place = (el, r) => {
    el.style.left = r.x + 'px';
    el.style.top = r.y + 'px';
    el.style.width = r.width + 'px';
    el.style.height = r.height + 'px';
  };
  const hideHover = () => {
    box.style.display = 'none';
    tag.style.display = 'none';
  };
  const showHover = (el) => {
    const r = el.getBoundingClientRect();
    place(box, r);
    box.style.display = 'block';
    tag.textContent = `${labelOf(el)}  ${Math.round(r.width)} × ${Math.round(r.height)}`;
    tag.style.left = Math.max(r.x, 2) + 'px';
    tag.style.top = Math.max(r.y - 20, 2) + 'px';
    tag.style.display = 'block';
  };
  const inOverlay = (event) => event.composedPath().includes(host);
  const swallow = (event) => {
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
  };

  const openComposer = (annotation, r) => {
    pending = annotation;
    hideHover();
    composerTitle.textContent = `Comment on ${annotation.kind} ${count + 1}`;
    // Beside the target if it fits, else below, else above, so the comment
    // never hides what it is about; overlap is the last resort.
    composer.style.display = 'block';
    const width = composer.offsetWidth;
    const height = composer.offsetHeight;
    const gap = 8;
    const clampX = (x) => Math.min(Math.max(x, gap), innerWidth - width - gap);
    const clampY = (y) => Math.min(Math.max(y, gap), innerHeight - height - gap);
    let left;
    let top;
    if (r.x + r.width + gap + width <= innerWidth - gap) {
      left = r.x + r.width + gap;
      top = clampY(r.y);
    } else if (r.x - gap - width >= gap) {
      left = r.x - gap - width;
      top = clampY(r.y);
    } else if (r.y + r.height + gap + height <= innerHeight - gap) {
      left = clampX(r.x);
      top = r.y + r.height + gap;
    } else if (r.y - gap - height >= gap) {
      left = clampX(r.x);
      top = r.y - gap - height;
    } else {
      left = clampX(r.x + r.width - width);
      top = clampY(r.y + r.height - height);
    }
    composer.style.left = left + 'px';
    composer.style.top = top + 'px';
    textarea.value = '';
    textarea.focus();
  };
  const closeComposer = () => {
    pending = null;
    composer.style.display = 'none';
    drag.style.display = 'none';
  };
  const commit = () => {
    if (!pending) return;
    count += 1;
    const annotation = { ...pending, index: count, comment: textarea.value.trim().slice(0, 2000) };
    queue.push(annotation);
    const marker = document.createElement('div');
    marker.className = `marker ${annotation.kind}`;
    place(marker, {
      x: annotation.rect.x + scrollX,
      y: annotation.rect.y + scrollY,
      width: annotation.rect.width,
      height: annotation.rect.height,
    });
    marker.innerHTML = '<div class="outline"></div><div class="badge"></div>';
    marker.querySelector('.badge').textContent = String(count);
    markers.appendChild(marker);
    closeComposer();
  };
  $('.add').addEventListener('click', commit);
  $('.cancel').addEventListener('click', closeComposer);
  textarea.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      commit();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      closeComposer();
    }
  });
  // Typing a comment must not reach the page's own keyboard handlers.
  for (const type of ['keydown', 'keyup', 'keypress', 'input'])
    host.addEventListener(type, (event) => event.stopPropagation());

  const onDown = (event) => {
    if (state !== 'active' || inOverlay(event) || event.button !== 0) return;
    swallow(event);
    if (pending) closeComposer();
    press = { x: event.clientX, y: event.clientY, dragging: false };
  };
  const onMove = (event) => {
    if (state !== 'active' || pending) return;
    if (press) {
      const dx = event.clientX - press.x;
      const dy = event.clientY - press.y;
      if (!press.dragging && Math.hypot(dx, dy) > DRAG) {
        press.dragging = true;
        hideHover();
      }
      if (press.dragging) {
        place(drag, {
          x: Math.min(press.x, event.clientX),
          y: Math.min(press.y, event.clientY),
          width: Math.abs(dx),
          height: Math.abs(dy),
        });
        drag.style.display = 'block';
      }
      return;
    }
    if (inOverlay(event)) return;
    const el = document.elementFromPoint(event.clientX, event.clientY);
    if (el && el !== host && el !== current) {
      current = el;
      showHover(el);
    }
  };
  const onUp = (event) => {
    if (state !== 'active' || !press || inOverlay(event)) return;
    swallow(event);
    const start = press;
    press = null;
    if (start.dragging) {
      const r = {
        x: Math.min(start.x, event.clientX),
        y: Math.min(start.y, event.clientY),
        width: Math.abs(event.clientX - start.x),
        height: Math.abs(event.clientY - start.y),
      };
      openComposer(describeRegion(r), r);
    } else {
      const el = document.elementFromPoint(event.clientX, event.clientY) || current;
      if (!el || el === host) return;
      openComposer(describeElement(el), el.getBoundingClientRect());
    }
  };
  const onClick = (event) => {
    if (state === 'active' && !inOverlay(event)) swallow(event);
  };
  const onKey = (event) => {
    if (state === 'active' && event.key === 'Escape' && !inOverlay(event)) {
      swallow(event);
      stop();
    }
  };
  const listeners = [
    ['mousedown', onDown],
    ['mousemove', onMove],
    ['mouseup', onUp],
    ['click', onClick],
    ['dblclick', onClick],
    ['keydown', onKey],
  ];
  const listen = () => listeners.forEach(([type, fn]) => addEventListener(type, fn, true));
  const unlisten = () => listeners.forEach(([type, fn]) => removeEventListener(type, fn, true));

  /** Leaves annotate mode; markers stay until JAM stages or clears them. */
  const stop = () => {
    if (state !== 'active') return;
    state = 'ended';
    unlisten();
    closeComposer();
    hideHover();
    press = null;
  };
  listen();

  Object.defineProperty(window, '__jamAnnotate', {
    configurable: true,
    value: {
      stop,
      resume() {
        if (state === 'active') return;
        state = 'active';
        listen();
      },
      clear() {
        markers.replaceChildren();
        queue = [];
        count = 0;
      },
      /** Hands finished annotations to the host, once each. */
      take() {
        const items = queue;
        queue = [];
        return { state, items };
      },
    },
  });
})();
