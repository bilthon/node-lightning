import * as crypto from "@node-lightning/crypto";
import { Wif } from ".";
import { BitcoinError } from "./BitcoinError";
import { BitcoinErrorCode } from "./BitcoinErrorCode";
import { Network } from "./Network";
import { PublicKey } from "./PublicKey";

/**
 * This class encapsulates a 32-byte buffer containing a big-endian
 * encoded number between 0x1 and
 * 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364140
 * that is a private key for the secp256k1 elliptic curve.
 */
export class PrivateKey {
    /**
     * Decodes a WIF encoded string into the private key as well as the
     * public key. The inclusion of the public key allows us to capture
     * if the public key was compressed.
     * @param input WIF encoded string
     * @returns A tuple of the private key and public key
     * @throw {@link BitcoinError} Throws for invalid network prefix or
     * invalid private or public keys.
     */
    public static fromWif(input: string): [PrivateKey, PublicKey] {
        const decoded = Wif.decode(input);
        const network = Wif.decodePrefix(decoded.prefix);
        const prvkey = new PrivateKey(decoded.privateKey, network);
        const pubkey = prvkey.toPubKey(decoded.compressed);
        return [prvkey, pubkey];
    }

    private _buffer: Buffer;

    /**
     * Constructs a new private key instance and requires a valid private
     * key value.
     * @param buffer 32-byte buffer containing a valid private key
     * @param network The network that the private key belongs to
     */
    constructor(buffer: Buffer, readonly network: Network) {
        if (!crypto.validPrivateKey(buffer)) {
            throw new BitcoinError(BitcoinErrorCode.InvalidPrivateKey, { key: buffer });
        }
        this._buffer = buffer;
    }

    /**
     * Converts the instance into a big-endian encoded 32-byte buffer
     * @returns 32-byte buffer
     */
    public toBuffer(): Buffer {
        return this._buffer;
    }

    /**
     * Converts the instance into a big-endian encoded hex string
     */
    public toHex(): string {
        return this._buffer.toString("hex");
    }

    /**
     * Converts the private key into the corresponding public key
     */
    public toPubKey(compressed: boolean): PublicKey {
        const result = crypto.getPublicKey(this._buffer, compressed);
        return new PublicKey(result, this.network);
    }

    /**
     * Converts the private key to WIF
     */
    public toWif(compressed: boolean): string {
        return Wif.encode(this.network.wifPrefix, this._buffer, compressed);
    }

    /**
     * Tweaks a private key by adding a value to it.
     * The equation is: e + t.
     *
     * @param tweak a 32-byte tweak
     * @returns new instance of PrivateKey with the tweaked value
     */
    public tweakAdd(tweak: Buffer): PrivateKey {
        const result = crypto.privateKeyTweakAdd(this._buffer, tweak);
        return new PrivateKey(result, this.network);
    }

    /**
     * Tweaks a private key by multiplying it. The equation is: e * t.
     *
     * @param tweak a 32-byte tweak
     * @returns new instance of PrivateKey with the tweaked value
     */
    public tweakMul(tweak: Buffer): PrivateKey {
        const result = crypto.privateKeyTweakMul(this._buffer, tweak);
        return new PrivateKey(result, this.network);
    }
}
