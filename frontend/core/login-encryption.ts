/** QualityOps login envelope. Only the server holds the RSA private key. */
export interface LoginKey {
  algorithm: string;
  key_id: string;
  public_key: string;
  challenge: string;
  expires_in: number;
}

const decode = (value: string): Uint8Array<ArrayBuffer> =>
  Uint8Array.from(atob(value), character => character.charCodeAt(0));
const encode = (value: ArrayBuffer | Uint8Array): string =>
  btoa(Array.from(new Uint8Array(value instanceof Uint8Array ? value.buffer : value), byte => String.fromCharCode(byte)).join(''));

export async function encryptLogin(key: LoginKey, username: string, password: string) {
  if (!window.crypto?.subtle || key.algorithm !== 'RSA-OAEP-256+A256GCM')
    throw new Error('Secure sign-in requires HTTPS and a supported browser.');
  const plaintext = new TextEncoder().encode(JSON.stringify({ username, password }));
  let rawKey: ArrayBuffer | undefined;
  try {
    const publicKey = await crypto.subtle.importKey('spki', decode(key.public_key),
      { name: 'RSA-OAEP', hash: 'SHA-256' }, false, ['encrypt']);
    const aesKey = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt']);
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv,
      additionalData: new TextEncoder().encode(key.challenge), tagLength: 128 }, aesKey, plaintext);
    rawKey = await crypto.subtle.exportKey('raw', aesKey);
    const wrappedKey = await crypto.subtle.encrypt({ name: 'RSA-OAEP' }, publicKey, rawKey);
    return { key_id: key.key_id, challenge: key.challenge, wrapped_key: encode(wrappedKey),
      iv: encode(iv), ciphertext: encode(ciphertext) };
  } catch {
    throw new Error('Secure sign-in could not be prepared. Refresh and try again.');
  } finally {
    plaintext.fill(0);
    if (rawKey) new Uint8Array(rawKey).fill(0);
  }
}
