/**
 * Base adapter class for all source adapters
 * Provides common functionality and enforces contract
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadEnvFile } from './common-utils.mjs';

export class BaseAdapter {
  constructor(config) {
    this.config = config;
    this.scriptDir = dirname(fileURLToPath(import.meta.url));
    this.rootEnvPath = resolve(this.scriptDir, '../../../.env');
    loadEnvFile(this.rootEnvPath);
    this.dbUrl = process.env.DATABASE_URL?.trim();
    this.debug = process.env.DEBUG?.toLowerCase() === 'true';
  }

  // Abstract methods that must be implemented by subclasses
  async validateTarget(target) {
    throw new Error('validateTarget must be implemented');
  }

  async fetchRecords(target) {
    throw new Error('fetchRecords must be implemented');
  }

  async normalizeRecord(record, target) {
    throw new Error('normalizeRecord must be implemented');
  }

  // Common utility methods
  log(message, data = null) {
    if (this.debug) {
      console.log(`[${this.constructor.name}] ${message}`);
      if (data) console.log(JSON.stringify(data, null, 2));
    }
  }

  error(message, error = null) {
    console.error(`[${this.constructor.name}] ERROR: ${message}`);
    if (error) console.error(error);
  }

  async writeJsonFile(path, data, dir = null) {
    // Sanitize path to prevent directory traversal
    const safePath = path.replace(/\.\.\//g, '').replace(/\//g, '_');
    const filePath = dir ? join(dir, safePath) : resolve(this.scriptDir, safePath);

    // Ensure final path is within expected directory
    if (dir) {
      const resolvedDir = resolve(dir);
      const resolvedPath = resolve(filePath);
      if (!resolvedPath.startsWith(resolvedDir)) {
        throw new Error(`Path traversal attempt detected: ${path}`);
      }
    }

    // Ensure directory exists
    if (dir) {
      const targetDir = dirname(filePath);
      if (!existsSync(targetDir)) {
        mkdirSync(targetDir, { recursive: true });
      }
    }

    writeFileSync(filePath, JSON.stringify(data, null, 2));
    this.log(`Wrote ${filePath}`);
  }

  async readJsonFile(path) {
    if (!existsSync(path)) {
      return [];
    }
    return JSON.parse(readFileSync(path, 'utf8'));
  }

  buildRecordId(sourceUrl, index = 0) {
    const hash = sourceUrl ?
      sourceUrl.split('/').pop().replace(/\D/g, '') :
      'unknown';
    return `${this.constructor.name}-${hash}-${index + 1}`;
  }

  normalizeDomain(domain) {
    if (!domain) return '';
    return domain.toLowerCase().trim().replace(/^https?:\/\//, '');
  }

  normalizeUrl(url) {
    if (!url) return null;
    try {
      const urlObj = new URL(url);
      return urlObj.toString();
    } catch {
      return null;
    }
  }
}

/**
 * Extract a bare, normalized domain from a full website URL.
 *
 * website_url ("https://www.Company.RU/careers") -> domain ("company.ru").
 * This is the inverse of normalizeDomain(): normalizeDomain only cleans an
 * already-extracted host, whereas extractDomain derives the host from a URL.
 *
 * Returns null for empty input or anything that doesn't parse as an
 * http(s) URL with a hostname — callers must treat null as "no domain".
 */
export function extractDomain(url) {
  if (!url || typeof url !== 'string' || !url.trim()) return null;
  let candidate = url.trim();
  // Detect any leading "scheme:" (with or without "//"). If one is present it
  // must be http/https — otherwise reject (mailto:, tel:, ftp:, ...). Only when
  // NO scheme is present do we prepend https://, so a bare "company.ru/jobs"
  // isn't parsed with "company.ru" as the protocol.
  const schemeMatch = /^([a-z][a-z0-9+.-]*):/i.exec(candidate);
  if (schemeMatch) {
    const scheme = schemeMatch[1].toLowerCase();
    if (scheme !== 'http' && scheme !== 'https') return null;
  } else {
    candidate = `https://${candidate}`;
  }
  try {
    const { protocol, hostname } = new URL(candidate);
    if (protocol !== 'http:' && protocol !== 'https:') return null;
    const host = hostname.toLowerCase().replace(/^www\./, '');
    return host || null;
  } catch {
    return null;
  }
}

// Common adapter contract
export const AdapterContract = {
  // Required fields in normalized records
  REQUIRED_FIELDS: [
    'company_name',
    'company_domain',
    'source_record_type',
    'external_id',
    'occurred_at'
  ],

  // Valid source record types
  RECORD_TYPES: [
    'job_posting',
    'company_profile',
    'career_page',
    'newsroom_post'
  ],

  // Validation method
  validateRecord(record) {
    const missing = this.REQUIRED_FIELDS.filter(field => !record[field]);
    if (missing.length > 0) {
      throw new Error(`Missing required fields: ${missing.join(', ')}`);
    }

    if (!this.RECORD_TYPES.includes(record.source_record_type)) {
      throw new Error(`Invalid source_record_type: ${record.source_record_type}`);
    }

    return true;
  }
};