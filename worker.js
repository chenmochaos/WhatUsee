const boxURL = chrome.runtime.getURL("box.html");
async function openBox() {
  const [tab] = await chrome.tabs.query({url: boxURL});
  if (tab) {
    await chrome.tabs.update(tab.id, {active: true});
    await chrome.windows.update(tab.windowId, {focused: true});
  } else {
    await chrome.tabs.create({url: boxURL});
  }
}
async function openBoxFromTab(tab) {
  try {
    if (/^(https?|file):/.test(tab.url || "")) {
      const ready = await chrome.tabs.sendMessage(tab.id, {type: "reader-status"}, {frameId: 0}).catch(() => false);
      if (!ready) {
        await chrome.scripting.executeScript({
          target: {tabId: tab.id},
          files: ["marker-settings.js", "reader.js"]
        });
      }
    }
  } catch (err) {
    console.warn("WhatUsee could not attach to this tab", err.message);
  }
  await openBox();
}
chrome.action.onClicked.addListener(openBoxFromTab);

const normalize = text => text.trim().replace(/\s+/g, " ");
async function entryKey(text) {
  const canonical = normalize(text).toLowerCase().replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, "");
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonical));
  return "entry." + Array.from(new Uint8Array(bytes), n => n.toString(16).padStart(2, "0")).join("");
}
const sections = new Map();
async function lookup(text) {
  const word = text.toLowerCase().replace(/[’]/g, "'").replace(/^[“"(]+|[.!?,;:”")]+$/g, "");
  if (!/^[a-z][a-z'-]*$/.test(word)) return;
  const letter = word[0];
  if (!sections.has(letter)) {
    sections.set(letter, await (await fetch(chrome.runtime.getURL("dict/" + letter + ".json"))).json());
  }
  const dict = sections.get(letter);
  if (Object.hasOwn(dict, word)) {
    const [phonetic, translation] = dict[word];
    return {phonetic, translation, examples: await examplesFor(word), source: "ECDICT"};
  }
}

async function examplesFor(word) {
  try {
    const response = await fetch("https://api.dictionaryapi.dev/api/v2/entries/en/" + encodeURIComponent(word), {
      signal: AbortSignal.timeout(7000),
      credentials: "omit"
    });
    if (!response.ok) return [];
    const entries = await response.json();
    const examples = [];
    for (const entry of entries) {
      for (const meaning of entry.meanings || []) {
        for (const definition of meaning.definitions || []) {
          const example = definition.example?.trim();
          if (!example || examples.some(item => item.text === example)) continue;
          const translated = await online(example).catch(() => null);
          if (translated?.translation) examples.push({text: example, translation: translated.translation});
          if (examples.length === 1) return examples;
        }
      }
    }
    return examples;
  } catch {
    return [];
  }
}

async function online(text) {
  // MyMemory accepts 500 UTF-8 bytes per request. Preserve word boundaries.
  const chunks = [];
  let current = "";
  const encoder = new TextEncoder();
  for (const word of text.split(" ")) {
    if (encoder.encode(word).length > 500) throw Error("选区中有过长的连续文本，请缩短选区。");
    const next = current ? current + " " + word : word;
    if (encoder.encode(next).length > 500) {
      chunks.push(current);
      current = word;
    } else current = next;
  }
  chunks.push(current);
  const results = [];
  for (const q of chunks) {
    const url = new URL("https://api.mymemory.translated.net/get");
    url.search = new URLSearchParams({q, langpair: "en|zh-CN"});
    const response = await fetch(url, {signal: AbortSignal.timeout(12000), credentials: "omit"});
    if (response.status === 429) throw Error("在线翻译额度已用完，请稍后再试。");
    if (!response.ok) throw Error("在线翻译暂时不可用，请重试。");
    const data = await response.json();
    if (data.quotaFinished || Number(data.responseStatus) === 429) throw Error("在线翻译额度已用完，请稍后再试。");
    if (Number(data.responseStatus) !== 200 || !data.responseData?.translatedText?.trim()) {
      throw Error("没有取得译文，请重试。");
    }
    results.push(data.responseData.translatedText);
  }
  return {translation: results.join(" "), source: "MyMemory"};
}

async function enrichEntry(key, pageUrl = "") {
  if (!key?.startsWith("entry.")) return;
  const saved = (await chrome.storage.local.get(key))[key];
  if (!saved) return;
  let examples = saved.examples || [];
  let sample = examples[0];
  let sampleText = typeof sample === "string" ? sample : sample?.text;
  if (!sampleText && /^[a-z][a-z'-]*$/i.test(saved.text)) {
    sample = (await examplesFor(saved.text.toLowerCase()))[0];
    sampleText = sample?.text;
  }
  if (sampleText && !sample?.translation) {
    const translated = await online(sampleText).catch(() => null);
    if (translated?.translation) {
      sample = {text: sampleText, translation: translated.translation};
      examples = [sample, ...examples.slice(1)];
    }
  }
  const sourceUrl = saved.sourceUrl || (/^https?:\/\//i.test(pageUrl) ? pageUrl : "");
  if (sourceUrl === saved.sourceUrl && examples === saved.examples) return saved;
  const updated = {...saved, examples, sourceUrl};
  await chrome.storage.local.set({[key]: updated});
  return updated;
}

async function handle(msg, sender) {
  if (msg.type === "open") return openBox();
  if (msg.type === "enrich-entry") return enrichEntry(msg.key);
  const text = normalize(msg.text || "");
  if (!text || text.length > 3000) throw Error("请选中 3000 个字符以内的英文。");
  const key = await entryKey(text);
  const saved = (await chrome.storage.local.get(key))[key];
  if (msg.type === "translate") {
    if (saved) return {...(await enrichEntry(key, sender.url)) , saved: true};
    return {...(await lookup(text) || await online(text)), saved: false};
  }
  if (msg.type === "save" && !saved && msg.result?.translation) {
    const {translation, phonetic = "", examples = [], source} = msg.result;
    const entry = {text, translation, phonetic, examples, source, sourceUrl: sender.url || sender.tab?.url || "", added: Date.now()};
    await chrome.storage.local.set({[key]: entry});
    return {...entry, saved: true, duplicate: false};
  }
  if (msg.type === "save" && saved) return {...saved, saved: true, duplicate: true};
}
chrome.runtime.onMessage.addListener((msg, sender, respond) => {
  handle(msg, sender).then(value => respond({ok: true, value}), err => {
    const message = /[\u3400-\u9fff]/.test(err.message) ? err.message : "无法完成操作，请检查连接后重试。";
    respond({ok: false, error: message});
  });
  return true;
});
