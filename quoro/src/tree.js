// A small CART decision tree (gini impurity), grown until every leaf is pure so it fits its training set exactly.
// Splits read "x[f] <= t" where t is an actual training value, so boundaries land exactly on the values in the data.

function gini(counts, n) {
  if (!n) return 0;
  let s = 0;
  for (const c of counts.values()) s += (c / n) ** 2;
  return 1 - s;
}

export function trainTree(X, y, { maxDepth = 40 } = {}) {
  const grow = (idx, depth) => {
    const counts = new Map();
    for (const i of idx) counts.set(y[i], (counts.get(y[i]) ?? 0) + 1);
    if (counts.size === 1 || depth >= maxDepth) {
      const [label] = [...counts.entries()].sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0])))[0];
      return { leaf: label, n: idx.length, pure: counts.size === 1 };
    }
    const n = idx.length;
    let best = null;
    const nf = X[0].length;
    for (let f = 0; f < nf; f++) {
      const order = [...idx].sort((a, b) => X[a][f] - X[b][f]);
      const left = new Map();
      const right = new Map(counts);
      for (let k = 0; k < n - 1; k++) {
        const lbl = y[order[k]];
        left.set(lbl, (left.get(lbl) ?? 0) + 1);
        right.set(lbl, right.get(lbl) - 1);
        if (right.get(lbl) === 0) right.delete(lbl);
        const v = X[order[k]][f], next = X[order[k + 1]][f];
        if (v === next) continue;
        const nl = k + 1;
        const score = (nl * gini(left, nl) + (n - nl) * gini(right, n - nl)) / n;
        if (!best || score < best.score - 1e-12) best = { f, t: v, score };
      }
    }
    if (!best) {
      const [label] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
      return { leaf: label, n, pure: false };
    }
    const L = idx.filter((i) => X[i][best.f] <= best.t);
    const R = idx.filter((i) => X[i][best.f] > best.t);
    return { f: best.f, t: best.t, l: grow(L, depth + 1), r: grow(R, depth + 1) };
  };
  return grow(X.map((_, i) => i), 0);
}

export function predict(tree, x) {
  let node = tree;
  while (node.leaf === undefined) node = x[node.f] <= node.t ? node.l : node.r;
  return node.leaf;
}

export function accuracy(tree, X, y) {
  let ok = 0;
  const wrong = [];
  X.forEach((x, i) => {
    if (predict(tree, x) === y[i]) ok++;
    else wrong.push(i);
  });
  return { acc: X.length ? ok / X.length : 1, ok, total: X.length, wrong };
}

export function treeSize(node) {
  return node.leaf !== undefined ? { nodes: 1, leaves: 1, depth: 1 } : (() => {
    const a = treeSize(node.l), b = treeSize(node.r);
    return { nodes: 1 + a.nodes + b.nodes, leaves: a.leaves + b.leaves, depth: 1 + Math.max(a.depth, b.depth) };
  })();
}
