
import { decrypt, encrypt, initializeEncryptionKey } from '../../services/keyManager';

async function testDecryption() {
    try {
        console.log("Initializing encryption key...");
        // Mock env if needed, but assuming it's set in environment or we can set it
        // In strict production, we shouldn't set it if it's already there
        if (!process.env.ENCRYPTION_SECRET) {
            console.log("Setting temp ENCRYPTION_SECRET for test");
            process.env.ENCRYPTION_SECRET = "01234567890123456789012345678901"; // 32 chars
        }

        try {
            initializeEncryptionKey();
        } catch (e: any) {
            if (!e.message.includes("called multiple times")) console.error(e);
        }

        const original = "my-secret-api-key";
        console.log(`Original: ${original}`);

        const encrypted = encrypt(original);
        console.log(`Encrypted: ${encrypted}`);

        console.log("Attempting decrypt with 'user_request'...");
        const decrypted = decrypt(encrypted, "user_request");

        if (decrypted !== original) {
            console.error("FAIL: Decrypted value mismatch");
            process.exit(1);
        } else {
            console.log("SUCCESS: Decrypted value matches original");
            console.log(`Decrypted: ${decrypted}`);
        }

        console.log("Attempting decrypt with MISSING context (should fail compile or runtime)...");
        try {
            // @ts-ignore - This is intentionally testing the error case
            decrypt(encrypted, undefined);
            console.error("FAIL: decrypt() with missing context passed (should have thrown)");
        } catch (e: any) {
            console.log(`SUCCESS: Caught expected error: ${e.message}`);
        }

        console.log("Attempting decrypt with 'unknown' context...");
        try {
            decrypt(encrypted, "unknown");
            console.error("FAIL: decrypt() with 'unknown' context passed (should have thrown)");
        } catch (e: any) {
            console.log(`SUCCESS: Caught expected error: ${e.message}`);
        }

    } catch (err) {
        console.error("Test failed with error:", err);
        process.exit(1);
    }
}

testDecryption();
