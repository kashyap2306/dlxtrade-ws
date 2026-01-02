import { getFirebaseAdmin } from "../utils/firebase";
import {
  ExchangeConnectorFactory,
  type ExchangeName,
} from "./exchangeConnector";
import { decrypt, decryptOrThrow } from "./keyManager";
import { firestoreAdapter, isExchangeUsable } from "./firestoreAdapter";
import { logger } from "../utils/logger";

export interface ResolvedExchangeConnector {
  exchange: ExchangeName;
  connector: any;
  credentials: {
    apiKey: string;
    secret: string;
    passphrase?: string;
    testnet: boolean;
  };
}

/**
 * Unified exchange connector resolver
 * Primary source: users/{uid}/exchangeConfig/current
 * Secondary fallback: integrations system
 *
 * Returns null if no credentials found, with detailed logging
 */
export async function resolveExchangeConnector(
  uid: string,
  context: string = "user_request",
): Promise<ResolvedExchangeConnector | null> {
  try {

    const db = getFirebaseAdmin().firestore();

    // PRIMARY: Check exchangeConfig subcollection (where frontend saves credentials)
    const configDoc = await db
      .collection("users")
      .doc(uid)
      .collection("exchangeConfig")
      .doc("current")
      .get();

    if (configDoc.exists) {
      const config = configDoc.data()!;

      // Check if user has explicitly disconnected
      if (config.disconnected === true) {
        logger.info(
          { uid },
          "Exchange resolver: User has disconnected exchange, returning null",
        );
        return null;
      }

      // 1. HARD ASSERTION: No exchange means null, NO exceptions
      if (!config.exchange || typeof config.exchange !== 'string' || config.exchange.trim() === '') {
        if (context === 'background_job') {
          const errorMsg = `[ILLEGAL_DEFAULT_EXCHANGE_SELECTION] Background job for UID ${uid} attempted operation with missing exchange field.`;
          console.error(`🚫 ${errorMsg}`);
          return null;
        }
        logger.warn({ uid }, "Exchange resolver: exchange field missing or empty, returning null");
        return null;
      }

      const hasApiKey = !!config.apiKeyEncrypted;
      const hasSecret = !!(config.secretKeyEncrypted || config.secretEncrypted);

      if (!hasApiKey || !hasSecret) {
        logger.warn(
          {
            uid,
            hasExchange: true,
            hasApiKey,
            hasSecret,
            existingFields: Object.keys(config),
          },
          "Exchange resolver: Credentials missing in exchangeConfig - returning null",
        );
        return null; // Treat as not connected
      }

      // Normalize exchange name
      const exchange = config.exchange.toLowerCase().trim() as ExchangeName;
      const validExchanges: ExchangeName[] = [
        "binance",
        "bitget",
        "bingx",
        "weex",
      ];

      // Validate exchange name EARLY - return null immediately if invalid
      if (!validExchanges.includes(exchange)) {
        logger.warn(
          { uid, exchange: config.exchange },
          "Unsupported exchange name in config",
        );
        return null;
      }

      // Proceed with decryption and connector creation
      // CRITICAL: For background operations, use graceful decrypt (don't fail permanently)
      // Only user-initiated actions should trigger key cleanup
      let apiKey: string;
      let secret: string;
      let passphrase: string | undefined;

      try {
        const { decrypt } = await import("./keyManager");
        apiKey = decrypt(config.apiKeyEncrypted, context);
        secret = decrypt(config.secretKeyEncrypted || config.secretEncrypted, context);
        passphrase = config.passphraseEncrypted
          ? decrypt(config.passphraseEncrypted, context)
          : undefined;

        // If any key failed to decrypt, exchange is not usable
        if (apiKey === null || secret === null) {
          logger.warn(
            {
              uid,
              exchange,
              apiKeyDecrypted: apiKey !== null,
              secretDecrypted: secret !== null,
              passphraseDecrypted: passphrase !== null,
            },
            "EXCHANGE_DECRYPTION_FAILED: Exchange keys exist but cannot be decrypted - exchange not usable",
          );
          return null;
        }
      } catch (decryptErr: any) {
        logger.warn(
          {
            uid,
            exchange,
            error: decryptErr.message,
          },
          "EXCHANGE_DECRYPTION_FAILED: Unexpected decryption error - exchange not usable",
        );
        return null;
      }

      const testnet = config.testnet ?? true;

      // CRITICAL: Validate decrypted credentials before creating connector
      if (!apiKey || apiKey.trim() === "") {
        logger.error(
          { uid, exchange },
          "EXCHANGE_KEY_DECRYPTION_FAILED: Decrypted API key is empty",
        );
        return null;
      }
      if (!secret || secret.trim() === "") {
        logger.error(
          { uid, exchange },
          "EXCHANGE_KEY_DECRYPTION_FAILED: Decrypted secret is empty",
        );
        return null;
      }
      // Passphrase is optional for some exchanges, but required for Bitget
      if (exchange === "bitget" && (!passphrase || passphrase.trim() === "")) {
        logger.error(
          { uid, exchange },
          "EXCHANGE_KEY_DECRYPTION_FAILED: Decrypted passphrase is empty (required for Bitget)",
        );
        return null;
      }

      // Create connector using factory
      try {
        const connector = ExchangeConnectorFactory.create(exchange, {
          apiKey,
          secret,
          passphrase,
          testnet,
        });

        logger.info(
          { uid, exchange, testnet },
          "Exchange connector resolved from exchangeConfig",
        );

        return {
          exchange,
          connector,
          credentials: {
            apiKey,
            secret,
            passphrase,
            testnet,
          },
        };
      } catch (createErr: any) {
        logger.error(
          { uid, exchange, error: createErr.message },
          "Failed to create exchange connector",
        );
        return null;
      }
    }

    // No credentials found in exchangeConfig/current
    logger.warn(
      { uid },
      "No exchange credentials found in users/{uid}/exchangeConfig/current. Please configure your exchange API credentials in Settings → Trading API Integration.",
    );
    return null;
  } catch (err: any) {
    logger.error(
      { uid, error: err.message, stack: err.stack },
      "Error resolving exchange connector",
    );
    return null;
  }
}
