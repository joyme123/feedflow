// ============================================================
// Encryption — wrap Electron's safeStorage for credential values
// ============================================================

import { safeStorage } from 'electron'

/** Encrypt a plaintext secret for storage. Falls back to plaintext when
 *  safeStorage is unavailable (e.g. unsupported OS / not ready). */
export function encrypt(plaintext: string): string {
  if (safeStorage?.isEncryptionAvailable?.()) {
    return safeStorage.encryptString(plaintext).toString('base64')
  }
  return plaintext
}

/** Decrypt a stored secret. Falls back to returning the raw value only when
 *  safeStorage is unavailable at runtime. */
export function decrypt(ciphertext: string): string {
  if (safeStorage?.isEncryptionAvailable?.()) {
    return safeStorage.decryptString(Buffer.from(ciphertext, 'base64'))
  }
  return ciphertext
}
