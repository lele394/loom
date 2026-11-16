import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const violations = [];

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(entry)) out.push(full);
  }
  return out;
}

// Server modules may use another module's public service, never its repo/SQL.
for (const file of walk(path.join(root, 'src/server/modules'))) {
  const relative = path.relative(path.join(root, 'src/server/modules'), file);
  const current = relative.split(path.sep)[0];
  const source = readFileSync(file, 'utf8');
  const imports = [...source.matchAll(/from\s+['"]([^'"]+)['"]/g)].map((match) => match[1]);
  for (const target of imports) {
    const match = /(?:\.\.\/)+([a-z0-9-]+)\/repo(?:\.js)?$/.exec(target);
    if (match && match[1] !== current) {
      violations.push(`${path.relative(root, file)} imports another module's repository (${target})`);
    }
  }
}

// Feature components must not import another feature's components.
for (const file of walk(path.join(root, 'src/web/features'))) {
  const relative = path.relative(path.join(root, 'src/web/features'), file);
  const current = relative.split(path.sep)[0];
  const source = readFileSync(file, 'utf8');
  const imports = [...source.matchAll(/from\s+['"]([^'"]+)['"]/g)].map((match) => match[1]);
  for (const target of imports) {
    const match = /(?:\.\.\/)+([a-z0-9-]+)\//.exec(target);
    if (match && match[1] !== current && !['shared', 'app'].includes(match[1])) {
      violations.push(`${path.relative(root, file)} imports another feature (${target})`);
    }
  }
  if (source.includes('dangerouslySetInnerHTML')) {
    violations.push(`${path.relative(root, file)} uses dangerouslySetInnerHTML`);
  }
}

// No ad-hoc console logging in the server; use the injected Pino logger.
for (const file of walk(path.join(root, 'src/server'))) {
  const source = readFileSync(file, 'utf8');
  if (/console\.(log|warn|error)\(/.test(source)) {
    violations.push(`${path.relative(root, file)} uses console.* instead of the logger`);
  }
}

if (violations.length) {
  console.error('Boundary violations:');
  for (const violation of violations) console.error(' - ' + violation);
  process.exit(1);
}
console.log('Module boundaries OK');
