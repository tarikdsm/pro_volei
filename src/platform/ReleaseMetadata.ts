export interface ReleaseMetadata {
  readonly version: string;
  readonly sha: string;
}

const SEMVER_PATTERN =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;
const SHA_PATTERN = /^[0-9a-f]{7,40}$/i;

export function normalizeReleaseMetadata(version: unknown, sha: unknown): ReleaseMetadata {
  if (
    typeof version !== 'string' ||
    !SEMVER_PATTERN.test(version) ||
    typeof sha !== 'string' ||
    !SHA_PATTERN.test(sha)
  ) {
    return Object.freeze({ version: 'dev', sha: 'local' });
  }

  return Object.freeze({ version, sha: sha.toLowerCase() });
}

export const RELEASE_METADATA = normalizeReleaseMetadata(
  typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : undefined,
  typeof __BUILD_SHA__ === 'string' ? __BUILD_SHA__ : undefined,
);
