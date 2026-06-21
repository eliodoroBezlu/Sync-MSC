const fs = require('fs');
const path = require('path');

const ROOT = process.cwd();
const SRC = path.join(ROOT, 'src');
const exts = ['.ts', '.tsx', '.js', '.jsx'];

function walk(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files = [];
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      files.push(...walk(full));
    } else if (e.isFile() && exts.includes(path.extname(e.name))) {
      files.push(full);
    }
  }
  return files;
}

function tryResolveImport(fromFile, spec) {
  // handle alias @/ -> src/
  if (spec.startsWith('@/')) {
    const p = path.join(SRC, spec.slice(2));
    for (const e of exts) {
      const f = p + e;
      if (fs.existsSync(f)) return path.normalize(f);
    }
    for (const e of exts) {
      const f = path.join(p, 'index' + e);
      if (fs.existsSync(f)) return path.normalize(f);
    }
    return null;
  }
  if (spec.startsWith('.') || spec.startsWith('/')) {
    const base = spec.startsWith('/') ? path.join(ROOT, spec) : path.join(path.dirname(fromFile), spec);
    for (const e of exts) {
      const f = base + e;
      if (fs.existsSync(f)) return path.normalize(f);
    }
    for (const e of exts) {
      const f = path.join(base, 'index' + e);
      if (fs.existsSync(f)) return path.normalize(f);
    }
    return null;
  }
  // bare specifier (package) -> ignore
  return null;
}

function parseImports(content) {
  const imports = [];
  const importRe = /import\s+(?:[^'";]+)\s+from\s+['"]([^'"]+)['"]/g;
  const dynamicRe = /import\(\s*['"]([^'"]+)['"]\s*\)/g;
  let m;
  while ((m = importRe.exec(content))) imports.push(m[1]);
  while ((m = dynamicRe.exec(content))) imports.push(m[1]);
  return imports;
}

function findChains() {
  const files = walk(SRC);
  const graph = Object.create(null);
  const contentMap = Object.create(null);

  for (const f of files) {
    const c = fs.readFileSync(f, 'utf8');
    contentMap[f] = c;
  }

  for (const f of files) {
    const c = contentMap[f];
    const specs = parseImports(c);
    graph[f] = [];
    for (const s of specs) {
      const resolved = tryResolveImport(f, s);
      if (resolved) graph[f].push(resolved);
    }
  }

  // identify prisma files (those referencing lib/prisma)
  const prismaFiles = new Set();
  for (const f of files) {
    const c = contentMap[f];
    if (!c) continue;
    if (/from\s+['"][^'\"]*lib\/prisma['\"]/m.test(c) || /require\(\s*['"][^'\"]*lib\/prisma['\"]\s*\)/m.test(c) || (/prisma\./m.test(c) && c.includes('lib/prisma'))) {
      prismaFiles.add(f);
    }
  }

  // client files (contain "use client")
  const clientFiles = files.filter(f => /"use client"|`use client`/.test(contentMap[f]));

  // BFS from each client file to any prismaFile
  const results = [];
  for (const start of clientFiles) {
    const queue = [[start]];
    const seen = new Set([start]);
    while (queue.length) {
      const pathChain = queue.shift();
      const last = pathChain[pathChain.length - 1];
      if (prismaFiles.has(last)) {
        results.push(pathChain);
        break; // report first found chain per start
      }
      const neigh = graph[last] || [];
      for (const n of neigh) {
        if (seen.has(n)) continue;
        seen.add(n);
        queue.push([...pathChain, n]);
      }
    }
  }

  return { prismaFiles: Array.from(prismaFiles), clientFiles, chains: results };
}

if (require.main === module) {
  const { prismaFiles, clientFiles, chains } = findChains();
  console.log('Found', clientFiles.length, 'client files and', prismaFiles.length, 'prisma-using files.');
  if (chains.length === 0) {
    console.log('No client -> prisma import chains detected.');
    process.exit(0);
  }
  console.log('Detected chains (client -> ... -> prisma):');
  for (const c of chains) {
    console.log('---');
    for (const p of c) console.log('  ', path.relative(ROOT, p));
  }
  process.exit(0);
}

module.exports = { findChains };
