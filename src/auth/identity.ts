import {
  constants,
  createPrivateKey,
  createPublicKey,
  generateKeyPair as generateKeyPairCallback,
  privateDecrypt,
  timingSafeEqual,
  type KeyObject,
} from 'node:crypto';
import { promisify } from 'node:util';

const generateKeyPair = promisify(generateKeyPairCallback);

function canonicalPublicKey(key: string | KeyObject): Buffer {
  return createPublicKey(key).export({ type: 'spki', format: 'der' });
}

/** Node-only helpers for Digikala's RSA application identity. */
export class DigikalaIdentity {
  static async generate(): Promise<{ publicKey: string; privateKey: string }> {
    const { publicKey, privateKey } = await generateKeyPair('rsa', {
      modulusLength: 4096,
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    });

    return { publicKey, privateKey };
  }

  static validateKeyPair(input: {
    publicKey: string;
    privateKey: string;
  }): boolean {
    try {
      const expected = canonicalPublicKey(input.publicKey);
      const derived = canonicalPublicKey(createPrivateKey(input.privateKey));
      return (
        expected.length === derived.length && timingSafeEqual(expected, derived)
      );
    } catch {
      return false;
    }
  }

  /**
   * Digikala wraps PKCS#1 v1.5 data in an RSA block that its existing clients
   * decode with raw RSA and explicit padding removal.
   */
  static decryptAuthorizationCode(
    encryptedBase64: string,
    privateKey: string,
  ): string {
    const decrypted = privateDecrypt(
      { key: privateKey, padding: constants.RSA_NO_PADDING },
      Buffer.from(encryptedBase64, 'base64'),
    );

    let dataStart = -1;
    if (decrypted[0] === 0 && decrypted[1] === 2) {
      dataStart = decrypted.indexOf(0, 2) + 1;
    }

    const result = dataStart > 0 ? decrypted.subarray(dataStart) : decrypted;
    return result.toString('utf8').replaceAll('\0', '').trim();
  }
}
