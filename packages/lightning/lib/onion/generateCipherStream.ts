import * as crypto from "@node-lightning/crypto";

export function generateCipherStream(key: Buffer, size: number) {
    const iv = Buffer.alloc(16);
    const data = Buffer.alloc(size);
    return crypto.chachaEncrypt(key, iv, data);
}
