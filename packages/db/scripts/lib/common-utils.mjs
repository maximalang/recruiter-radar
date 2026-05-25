/**
 * Common utilities for source scripts
 * Centralized to eliminate code duplication
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Load environment file and return parsed variables
 * @param {string} filePath - Path to .env file
 * @returns {Object|undefined} Parsed environment variables
 */
export function loadEnvFile(filePath) {
  if (!existsSync(filePath)) {
    return;
  }

  const envFile = readFileSync(filePath, 'utf8').replace(/^﻿/, '');
  const env = {};

  for (const rawLine of envFile.split(/\r?\n/)) {
    const trimmedLine = rawLine.trim();
    if (trimmedLine && !trimmedLine.startsWith('#')) {
      const [key, ...rest] = trimmedLine.split('=');
      if (key) {
        env[key] = rest.join('=').trim().replace(/^["']|["']$/g, '');
      }
    }
  }

  return env;
}

/**
 * Normalize domain name. Returns null for empty/invalid input so that
 * `normalizeDomain(x) ?? fallback` falls through correctly.
 * @param {string} domain - Domain to normalize
 * @returns {string|null} Normalized domain or null
 */
export function normalizeDomain(domain) {
  if (typeof domain !== 'string') return null;
  const normalized = domain.trim().replace(/\s+/g, ' ').toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '');
  return normalized === '' ? null : normalized;
}

/**
 * Normalize INN (Individual Tax Number)
 * @param {string|number} inn - INN to normalize
 * @returns {string} Normalized INN
 */
export function normalizeInn(inn) {
  if (!inn) return '';
  return inn.toString().trim().replace(/\D/g, '');
}

/**
 * Normalize OGRN (State Registration Number)
 * @param {string|number} ogrn - OGRN to normalize
 * @returns {string} Normalized OGRN
 */
export function normalizeOgrn(ogrn) {
  if (!ogrn) return '';
  return ogrn.toString().trim().replace(/\D/g, '');
}

/**
 * Common CLI runner pattern
 * @param {string} scriptName - Name of the script
 * @param {Function} mainHandler - Main async function
 */
export async function runScriptCli(scriptName, mainHandler) {
  try {
    await mainHandler(process.argv.slice(2));
  } catch (error) {
    console.error(`Error in ${scriptName}:`, error.message);
    process.exit(1);
  }
}

/**
 * Format timestamp to ISO string
 * @param {string|Date} timestamp - Timestamp to format
 * @returns {string} ISO formatted timestamp
 */
export function formatTimestamp(value) {
  if (!value) return '';
  return new Date(value).toISOString();
}