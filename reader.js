(() => {
  if (globalThis.whatUseeReaderReady) return;
  const host = document.createElement("whatusee-reader");
  host.style.cssText = "all:initial!important;position:fixed!important;inset:0!important;pointer-events:none!important;z-index:2147483647!important;display:block!important";
  const root = host.attachShadow({mode: "closed"});
  const sheet = new CSSStyleSheet();
  sheet.replaceSync(`
    :host {color-scheme:dark}
    * {box-sizing:border-box}
    [hidden] {display:none!important}
    button {font:inherit;cursor:pointer;color:inherit}
    #dot,#panel {position:absolute;pointer-events:auto}
    #dot {width:24px;height:22px;background:transparent;border:0;padding:4px;display:grid;place-items:center}
    #dot:before {content:"";width:6px;height:6px;border-radius:100%;background:var(--dot-light);border:1px solid #111;box-shadow:0 0 0 1px #fff,0 1px 4px #0008}
    @media (prefers-color-scheme:dark) {#dot:before {background:var(--dot-dark);border-color:#fff;box-shadow:0 0 0 1px #111,0 1px 4px #0008}}
    #panel {width:min(366px,calc(100vw - 16px));max-height:calc(100vh - 16px);overflow:auto;border:1px solid #424145;border-radius:8px;color:#f3f1f3;background:#232225;box-shadow:0 12px 40px #0005;font:14px/1.55 system-ui,sans-serif;text-align:left;direction:ltr}
    header,footer {display:flex;align-items:center;gap:8px;padding:9px 16px}
    header {border-bottom:1px solid #39383b;color:#c8c3c7;font-size:12px}
    header b {color:#e5e7eb;font:600 13px system-ui}
    #close {margin-left:auto;border:0;background:transparent;color:#bcb6bc;font-size:21px;line-height:1;padding:2px 5px}
    article {padding:15px 18px;overflow-wrap:anywhere}
    h2 {margin:0;font:600 19px/1.4 system-ui,sans-serif;color:#fff}
    #sound {font-size:13px;color:#aaa3a9}
    #meaning {white-space:pre-line;line-height:1.75;margin:10px 0 0}
    footer {justify-content:space-between;padding-bottom:13px}
    #source {font:11px system-ui;color:#bcb5bb}
    #example {border-top:1px solid #39383b;margin-top:14px;padding-top:10px}
    #example-label {font:12px system-ui;color:#aaa}
    #example-text {margin:5px 0 0;color:#d1d1d3}
    #example-translation {margin:5px 0 0;color:#aaa}
    #example-credit {display:block;margin-top:5px;color:#999;font:11px system-ui}
    #action {background:#d6d7da;color:#202124;border:0;border-radius:5px;font-weight:600;padding:6px 12px}
    #action:hover {background:#f3f4f6}
    #action:disabled {opacity:.65}
    button:focus-visible {outline:2px solid #d1d5db;outline-offset:1px}
  `);
  root.adoptedStyleSheets = [sheet];
  function add(parent, tag, id, label = "") {
    const el = document.createElement(tag);
    if (id) el.id = id;
    el.textContent = label;
    parent.append(el);
    return el;
  }
  const dot = add(root, "button", "dot");
  dot.type = "button";
  dot.setAttribute("aria-label", "查看中文翻译");
  const panel = add(root, "section", "panel");
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-label", "划选翻译");
  dot.hidden = panel.hidden = true;
  const header = add(panel, "header");
  add(header, "b", "", "WhatUsee");
  add(header, "span", "", "英 → 简中");
  add(header, "button", "close", "×").setAttribute("aria-label", "关闭");
  const article = add(panel, "article");
  add(article, "h2");
  add(article, "span", "sound");
  add(article, "p", "meaning").setAttribute("aria-live", "polite");
  const example = add(article, "div", "example");
  add(example, "span", "example-label", "例句");
  add(example, "p", "example-text");
  add(example, "p", "example-translation");
  add(example, "span", "example-credit", "Wiktionary · CC BY-SA 3.0");
  example.hidden = true;
  const footer = add(panel, "footer");
  add(footer, "span", "source");
  const action = add(footer, "button", "action");
  action.hidden = true;
  const $ = id => root.querySelector(id);
  let range, text = "", result, serial = 0, dismiss, scheduled;
  const clamp = (n, min, max) => Math.max(min, Math.min(n, max));
  let corner;
  watchMarkerSettings(settings => {
    corner = settings.dotCorner;
    dot.style.setProperty("--dot-dark", settings.dotDark);
    dot.style.setProperty("--dot-light", settings.dotLight);
    if (range) place();
  });
  function place() {
    if (!range || !range.startContainer.isConnected) return clear();
    const rects = range.getClientRects();
    const visible = Array.from(rects).filter(r => r.width && r.height && r.bottom > 0 && r.top < innerHeight && r.right > 0 && r.left < innerWidth);
    if (!visible.length) return clear();
    const anchorX = corner.endsWith("right") ? Math.max(...visible.map(r => r.right)) : Math.min(...visible.map(r => r.left));
    const anchorY = corner.startsWith("top") ? Math.min(...visible.map(r => r.top)) - 22 : Math.max(...visible.map(r => r.bottom));
    const left = clamp(anchorX - 12, 0, innerWidth - 24);
    const top = clamp(anchorY, 0, innerHeight - 22);
    Object.assign(dot.style, {left: left + "px", top: top + "px"});
    if (panel.hidden) return;
    const h = panel.offsetHeight, below = top + 21;
    const y = below + h <= innerHeight - 8 ? below : top - h;
    panel.style.top = clamp(y, 8, innerHeight - h - 8) + "px";
    panel.style.left = clamp(left - 15, 8, innerWidth - panel.offsetWidth - 8) + "px";
  }
  function clear() {
    clearTimeout(dismiss);
    range = null; text = ""; result = null; serial++;
    dot.hidden = panel.hidden = true;
    host.remove();
  }
  function sync() {
    if (!chrome.runtime.id) {clear(); return;}
    const selection = getSelection();
    const next = selection?.toString().trim().replace(/\s+/g, " ");
    if (!selection?.rangeCount || !next || !/[a-z]/i.test(next) || next.length > 3000) return clear();
    const selected = selection.getRangeAt(0);
    const element = selected.commonAncestorContainer.nodeType === 1 ? selected.commonAncestorContainer : selected.commonAncestorContainer.parentElement;
    if (!element || element.closest("input,textarea") || element.isContentEditable || element.getRootNode() === root) return clear();
    if (next !== text || !range || selected.compareBoundaryPoints(Range.START_TO_START, range) !== 0) {
      clear(); range = selected.cloneRange(); text = next;
      document.documentElement.append(host);
      dot.hidden = false;
    }
    place();
  }
  async function send(type, extra) {
    const reply = await chrome.runtime.sendMessage({type, text, ...extra});
    if (!reply?.ok) throw Error(reply?.error || "请刷新网页后重试。");
    return reply.value;
  }
  async function show() {
    clearTimeout(dismiss);
    if (!range || !panel.hidden) return;
    const id = ++serial;
    panel.hidden = false;
    $("h2").textContent = text;
    $("#meaning").textContent = "正在翻译…";
    $("#source").textContent = $("#sound").textContent = "";
    $("#example").hidden = true;
    action.hidden = true;
    place();
    try {
      const value = result || await send("translate");
      if (id !== serial) return;
      result = value;
      $("#meaning").textContent = value.translation;
      $("#sound").textContent = value.phonetic ? "/" + value.phonetic + "/" : "";
      const sample = value.examples?.[0] || "";
      $("#example-text").textContent = sample.text || "";
      $("#example-translation").textContent = sample.translation || "";
      $("#example").hidden = !sample.text || !sample.translation;
      $("#source").textContent = value.source === "ECDICT" ? "本地词典 · ECDICT" : "在线翻译 · MyMemory";
      action.textContent = value.saved ? "已在 Box · 打开" : "＋ 加入 Box";
    } catch (err) {
      if (id !== serial) return;
      $("#meaning").textContent = err.message;
      action.textContent = "重试";
    }
    action.disabled = action.hidden = false;
    place();
  }
  function hidePanel() {
    panel.hidden = true;
    serial++;
    // Read storage again when reopening, in case the entry was removed in Box.
    result = null;
  }
  action.onclick = async () => {
    if (!result) { hidePanel(); return show(); }
    const id = serial;
    action.disabled = true;
    try {
      if (result.saved) await send("open");
      else {
        const saved = await send("save", {result});
        if (id !== serial) return;
        result.saved = true;
        result = {...result, ...saved};
        action.textContent = saved.duplicate ? "已在 Box · 打开" : "打开 Box ↗";
        $("#source").textContent = saved.duplicate ? "Box 中已有这个词条" : "✓ 已加入 Box";
      }
    } catch { if (id === serial) $("#source").textContent = "操作失败，请重试"; }
    if (id === serial) action.disabled = false;
  };
  dot.onclick = dot.onfocus = show;
  for (const node of [dot, panel]) {
    node.onpointerenter = () => {clearTimeout(dismiss); if (node === dot) show();};
    node.onpointerleave = () => {dismiss = setTimeout(() => {if (!panel.matches(":focus-within")) hidePanel();}, 400);};
  }
  $("#close").onclick = clear;
  root.addEventListener("mousedown", e => e.preventDefault());
  document.addEventListener("keydown", e => {if (e.key === "Escape") clear();}, true);
  window.addEventListener("pointerdown", e => {
    if (e.composedPath().includes(host)) return;
    clearTimeout(scheduled); clear();
  }, true);
  function schedule(delay) {
    clearTimeout(scheduled);
    scheduled = setTimeout(sync, delay);
  }
  window.addEventListener("pointerup", e => {
    if (!e.composedPath().includes(host)) schedule(20);
  }, true);
  document.addEventListener("selectionchange", () => schedule(100), true);
  document.addEventListener("scroll", () => {if (range) place();}, true);
  window.addEventListener("resize", () => {if (range) place();});
  chrome.runtime.onMessage.addListener((msg, sender, reply) => {
    if (msg.type === "reader-status") {sync(); reply(true);}
  });
  globalThis.whatUseeReaderReady = true;
  schedule(0);
})();
