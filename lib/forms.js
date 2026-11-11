// Small helpers for reading form fields.
export const text = (fd, key) => {
  const v = fd.get(key);
  if (v === null) return null;
  const t = String(v).trim();
  return t === "" ? null : t;
};

export const int = (fd, key) => {
  const v = text(fd, key);
  if (v === null) return null;
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : null;
};

export const ids = (fd, key) => fd.getAll(key).map((v) => parseInt(v, 10)).filter(Number.isFinite);

export const cleanUrl = (u) => {
  if (!u) return null;
  return /^https?:\/\//i.test(u) ? u : `https://${u}`;
};

// Build a path with a message, e.g. withMsg("/admin/review", "Approved.")
export const withMsg = (path, msg, kind = "msg") =>
  `${path}${path.includes("?") ? "&" : "?"}${kind}=${encodeURIComponent(msg)}`;
