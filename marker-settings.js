// The toolbar can reattach the reader to an already open tab.
var markerDefaults = Object.freeze({
  dotDark: "#e5e7eb",
  dotLight: "#222222",
  dotCorner: "top-right"
});

function watchMarkerSettings(apply) {
  const values = {...markerDefaults};
  const changed = new Set();
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    let updated = false;
    for (const key of Object.keys(markerDefaults)) {
      if (!(key in changes)) continue;
      values[key] = changes[key].newValue ?? markerDefaults[key];
      changed.add(key);
      updated = true;
    }
    if (updated) apply(values);
  });
  apply(values);
  return chrome.storage.local.get({...markerDefaults, markerAppearanceVersion: 0}).then(async saved => {
    if (saved.markerAppearanceVersion < 1) {
      const migrated = {...markerDefaults, markerAppearanceVersion: 1};
      await chrome.storage.local.set(migrated);
      Object.assign(values, markerDefaults);
      apply(values);
      return;
    }
    for (const key of Object.keys(markerDefaults)) {
      if (!changed.has(key)) values[key] = saved[key];
    }
    apply(values);
  });
}
