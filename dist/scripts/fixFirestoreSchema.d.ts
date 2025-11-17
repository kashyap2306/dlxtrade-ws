/**
 * Firestore Schema Migration Script
 *
 * This script fixes and completes all Firestore document structures for existing users.
 * It ensures proper schema for:
 * - users/{uid}/profile
 * - users/{uid}/integrations/{apiName}
 * - users/{uid}/settings
 * - users/{uid}/agents/{agentName}
 * - users/{uid}/uiPreferences
 * - Removes demo/test placeholder documents
 */
declare function fixFirestoreSchema(): Promise<{
    success: boolean;
    total: number;
    fixed: number;
    errors: number;
}>;
export { fixFirestoreSchema };
//# sourceMappingURL=fixFirestoreSchema.d.ts.map