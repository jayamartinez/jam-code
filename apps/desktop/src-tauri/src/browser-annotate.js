/* global window, document, location, CSS, getComputedStyle, addEventListener, removeEventListener, innerWidth, innerHeight, scrollX, scrollY */
// Annotate mode, evaluated by the JAM host inside a browsed page.
//
// A click annotates the element under the pointer; a press-and-drag annotates
// the dragged region. Each capture asks for an optional comment, then leaves
// a numbered marker (Paper, Core flows "17 · Browser annotations"): what was
// picked keeps its outline while the comment is written, and a marker's
// number, or the same element again, reopens it for editing. An edit is sent
// again under the same number. Everything is drawn by the page itself because nothing
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
    .box { border: 1.5px solid ${ACCENT}; background: rgb(111 155 255 / 12%); border-radius: 3px; display: none; }
    .drag { border: 1.5px dashed ${ACCENT}; background: rgb(111 155 255 / 10%); display: none; }
    .picked { border: 2px solid ${ACCENT}; border-radius: 4px; box-shadow: 0 0 0 4px rgb(111 155 255 / 22%); display: none; }
    .picked.region { border-style: dashed; background: rgb(111 155 255 / 8%); }
    .tag { font: 11px/16px ui-monospace, monospace; color: #07101F; background: #A8C3FF; padding: 1px 6px; border-radius: 4px; white-space: nowrap; display: none; }
    .badge { position: absolute; width: 20px; height: 20px; border-radius: 10px; background: ${ACCENT};
      color: #07101F; font: 700 11px/20px system-ui; text-align: center; box-shadow: 0 0 0 2px #fff; }
    .picked .badge { left: -10px; top: -10px; }
    .marker { position: absolute; pointer-events: none; }
    .marker .outline { position: absolute; inset: 0; border: 1.5px solid rgb(111 155 255 / 55%);
      background: rgb(111 155 255 / 5%); border-radius: 4px; }
    .marker.region .outline { border-style: dashed; }
    .marker .badge { left: -10px; top: -10px; }
    .editing .marker .badge { pointer-events: auto; cursor: pointer; }
    .editing .marker .badge:hover { box-shadow: 0 0 0 2px #fff, 0 0 0 5px rgb(111 155 255 / 35%); }
    .card { position: fixed; width: 320px; border-radius: 12px; background: #14151B;
      border: 1px solid rgb(190 210 255 / 12%); box-shadow: 0 18px 44px rgb(7 8 12 / 40%);
      color: #E3E6EE; display: none; pointer-events: auto; }
    .card .head { display: flex; align-items: center; gap: 8px; padding: 10px 12px 0; min-width: 0; }
    .card .head .badge { position: static; flex-shrink: 0; width: 18px; height: 18px; font-size: 10.5px; line-height: 18px; box-shadow: none; }
    .card .what { flex-shrink: 0; max-width: 150px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
      font: 11.5px/16px ui-monospace, monospace; color: #B1B6C3; }
    .card .snippet { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
      font-size: 11.5px; color: #6D7281; }
    .card textarea { display: block; width: 100%; min-height: 60px; max-height: 160px; resize: none; border: 0;
      background: transparent; color: #E3E6EE; font-size: 13px; line-height: 19px; padding: 10px 12px 12px; outline: none; }
    .card textarea::placeholder { color: #6D7281; }
    .card .foot { display: flex; align-items: center; gap: 6px; padding: 8px 8px 8px 12px; border-top: 1px solid rgb(190 210 255 / 6%); }
    .card .hint { flex: 1; font-size: 11px; color: #6D7281; }
    .card button { border: 0; border-radius: 6px; height: 26px; padding: 0 10px; font-size: 12px; cursor: pointer; }
    .card .cancel { background: transparent; color: #B1B6C3; }
    .card .cancel:hover { background: rgb(190 210 255 / 6%); }
    .card .add { background: ${ACCENT}; color: #07101F; font-weight: 500; padding: 0 12px; }
  </style>
  <div class="fixed box"></div><div class="fixed drag"></div><div class="fixed tag"></div>
  <div class="fixed picked"><div class="badge"></div></div>
  <div class="markers"></div>
  <div class="card" role="dialog" aria-label="Annotation comment">
    <div class="head"><span class="badge"></span><span class="what"></span><span class="snippet"></span></div>
    <textarea placeholder="What should the agent know? (optional)"></textarea>
    <div class="foot"><span class="hint">Enter adds · Shift+Enter new line</span><button class="cancel" type="button">Cancel</button><button class="add" type="button">Add</button></div>
  </div>`;
  const $ = (selector) => root.querySelector(selector);
  const box = $('.box');
  const drag = $('.drag');
  const tag = $('.tag');
  const markers = $('.markers');
  const picked = $('.picked');
  const pickedBadge = $('.picked .badge');
  const composer = $('.card');
  const cardBadge = $('.card .head .badge');
  const cardWhat = $('.card .what');
  const cardSnippet = $('.card .snippet');
  const addButton = $('.add');
  const hint = $('.hint');
  const textarea = $('textarea');
  document.documentElement.appendChild(host);

  let state = 'active';
  let queue = [];
  let count = 0;
  let pending = null;
  /** Added annotations by number, with their element when there is one. */
  const added = new Map();
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

  /**
   * The comment card for a new pick, or for an added annotation (`editing`
   * is its number). What was picked keeps a strong outline and its number
   * while the card is open.
   */
  const openComposer = (annotation, r, editing) => {
    pending = { annotation, editing };
    hideHover();
    const number = editing ?? count + 1;
    place(picked, r);
    picked.className = `fixed picked ${annotation.kind}`;
    picked.style.display = 'block';
    pickedBadge.textContent = String(number);
    cardBadge.textContent = String(number);
    cardWhat.textContent =
      annotation.kind === 'region' ? annotation.label : clip(annotation.label, 60);
    cardSnippet.textContent = annotation.text ? `"${clip(annotation.text, 60)}"` : '';
    addButton.textContent = editing ? 'Save' : 'Add';
    hint.textContent = editing
      ? 'Enter saves · Shift+Enter new line'
      : 'Enter adds · Shift+Enter new line';
    // Below the target if it fits, else above, else beside, so the comment
    // never hides what it is about; overlap is the last resort.
    composer.style.display = 'block';
    const width = composer.offsetWidth;
    const height = composer.offsetHeight;
    const gap = 10;
    const clampX = (x) => Math.min(Math.max(x, gap), innerWidth - width - gap);
    const clampY = (y) => Math.min(Math.max(y, gap), innerHeight - height - gap);
    let left;
    let top;
    if (r.y + r.height + gap + height <= innerHeight - gap) {
      left = clampX(r.x);
      top = r.y + r.height + gap;
    } else if (r.y - gap - height >= gap) {
      left = clampX(r.x);
      top = r.y - gap - height;
    } else if (r.x + r.width + gap + width <= innerWidth - gap) {
      left = r.x + r.width + gap;
      top = clampY(r.y);
    } else if (r.x - gap - width >= gap) {
      left = r.x - gap - width;
      top = clampY(r.y);
    } else {
      left = clampX(r.x + r.width - width);
      top = clampY(r.y + r.height - height);
    }
    composer.style.left = left + 'px';
    composer.style.top = top + 'px';
    textarea.value = editing ? added.get(editing)?.annotation.comment || '' : '';
    textarea.focus();
    textarea.setSelectionRange(textarea.value.length, textarea.value.length);
  };
  const closeComposer = () => {
    pending = null;
    composer.style.display = 'none';
    picked.style.display = 'none';
    drag.style.display = 'none';
  };
  const addMarker = (annotation) => {
    const marker = document.createElement('div');
    marker.className = `marker ${annotation.kind}`;
    place(marker, {
      x: annotation.rect.x + scrollX,
      y: annotation.rect.y + scrollY,
      width: annotation.rect.width,
      height: annotation.rect.height,
    });
    marker.innerHTML = '<div class="outline"></div><div class="badge"></div>';
    const badge = marker.querySelector('.badge');
    badge.textContent = String(annotation.index);
    badge.title = 'Edit this annotation';
    badge.addEventListener('mousedown', (event) => {
      event.stopPropagation();
      event.preventDefault();
    });
    badge.addEventListener('click', (event) => {
      event.stopPropagation();
      if (state === 'active') edit(annotation.index);
    });
    markers.appendChild(marker);
  };
  /** Reopens an added annotation's comment. */
  const edit = (index) => {
    const entry = added.get(index);
    if (!entry) return;
    const r = entry.element?.isConnected
      ? entry.element.getBoundingClientRect()
      : {
          x: entry.annotation.rect.x + entry.scroll.x - scrollX,
          y: entry.annotation.rect.y + entry.scroll.y - scrollY,
          width: entry.annotation.rect.width,
          height: entry.annotation.rect.height,
        };
    openComposer(entry.annotation, r, index);
  };
  const commit = () => {
    if (!pending) return;
    const comment = textarea.value.trim().slice(0, 2000);
    const { annotation, editing, element } = pending;
    if (editing) {
      // The same number again: JAM replaces what it had for it.
      const entry = added.get(editing);
      entry.annotation = { ...entry.annotation, comment };
      queue.push(entry.annotation);
      closeComposer();
      return;
    }
    count += 1;
    const next = { ...annotation, index: count, comment };
    added.set(count, { annotation: next, element, scroll: { x: scrollX, y: scrollY } });
    queue.push(next);
    addMarker(next);
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
      const again = [...added].find(([, entry]) => entry.element === el);
      if (again) {
        edit(again[0]);
        return;
      }
      openComposer(describeElement(el), el.getBoundingClientRect());
      pending.element = el;
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
  const listen = () => {
    listeners.forEach(([type, fn]) => addEventListener(type, fn, true));
    markers.classList.add('editing');
  };
  const unlisten = () => {
    listeners.forEach(([type, fn]) => removeEventListener(type, fn, true));
    markers.classList.remove('editing');
  };

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
        added.clear();
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
