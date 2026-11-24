const $ = id => document.getElementById(id);
document.addEventListener("pointerdown", event => {
  if ($("settings").open && !$("settings").contains(event.target)) $("settings").open = false;
});
document.addEventListener("keydown", event => {
  if (event.key === "Escape" && $("settings").open) {
    $("settings").open = false;
    $("settings").querySelector("summary").focus();
  }
});
watchMarkerSettings(settings => {
  for (const key of Object.keys(markerDefaults)) $(key).value = settings[key];
}).catch(() => {$("settingsStatus").textContent = "读取设置失败，请刷新重试。";});
for (const key of Object.keys(markerDefaults)) {
  $(key).addEventListener("change", async () => {
    try {
      await chrome.storage.local.set({[key]: $(key).value});
      $("settingsStatus").textContent = "";
    } catch { $("settingsStatus").textContent = "设置未保存，请重试。"; }
  });
}
$("resetMarker").addEventListener("click", async () => {
  try {
    await chrome.storage.local.set(markerDefaults);
    $("settingsStatus").textContent = "已恢复默认设置。";
  } catch {
    $("settingsStatus").textContent = "设置未保存，请重试。";
  }
});
let entries = new Map(), queue = [], index = 0, reviewing = false, revealed = false, busy = false;
function setSourceLink(link, url, text) {
  try {
    const parsed = new URL(url);
    if (parsed.protocol === "http:" || parsed.protocol === "https:") {
      link.href = parsed.href;
      link.textContent = "打开原网页 ↗";
      link.setAttribute("aria-label", "在新标签页打开 " + text + " 的原网页");
      link.className = "";
      return;
    }
  } catch {}
  link.removeAttribute("href");
  link.textContent = "来源未记录";
  link.className = "source-missing";
  link.removeAttribute("target");
}
function render() {
  if ($("collection").hidden !== reviewing) $("collection").parentElement.classList.add("has-switched-view");
  $("library").setAttribute("aria-pressed", String(!reviewing));
  $("study").setAttribute("aria-pressed", String(reviewing));
  $("collection").hidden = reviewing;
  $("review").hidden = !reviewing;
  $("collection").setAttribute("aria-hidden", String(reviewing));
  $("review").setAttribute("aria-hidden", String(!reviewing));
  $("collection").inert = reviewing;
  $("review").inert = !reviewing;
  if (!reviewing) {
    $("empty").hidden = entries.size > 0;
    $("count").textContent = entries.size + " 条收藏";
    const rows = [...entries].sort((a, b) => b[1].added - a[1].added).map(([key, item]) => {
      const row = document.createElement("article"), body = document.createElement("div");
      const title = document.createElement("h2"), meaning = document.createElement("p");
      const pronunciation = document.createElement("small"), example = document.createElement("div");
      const exampleText = document.createElement("p"), exampleTranslation = document.createElement("p");
      const credit = document.createElement("small"), meta = document.createElement("div");
      const remove = document.createElement("button"), icon = document.createElement("img");
      row.className = "entry-card"; title.lang = "en"; title.textContent = item.text;
      if (item.text.trim().includes(" ")) title.className = "phrase";
      meaning.textContent = item.translation;
      pronunciation.className = "pronunciation";
      pronunciation.textContent = item.phonetic ? "/" + item.phonetic + "/" : "";
      const sample = item.examples?.[0];
      example.className = "example";
      exampleText.lang = "en"; exampleText.textContent = sample?.text || (typeof sample === "string" ? sample : "");
      exampleTranslation.textContent = sample?.translation || "";
      example.hidden = !exampleText.textContent || !exampleTranslation.textContent;
      example.append(exampleText, exampleTranslation);
      credit.textContent = item.examples?.[0] ? "Wiktionary · CC BY-SA 3.0" : "";
      remove.title = "移出 Box"; remove.setAttribute("aria-label", "移出 " + item.text);
      icon.src = "icons/trash-2.svg"; icon.alt = ""; remove.append(icon);
      remove.onclick = () => discard(key);
      body.className = "entry-card-content";
      body.append(title);
      if (pronunciation.textContent) body.append(pronunciation);
      body.append(meaning, example);
      if (sample?.text && sample?.translation) body.append(credit);
      meta.className = "entry-card-meta";
      const source = document.createElement("a");
      source.target = "_blank";
      source.rel = "noopener noreferrer";
      setSourceLink(source, item.sourceUrl, item.text);
      meta.append(source, remove);
      body.append(meta);
      row.append(body);
      return row;
    });
    $("rows").replaceChildren(...rows);
    return;
  }
  while (index < queue.length && !entries.has(queue[index])) {index++; revealed = false;}
  const item = entries.get(queue[index]);
  $("reviewEmpty").hidden = queue.length > 0;
  $("done").hidden = Boolean(item) || queue.length === 0;
  $("card").hidden = !item;
  $("progress").textContent = item
    ? "复习进度　" + (index + 1) + " / " + queue.length
    : queue.length === 0 ? "0 条待复习" : "";
  $("reveal").hidden = !item || revealed;
  $("keep").hidden = $("remove").hidden = !item || !revealed;
  if (!item) return;
  $("prompt").textContent = item.text;
  $("phonetic").textContent = item.phonetic ? "/" + item.phonetic + "/" : "";
  $("answer").textContent = revealed ? item.translation : "";
  $("answer").hidden = !revealed;
  const sample = item.examples?.[0];
  $("reviewExampleText").textContent = sample?.text || (typeof sample === "string" ? sample : "");
  $("reviewExampleTranslation").textContent = sample?.translation || "";
  $("reviewExample").hidden = !revealed || !sample?.text || !sample?.translation;
  $("reviewCredit").hidden = $("reviewExample").hidden;
  setSourceLink($("reviewSource"), item.sourceUrl, item.text);
  $("reviewSource").hidden = !item.sourceUrl;
}
async function discard(key) {
  if (busy || !entries.has(key)) return;
  busy = true;
  try {
    await chrome.storage.local.remove(key);
    entries.delete(key);
    render();
  } catch { $("notice").textContent = "移出失败，请重试。"; }
  finally {busy = false;}
}
function library() {reviewing = false; render();}
$("library").onclick = $("back").onclick = $("reviewBack").onclick = library;
$("study").onclick = () => {
  if (reviewing) return;
  $("notice").textContent = "";
  queue = [...entries.keys()]; index = 0; revealed = false; reviewing = true; render();
};
$("reveal").onclick = () => {revealed = true; render(); $("keep").focus();};
$("keep").onclick = () => {if (!busy) {index++; revealed = false; render();}};
$("remove").onclick = () => discard(queue[index]);
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  for (const [key, change] of Object.entries(changes)) {
    if (!key.startsWith("entry.")) continue;
    if (change.newValue) entries.set(key, change.newValue);
    else entries.delete(key);
  }
  $("notice").textContent = "";
  render();
});
chrome.storage.local.get(null).then(data => {
  entries = new Map(Object.entries(data).filter(([key]) => key.startsWith("entry.")));
  render();
  for (const key of entries.keys()) chrome.runtime.sendMessage({type: "enrich-entry", key}).catch(() => {});
}).catch(() => {$("notice").textContent = "读取 Box 失败，请刷新重试。";});
