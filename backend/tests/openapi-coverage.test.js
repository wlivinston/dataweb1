const fs = require('node:fs');
const path = require('node:path');

/**
 * The published contract has to describe the API that is actually mounted.
 *
 * `/datasets` shipped as a complete, tested, authenticated route group that
 * appeared nowhere in openapi/v1.yaml, and so did `/notifications` before it.
 * Nothing noticed, because the only test touching the spec asserted that it
 * was served and that it began with "openapi: 3.0.3" - which a file holding
 * nothing but that line would also pass.
 *
 * A spec that silently omits a route group is worse than no spec: a client
 * author reads it as the whole surface and concludes the endpoint does not
 * exist. So this walks the mounts in api/v1/index.js and insists each prefix
 * appears among the documented paths.
 *
 * Prefixes rather than every individual route, deliberately. Asserting each
 * method and path would mean re-deriving the router's own table here and
 * would fail on every ordinary addition; the gap worth catching is a whole
 * feature nobody documented.
 */

const ROOT = path.join(__dirname, '..');

const readMountedPrefixes = () => {
  const source = fs.readFileSync(path.join(ROOT, 'api', 'v1', 'index.js'), 'utf8');
  const prefixes = [];
  const pattern = /router\.use\(\s*'(\/[^']*)'/g;
  let match = pattern.exec(source);
  while (match !== null) {
    prefixes.push(match[1]);
    match = pattern.exec(source);
  }
  return prefixes;
};

const readDocumentedPaths = () => {
  const spec = fs.readFileSync(path.join(ROOT, 'openapi', 'v1.yaml'), 'utf8');
  return (spec.match(/^ {2}(\/\S*):$/gm) || []).map((line) => line.trim().replace(/:$/, ''));
};

describe('the OpenAPI contract covers what is mounted', () => {
  const mounted = readMountedPrefixes();
  const documented = readDocumentedPaths();

  test('finds the mounts and the paths at all', () => {
    // Both readers parse source text, so either could silently return nothing
    // and make every assertion below pass against an empty set.
    expect(mounted.length).toBeGreaterThan(5);
    expect(documented.length).toBeGreaterThan(20);
    expect(mounted).toContain('/datasets');
    expect(documented).toContain('/datasets');
  });

  // jest's expect takes no message argument - that is vitest, which the
  // frontend suite uses. The explanation travels inside the compared value
  // instead, so a failure still says what to do about it.
  test.each(readMountedPrefixes())('%s is documented', (prefix) => {
    const covered = documented.some((documentedPath) => documentedPath.startsWith(prefix));
    expect(
      covered
        ? 'documented'
        : `${prefix} is mounted in api/v1/index.js but no path in openapi/v1.yaml ` +
          'begins with it. Add it to the spec, or unmount it.'
    ).toBe('documented');
  });

  test('every documented path belongs to something mounted', () => {
    // The other direction: a path left in the spec after its routes were
    // removed tells a client author to call an endpoint that 404s.
    const orphans = documented.filter(
      (documentedPath) =>
        documentedPath !== '/' && !mounted.some((prefix) => documentedPath.startsWith(prefix))
    );
    expect(`documented but not mounted: ${orphans.join(', ')}`).toBe(
      'documented but not mounted: '
    );
  });

  test('every dataset route is documented, not just the prefix', () => {
    // The group this test was written for, checked properly rather than by
    // prefix - a single documented /datasets would satisfy the rule above
    // while leaving the three-step upload undescribed, and the upload is the
    // part a client cannot guess.
    for (const expected of [
      '/datasets',
      '/datasets/limits',
      '/datasets/{id}',
      '/datasets/{id}/rows',
      '/datasets/{id}/complete',
    ]) {
      expect(documented).toContain(expected);
    }
  });
});
