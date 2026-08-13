import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import tls from 'node:tls';

let installed = false;

/** Add the checked-in official Russian government chain to Node without disabling TLS verification. */
export function installGovernmentCaRuntime() {
  if (installed || typeof tls.getCACertificates !== 'function' || typeof tls.setDefaultCACertificates !== 'function') return false;
  const certificateDirectory = resolve(import.meta.dirname, '../../certs');
  const paths = [
    resolve(certificateDirectory, 'russian-trusted-root-ca.pem'),
    resolve(certificateDirectory, 'russian-trusted-sub-ca-2024.pem'),
  ];
  if (!paths.every(existsSync)) return false;
  tls.setDefaultCACertificates([
    ...tls.getCACertificates('default'),
    ...tls.getCACertificates('system'),
    ...paths.map((path) => readFileSync(path, 'utf8')),
  ]);
  installed = true;
  return true;
}
