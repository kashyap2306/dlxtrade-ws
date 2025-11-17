import type { ApiKey } from '../types';
export declare function encrypt(text: string): string;
export declare function decrypt(encryptedText: string): string;
export declare function listKeys(): Promise<Omit<ApiKey, 'apiKey' | 'apiSecret'>[]>;
export declare function getKey(id: number): Promise<ApiKey | null>;
export declare function createKey(exchange: string, name: string, apiKey: string, apiSecret: string, testnet: boolean): Promise<number>;
export declare function updateKey(id: number, updates: Partial<{
    name: string;
    apiKey: string;
    apiSecret: string;
    testnet: boolean;
}>): Promise<void>;
export declare function deleteKey(id: number): Promise<void>;
export declare function maskKey(key: string): string;
//# sourceMappingURL=keyManager.d.ts.map